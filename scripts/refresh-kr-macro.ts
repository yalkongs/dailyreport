// scripts/refresh-kr-macro.ts
//
// 주 1회(일요일 23:00 KST) 실행. Anthropic web_search 도구로 한국
// 주요 매크로 일정을 검색해 data/kr-macro-calendar.json 캐시 갱신.
//
// (Phase F1 — 2026-05-24)
//
// 환경 변수:
//   ANTHROPIC_API_KEY   필수
//   KR_MACRO_DRY_RUN    "true" 시 화면에만 출력, JSON 미저장 (첫 실행 검증용)
//   KR_MACRO_DAYS_AHEAD 검색 범위 (기본 14일)
//
// 실패 시: Telegram 운영자 알림 + exit 1. 일일 파이프라인은 기존 캐시 사용.

import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { KrMacroCalendarCache, KrMacroEvent, KrMacroCategory } from "../lib/kr-macro-calendar";

const VALID_CATEGORIES: KrMacroCategory[] = [
  "bok_mpb", "cpi", "employment", "gdp", "trade",
  "industrial", "bok_outlook", "futures_expiry", "other",
];

const CACHE_PATH = path.join(process.cwd(), "data", "kr-macro-calendar.json");
const DAYS_AHEAD = Number(process.env.KR_MACRO_DAYS_AHEAD ?? "14");
const DRY_RUN = process.env.KR_MACRO_DRY_RUN === "true";

function todayKst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildSystemPrompt(): string {
  return `당신은 한국 금융 시장 캘린더 리서처입니다. 사용자가 지정한 기간 동안 한국 시장에 영향을 미치는 주요 매크로/공시 일정을 web_search 도구로 조사해 정확한 JSON 으로 반환합니다.

검색 우선순위:
1. 한국은행 금융통화위원회 (Bank of Korea Monetary Policy Board) 일정
2. 통계청·기획재정부 주요 경제 지표 발표 (CPI, 고용, 산업생산, 무역수지, GDP)
3. KRX 선물·옵션 만기일 (매월 둘째 목요일)
4. 한국은행 경제전망 보고서 발표 (분기별)

검색 시:
- 한국은행 공식 사이트 (bok.or.kr), 통계청 (kostat.go.kr), 기획재정부 (moef.go.kr), KRX (krx.co.kr) 등 공식 출처 우선
- 추측·잠정 일정은 description 에 명시
- 종목별 실적 발표나 IR 일정은 제외 (현 단계 범위 밖)

**반드시 JSON 만 출력**. 마크다운 펜스 없음, 설명 없음.`;
}

function buildUserPrompt(start: string, end: string): string {
  return `오늘 날짜: ${start} (KST)
검색 기간: ${start} ~ ${end}

위 기간 동안 한국 금융 시장에 영향을 줄 매크로/지표 발표·이벤트를 모두 찾아 아래 JSON 스키마로 반환하십시오.

\`\`\`typescript
{
  "events": Array<{
    "date": string;           // YYYY-MM-DD
    "category": "bok_mpb" | "cpi" | "employment" | "gdp" | "trade" | "industrial" | "bok_outlook" | "futures_expiry" | "other";
    "name": string;            // ex: "한국은행 금융통화위원회"
    "importance": 1 | 2 | 3 | 4 | 5;   // 1=낮음 5=매우높음
    "description"?: string;    // 짧은 컨텍스트, 추측 여부 등
    "source"?: string;         // 출처 URL 또는 라벨
  }>;
}
\`\`\`

규칙:
- 검색으로 확인되지 않은 일정은 포함하지 마십시오.
- 같은 날 여러 발표가 있어도 각각 별도 객체로.
- importance 기준: 5=한국은행 금통위·CPI / 4=고용·GDP·BOK 경제전망 / 3=산업생산·무역수지 / 2=선물옵션 만기 / 1=기타
- 검색 출처가 한국은행/통계청 공식 사이트면 source 필드에 도메인 명시.
- **JSON 만 반환.** 다른 텍스트 일절 없음.`;
}

interface RawSearchResult {
  events: KrMacroEvent[];
}

function extractJson(text: string): RawSearchResult {
  // Claude 가 종종 JSON 앞뒤에 설명을 붙임. 가장 큰 JSON 객체 ({...})를
  // 본문에서 찾아 추출. 마크다운 펜스도 함께 처리.
  let cleaned = text.trim();

  // 1) 마크다운 펜스 안에 있으면 그것 우선
  const fence = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) {
    return JSON.parse(fence[1]) as RawSearchResult;
  }

  // 2) 첫 { 부터 마지막 } 까지 (가장 outer JSON object) 추출
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  return JSON.parse(cleaned) as RawSearchResult;
}

function validateEvent(e: unknown): KrMacroEvent | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  const cat = typeof o.category === "string" && VALID_CATEGORIES.includes(o.category as KrMacroCategory)
    ? (o.category as KrMacroCategory)
    : "other";
  const imp = typeof o.importance === "number" && o.importance >= 1 && o.importance <= 5
    ? Math.round(o.importance) as 1 | 2 | 3 | 4 | 5
    : 3;
  return {
    date: o.date,
    category: cat,
    name: o.name.trim(),
    importance: imp,
    description: typeof o.description === "string" ? o.description : undefined,
    source: typeof o.source === "string" ? o.source : undefined,
  };
}

async function main() {
  const start = todayKst();
  const end = addDays(start, DAYS_AHEAD);
  console.log(`[refresh-kr-macro] 기간: ${start} ~ ${end}${DRY_RUN ? " (DRY RUN)" : ""}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY 미설정");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: buildSystemPrompt(),
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 6,
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(start, end) }],
  });

  // 최종 응답에서 text 블록 추출
  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  if (textBlocks.length === 0) {
    console.error("응답에 text 블록 없음:", JSON.stringify(response.content).slice(0, 500));
    process.exit(1);
  }
  const text = textBlocks.map((b) => b.text).join("\n").trim();
  console.log(`\n--- Claude raw response (length ${text.length}) ---`);
  console.log(text.slice(0, 2000));
  console.log("--- end raw ---\n");

  let parsed: RawSearchResult;
  try {
    parsed = extractJson(text);
  } catch (e) {
    console.error("JSON 파싱 실패:", (e as Error).message);
    console.error("응답 끝부분 200자:", text.slice(-200));
    process.exit(1);
  }

  if (!parsed || !Array.isArray(parsed.events)) {
    console.error("events 배열 없음. 응답:", JSON.stringify(parsed).slice(0, 300));
    process.exit(1);
  }

  // 이벤트 검증
  const validated: KrMacroEvent[] = [];
  for (const raw of parsed.events) {
    const v = validateEvent(raw);
    if (v) validated.push(v);
    else console.warn("  ⚠️ 잘못된 형식의 이벤트 skip:", JSON.stringify(raw).slice(0, 120));
  }
  validated.sort((a, b) => a.date.localeCompare(b.date));

  const cache: KrMacroCalendarCache = {
    generatedAt: new Date().toISOString(),
    weekRangeStart: start,
    weekRangeEnd: end,
    events: validated,
  };

  console.log(`\n✅ 검증 통과: ${validated.length}개 이벤트`);
  validated.forEach((e) => {
    const stars = "★".repeat(e.importance);
    console.log(`  ${e.date} ${stars} [${e.category}] ${e.name}${e.description ? " — " + e.description : ""}${e.source ? "  (src: " + e.source + ")" : ""}`);
  });

  if (DRY_RUN) {
    console.log("\n🔍 DRY RUN — JSON 저장 생략");
    return;
  }

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");
  console.log(`\n💾 캐시 저장: ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error("[refresh-kr-macro] 실패:", err);
  process.exit(1);
});
