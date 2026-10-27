# 제목 편집 기준 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market·ETF 두 리포트의 제목을 "명확성 → 자연스러운 한국어 → 변주" 순으로 좋아지게 한다. 공통 편집 기준, 예시 순환, 후보 3개와 편집자 선택을 넣는다. 정확성 검사와 F02("전송 > 침묵")는 그대로 둔다.

**Architecture:**
- 새 모듈 둘.
  - `lib/headline-editorial.ts`: 무엇이 좋은 제목인가. 형태 분류, 점수, 측정 지표, 평가 기준, 기준 문구.
  - `lib/headline-selection.ts`: 어떻게 고르나. 후보 추출, 거르기, 임시 제목, 편집자 호출.
- `lib/voice-exemplars.ts`는 고정 제목 예시를 문형이 붙은 풀과 날짜 시드 순환으로 바꾼다.
- 두 파이프라인(`lib/claude-client.ts`, `lib/etf/claude-client.ts`)의 흐름:
  1. 파싱 직후 후보를 거르고 임시 제목을 정한다.
  2. 기존 검증을 그대로 돌린다.
  3. 발송할 결과가 정해지면 편집자를 한 번 부른다.

**Tech Stack:** TypeScript, Node 22, `node:test` + `node:assert/strict` (`tsx --test`), `@anthropic-ai/sdk` 0.88.

**Spec:** `docs/superpowers/specs/2026-10-27-headline-editorial-design.md`

## Global Constraints

- 커밋 메시지는 한국어로 쓰고, 끝에 빈 줄 하나와 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- `git add -A`·`git add .` 금지. 항상 파일 경로를 하나씩 적는다. `public/`과 `docs/audits/`에는 다른 세션의 미추적 파일이 있다.
- 새 모델 ID 문자열을 코드·주석·문서에 쓰지 않는다. 쓰는 것은 기존 문자열을 옮긴 `REPORT_MODEL` 상수 하나뿐이다(Task 3).
- 정확성 검사 규칙 파일(`lib/comparative-claims.ts`, `lib/compliance.ts`, `lib/etf/headline-subject.ts`, `lib/etf/numeric-claims.ts`)은 고치지 않는다. 불러서 쓰기만 한다.
- F02 불변.
  - 1~2회차 위반은 재생성, 마지막 회차는 경고하고 발송한다.
  - 차단은 투자 권유(Market HARD, ETF `INVESTMENT_ADVICE_PATTERNS`)와 필수 항목 누락일 때만이다.
  - 선택 단계 때문에 발송이 막히면 안 된다.
- 금지어 목록을 새로 만들지 않는다. 의인화 정규식은 측정용이고, 차단에 쓰지 않는다.
- 형태 분류 정규식과 순서는 기준선과 같아야 한다. 측정 비교 가능성을 위해서다.
- 테스트는 `npm test`(lib/*.test.ts·lib/etf/*.test.ts·lib/preview/*.test.ts), 타입은 `npm run typecheck`로 본다. 각 작업이 끝날 때 둘 다 통과해야 한다.
- 코드 주석·프롬프트·로그는 주변 코드처럼 한국어로 쓴다.
- 작업은 `feat/headline-editorial` 브랜치(별도 worktree)에서 한다. push·merge·`gh workflow run`은 하지 않는다(Task 6에서 사용자에게 넘긴다).

## Review Focus

1. **모델이 `cover.headline`과 `cover.headlineCandidates`를 함께 쓴 응답.** 후보가 이긴다. 옛 필드는 후보가 없을 때만 쓴다. → Task 3 테스트, Task 4 테스트.
2. **오늘 날짜 항목이 들어 있는 Market 최근 기록.** 같은 날 강제 재생성하면 이런 기록이 생긴다. 오늘 제목은 비교 대상에서 빠져야 한다. → Task 4 테스트.
3. **`HEADLINE_SELECTION`에 `OFF`, ` off ` 같은 대소문자·공백 변형.** 모두 꺼짐으로 읽어야 한다. → Task 3 테스트.
4. **투자 권유가 후보의 subline에만 있는 경우.** 그 후보는 빠져야 하고, 다른 후보로 발송돼야 한다. → Task 4 테스트, Task 5 테스트.
5. **편집자가 임시 제목과 같은 후보를 고른 경우.** 다시 검증하지 않고 그대로 쓴다. → Task 3 테스트.

---

### Task 1: 형태 분류·점수·측정 지표·평가 기준 단일 소스

**Files:**
- Create: `lib/headline-editorial.ts`
- Create: `lib/headline-editorial.test.ts`
- Create: `lib/__fixtures__/headline-baseline-2026-10-27.json` (명령으로 생성)
- Modify: `scripts/headline-quality.ts` (분류기·지표·평가 기준을 lib에서 import)

**Interfaces:**
- Produces:
  - 타입·상수:
    - `type HeadlineForm`, `type EndingType`
    - `RECENT_HEADLINE_WINDOW = 5`, `DOMINANT_FORM_MIN = 3`
    - `SCORE_PENALTY`, `LEXICAL_OVERLAP_MIN = 0.3`
    - `HEADLINE_DESK`, `HEADLINE_RUBRIC`, `HEADLINE_JUDGE_SYSTEM`
  - 함수:
    - `headlineForm(h: string): HeadlineForm`
    - `headlineEnding(h: string): { word: string; type: EndingType }`
    - `headlineTokens(h: string): Set<string>`
    - `jaccard(a, b): number`
    - `cleanHeadline(h: unknown): string`
    - `takeRecentHeadlines(headlines: readonly unknown[], n?: number): string[]`
    - `recentFormStats(recent: readonly string[]): RecentFormStats`
    - `headlineScore(h: string, recent: readonly string[]): { score: number; reasons: string[] }`
    - `headlineCodeMetrics(headlines: readonly string[]): HeadlineCodeMetrics`

- [ ] **Step 1: 기준선 입력 픽스처를 만든다**

기준선을 잰 날(2026-10-27)의 입력과 같아야 한다. 날짜 상한으로 자른다.

```bash
node -e '
const fs = require("fs");
const load = (f) => JSON.parse(fs.readFileSync(f, "utf8")).reports
  .filter((r) => r.headline && r.date <= "2026-10-27")
  .sort((a, b) => (a.date < b.date ? -1 : 1))
  .slice(-60)
  .map((r) => r.headline.replace(/<[^>]+>/g, "").trim());
fs.writeFileSync("lib/__fixtures__/headline-baseline-2026-10-27.json",
  JSON.stringify({ ETF: load("data/etf-reports-index.json"), Market: load("data/reports-index.json") }, null, 2) + "\n");
'
node -e 'const j=require("./lib/__fixtures__/headline-baseline-2026-10-27.json"); console.log(j.ETF.length, j.Market.length, j.ETF.at(-1))'
```
Expected: `60 60 방산 5% 밀린 사이, 미 반도체가 달렸다`

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `lib/headline-editorial.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  headlineForm, headlineScore, headlineCodeMetrics, recentFormStats, takeRecentHeadlines, cleanHeadline,
  HEADLINE_JUDGE_SYSTEM,
} from "./headline-editorial";

const fixture = JSON.parse(fs.readFileSync("lib/__fixtures__/headline-baseline-2026-10-27.json", "utf8")) as { ETF: string[]; Market: string[] };
const baseline = JSON.parse(fs.readFileSync("docs/quality/headline-baseline-2026-10-27.json", "utf8"));

test("코드 지표는 2026-10-27 기준선 수치를 그대로 재현한다(분류기·계산이 바뀌면 기준선과 비교할 수 없다)", () => {
  assert.deepEqual(headlineCodeMetrics(fixture.ETF), baseline.metrics.ETF);
  assert.deepEqual(headlineCodeMetrics(fixture.Market), baseline.metrics.Market);
});

test("headlineForm: 기준선 분류 순서 — 사이 > 날/밤 > 예고 > 말줄임 > 쉼표 > 단문", () => {
  assert.equal(headlineForm("방산 5% 밀린 사이, 미 반도체가 달렸다"), "A하는 사이 B");
  assert.equal(headlineForm("코스피 3.65% 급락, 반도체 ETF 4~6% 밀린 날"), "~한 날/밤");
  assert.equal(headlineForm("국내 반도체 4%대 급등, 한은 금리 동결이 변수다"), "예고형(답한다·변수·시험대·숙제)");
  assert.equal(headlineForm("SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다"), "말줄임 이음(…)");
  assert.equal(headlineForm("반도체 직격, 방어주가 버텼다"), "쉼표 두 토막");
  assert.equal(headlineForm("미 수출규제 우려 속 2차전지·반도체 ETF 동반 급락"), "단문");
});

test("recentFormStats: 직전 제목의 형태와 최근 3번 이상 쓴 형태(최신순 입력)", () => {
  const s = recentFormStats(["A, B", "C, D", "E 급락", "F, G", "H…I"]);
  assert.equal(s.previous, "쉼표 두 토막");
  assert.equal(s.dominant, "쉼표 두 토막");
  assert.equal(s.counts.get("쉼표 두 토막"), 3);
  assert.equal(recentFormStats(["E 급락", "A, B"]).dominant, null);
  assert.equal(recentFormStats([]).previous, null);
});

test("headlineScore: 직전과 같은 형태 -2, 우세 형태 -1, 같은 끝 어절 -1, 어휘 겹침 0.3 이상 -1 — 결정적", () => {
  const recent = [
    "방산 5% 밀린 사이, 미 반도체가 달렸다", // 직전: 사이형
    "2차전지 4% 하락, 원유·채권은 강세",
    "국내 반도체 급등, 방어주는 약세",
    "금 급락, 은도 약세",                     // 쉼표 3건 = 우세
  ];
  assert.deepEqual(headlineScore("미 바이오 ETF 4% 상승", recent), { score: 0, reasons: [] });
  const b = headlineScore("국내 2차전지 급락, 금은 약세", recent);
  assert.equal(b.score, -3); // 우세 형태 -1, 끝 어절 '약세' -1, '금 급락, 은도 약세'와 겹침 0.33 -1
  assert.equal(b.reasons.length, 3);
  const c = headlineScore("미 반도체 강세 사이, 방산은 밀렸다", recent);
  assert.equal(c.score, -2);
  assert.match(c.reasons[0], /직전 제목과 같은 형태/);
  assert.deepEqual(headlineScore("국내 2차전지 급락, 금은 약세", recent), b);
});

test("takeRecentHeadlines·cleanHeadline: 태그를 벗기고 빈 값을 빼고 앞 n건만", () => {
  assert.equal(cleanHeadline("<strong>코스피</strong>  급락"), "코스피 급락");
  assert.equal(cleanHeadline(null), "");
  assert.deepEqual(takeRecentHeadlines(["<strong>A</strong>, B", "", null, "C", "D", "E", "F", "G"]), ["A, B", "C", "D", "E", "F"]);
  assert.deepEqual(takeRecentHeadlines(["A", "B", "C"], 2), ["A", "B"]);
});

test("평가 기준(측정용 시스템 문구)은 기준선을 잰 문구와 글자 하나까지 같다", () => {
  assert.equal(HEADLINE_JUDGE_SYSTEM, `당신은 한국 종합경제지(한국경제·매일경제·연합뉴스 경제부) 증권면 데스크입니다. 매일 아침 개인 투자자용 시황 리포트 제목을 검토합니다.
기준:
- 자연스러움(1~5): 한국어 화자가 증권 기사 제목으로 읽을 때 자연스러운가. 감점 요인 — 영어 직역투(rally를 '달렸다'로 옮긴 듯한 표현), 대상 없는 어색한 의인화('채권이 받쳤다'처럼 무엇을 받쳤는지 없는 경우), 어울리지 않는 낱말 짝(연어), 과장. 한국 경제 기사에서 통용되는 관용적 은유(숨 고르기·훈풍·찬물·발목·급제동·떠받치다(지수를) 등)가 자연스럽게 쓰였으면 감점하지 않는다. 은유 자체는 나쁘지 않다.
- 명확성(1~5): 주식 경험이 조금 있는 개인 투자자가 무엇이 어느 방향으로 얼마나 움직였는지 한 번에 아는가.
- causalAssertion(true/false): 제목이 확인하기 어려운 인과(A가 B를 눌렀다·끌어올렸다 등)를 단정하는가.
- issues: 어색하거나 문제가 있는 표현만. type은 "직역투" | "어색한 의인화" | "어울리지 않는 연어" | "과장" | "근거 없는 인과 단정" | "상투적 틀" | "모호함" | "기타" 중 하나. phrase는 문제 구절, why는 한 문장 이유, suggestion은 같은 사실을 자연스럽게 쓴 대안 제목.
문제가 없으면 issues는 빈 배열. 결과는 report 도구로 낸다.`);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx tsx --test lib/headline-editorial.test.ts`
Expected: FAIL, `Cannot find module './headline-editorial'`.

- [ ] **Step 4: 구현한다** — `lib/headline-editorial.ts`

```ts
// lib/headline-editorial.ts
//
// 제목 편집 기준 단일 소스(2026-10-27, docs/superpowers/specs/2026-10-27-headline-editorial-design.md) — Market·ETF 공통.
// 형태 분류·끝 어절·어휘 겹침·최근 형태 통계·후보 점수·측정 지표·평가 기준(rubric)을 한곳에 둔다.
// 측정 스크립트(scripts/headline-quality.ts)·예시 순환(voice-exemplars)·후보 점수(headline-selection)가 같은 함수를 써서
// 운영이 감점하는 것과 측정이 재는 것이 어긋나지 않게 한다.

export type HeadlineForm =
  | "A하는 사이 B"
  | "~한 날/밤"
  | "예고형(답한다·변수·시험대·숙제)"
  | "말줄임 이음(…)"
  | "쉼표 두 토막"
  | "단문";

// 기준선(2026-10-27)과 같은 정규식·순서 — 바꾸면 기준선과 비교할 수 없다(headline-editorial.test.ts 회귀 검사).
const FORM_RULES: ReadonlyArray<readonly [Exclude<HeadlineForm, "단문">, RegExp]> = [
  ["A하는 사이 B", /사이[,，]?\s|사이$/],
  ["~한 날/밤", /(?:날|밤|하루)[,，]|(?:날|밤)$/],
  ["예고형(답한다·변수·시험대·숙제)", /답한다|답할|시험대|변수|숙제|가늠자/],
  ["말줄임 이음(…)", /…|\.\.\./],
  ["쉼표 두 토막", /[,，]/],
];

// 측정용 — 사물(자산·지수)을 사람처럼 움직이는 동사. 금지 목록이 아니라 빈도를 보려는 것이다(차단에 쓰지 않는다).
const PERSONIFIED = /달렸|달리는|받쳤|떠받|버텼|버티|눌렀|짓눌|이끌었|끌어올|끌어내|앞서갔|앞서|뒤처졌|무너졌|무너지|주저앉|답한다|내밀|심다|흔들리|직격|발목/;

export function headlineForm(h: string): HeadlineForm {
  for (const [name, re] of FORM_RULES) if (re.test(h)) return name;
  return "단문";
}

export type EndingType = "동사·형용사(~다)" | "명사형" | "기타";

export function headlineEnding(h: string): { word: string; type: EndingType } {
  const w = (h.trim().match(/(\S+)$/)?.[1] ?? "").replace(/[.!?…]+$/, "");
  if (/다$/.test(w)) return { word: w, type: "동사·형용사(~다)" };
  if (/[가-힣]$/.test(w)) return { word: w, type: "명사형" };
  return { word: w, type: "기타" };
}

export function headlineTokens(h: string): Set<string> {
  return new Set(h.replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((t) => t.length >= 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  return a.size + b.size - inter === 0 ? 0 : inter / (a.size + b.size - inter);
}

/** 인덱스·로그의 제목을 비교용 평문으로 — 태그를 벗기고 공백을 하나로. 문자열이 아니면 ''. */
export function cleanHeadline(h: unknown): string {
  return typeof h === "string" ? h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

export const RECENT_HEADLINE_WINDOW = 5;

/** 최신순 제목 목록에서 비교에 쓸 최근 n건(평문, 빈 값 제외). 오늘 날짜를 빼는 것은 호출자 몫. */
export function takeRecentHeadlines(headlines: readonly unknown[], n: number = RECENT_HEADLINE_WINDOW): string[] {
  return headlines.map(cleanHeadline).filter(Boolean).slice(0, n);
}

export const DOMINANT_FORM_MIN = 3;

export interface RecentFormStats {
  previous: HeadlineForm | null; // 직전(가장 최근) 제목의 형태
  dominant: HeadlineForm | null; // 최근 제목에서 DOMINANT_FORM_MIN번 이상 쓴 형태(여럿이면 가장 많은 것)
  counts: Map<HeadlineForm, number>;
}

/** recent: 최신순. */
export function recentFormStats(recent: readonly string[]): RecentFormStats {
  const counts = new Map<HeadlineForm, number>();
  for (const h of recent) {
    const f = headlineForm(h);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let dominant: HeadlineForm | null = null;
  for (const [f, c] of counts) {
    if (c >= DOMINANT_FORM_MIN && (dominant === null || c > (counts.get(dominant) ?? 0))) dominant = f;
  }
  return { previous: recent.length > 0 ? headlineForm(recent[0]) : null, dominant, counts };
}

export const SCORE_PENALTY = { sameFormAsPrevious: 2, dominantForm: 1, repeatedEnding: 1, lexicalOverlap: 1 } as const;
export const LEXICAL_OVERLAP_MIN = 0.3;

/** 후보 제목의 최근 반복 감점(0이 가장 좋고 음수일수록 나쁘다). recent: 최신순 최근 제목. 같은 입력이면 같은 값. */
export function headlineScore(h: string, recent: readonly string[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const form = headlineForm(h);
  const stats = recentFormStats(recent);
  if (stats.previous === form) {
    score -= SCORE_PENALTY.sameFormAsPrevious;
    reasons.push(`직전 제목과 같은 형태(${form})`);
  }
  if (stats.dominant === form) {
    score -= SCORE_PENALTY.dominantForm;
    reasons.push(`최근 ${stats.counts.get(form)}번 쓴 형태(${form})`);
  }
  const ending = headlineEnding(h).word;
  if (ending && recent.some((r) => headlineEnding(r).word === ending)) {
    score -= SCORE_PENALTY.repeatedEnding;
    reasons.push(`최근 제목과 같은 끝 어절(${ending})`);
  }
  const t = headlineTokens(h);
  const overlap = recent.length > 0 ? Math.max(...recent.map((r) => jaccard(t, headlineTokens(r)))) : 0;
  if (overlap >= LEXICAL_OVERLAP_MIN) {
    score -= SCORE_PENALTY.lexicalOverlap;
    reasons.push(`최근 제목과 어휘 겹침 ${overlap.toFixed(2)}`);
  }
  return { score, reasons };
}

export interface HeadlineCodeMetrics {
  n: number;
  structures: Array<[string, number]>;
  endingTypes: Array<[string, number]>;
  topEndings: Array<[string, number]>;
  repeatEndingRate: number;
  sameStructurePrevRate: number;
  personifiedRate: number;
  commaRate: number;
  avgMaxOverlapPrev5: number;
}

/** 측정 지표 — headlines는 오래된 것부터(날짜 오름차순). 기준선(2026-10-27)과 같은 계산이다. */
export function headlineCodeMetrics(headlines: readonly string[]): HeadlineCodeMetrics {
  const structures = new Map<string, number>();
  const endings = new Map<string, number>();
  const endingTypes = new Map<string, number>();
  let repeatEnding = 0, sameStructurePrev = 0, personified = 0, overlapSum = 0, withComma = 0;
  headlines.forEach((h, i) => {
    const s = headlineForm(h);
    const e = headlineEnding(h);
    structures.set(s, (structures.get(s) ?? 0) + 1);
    endings.set(e.word, (endings.get(e.word) ?? 0) + 1);
    endingTypes.set(e.type, (endingTypes.get(e.type) ?? 0) + 1);
    if (PERSONIFIED.test(h)) personified++;
    if (/[,，]/.test(h)) withComma++;
    const prev5 = headlines.slice(Math.max(0, i - 5), i);
    if (prev5.some((p) => headlineEnding(p).word === e.word)) repeatEnding++;
    if (i > 0 && headlineForm(headlines[i - 1]) === s) sameStructurePrev++;
    const t = headlineTokens(h);
    overlapSum += prev5.length ? Math.max(...prev5.map((p) => jaccard(t, headlineTokens(p)))) : 0;
  });
  const n = headlines.length;
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    n,
    structures: sorted(structures),
    endingTypes: sorted(endingTypes),
    topEndings: sorted(endings).slice(0, 8),
    repeatEndingRate: repeatEnding / n,
    sameStructurePrevRate: sameStructurePrev / Math.max(1, n - 1),
    personifiedRate: personified / n,
    commaRate: withComma / n,
    avgMaxOverlapPrev5: overlapSum / n,
  };
}

// 평가 기준 — 기준선 측정(scripts/headline-quality.ts)과 운영 편집자(headline-selection.ts)가 같은 글을 쓴다.
export const HEADLINE_DESK = `당신은 한국 종합경제지(한국경제·매일경제·연합뉴스 경제부) 증권면 데스크입니다. 매일 아침 개인 투자자용 시황 리포트 제목을 검토합니다.`;

export const HEADLINE_RUBRIC = `- 자연스러움(1~5): 한국어 화자가 증권 기사 제목으로 읽을 때 자연스러운가. 감점 요인 — 영어 직역투(rally를 '달렸다'로 옮긴 듯한 표현), 대상 없는 어색한 의인화('채권이 받쳤다'처럼 무엇을 받쳤는지 없는 경우), 어울리지 않는 낱말 짝(연어), 과장. 한국 경제 기사에서 통용되는 관용적 은유(숨 고르기·훈풍·찬물·발목·급제동·떠받치다(지수를) 등)가 자연스럽게 쓰였으면 감점하지 않는다. 은유 자체는 나쁘지 않다.
- 명확성(1~5): 주식 경험이 조금 있는 개인 투자자가 무엇이 어느 방향으로 얼마나 움직였는지 한 번에 아는가.
- causalAssertion(true/false): 제목이 확인하기 어려운 인과(A가 B를 눌렀다·끌어올렸다 등)를 단정하는가.`;

const JUDGE_ISSUES = `- issues: 어색하거나 문제가 있는 표현만. type은 "직역투" | "어색한 의인화" | "어울리지 않는 연어" | "과장" | "근거 없는 인과 단정" | "상투적 틀" | "모호함" | "기타" 중 하나. phrase는 문제 구절, why는 한 문장 이유, suggestion은 같은 사실을 자연스럽게 쓴 대안 제목.`;

/** 측정 스크립트의 시스템 문구 — 기준선(2026-10-27)과 글자 하나까지 같아야 한다. */
export const HEADLINE_JUDGE_SYSTEM = `${HEADLINE_DESK}
기준:
${HEADLINE_RUBRIC}
${JUDGE_ISSUES}
문제가 없으면 issues는 빈 배열. 결과는 report 도구로 낸다.`;
```

- [ ] **Step 5: 측정 스크립트가 lib를 쓰게 바꾼다** — `scripts/headline-quality.ts`

`scripts/headline-quality.ts`에서 아래를 지운다.
- `const STRUCTURES …` 배열
- `const PERSONIFIED …`
- `function structureOf`, `function endingOf`
- `const tokens`, `function jaccard`, `function codeMetrics`
- `const JUDGE_SYSTEM = …` 문자열

`pct`·`Judged`·`JUDGE_SCHEMA`·`judge`·`arg`·`main`은 남긴다. 그다음 세 곳을 고친다.

```ts
// import 줄들 아래에 추가
import { headlineCodeMetrics, HEADLINE_JUDGE_SYSTEM } from "../lib/headline-editorial";
```

```ts
// main() 안: const metrics = … 줄을 이것으로
  const metrics = { ETF: headlineCodeMetrics(sets.ETF.map((i) => i.headline)), Market: headlineCodeMetrics(sets.Market.map((i) => i.headline)) };
```

```ts
// judge() 안 messages.create 인자: system: JUDGE_SYSTEM → system: HEADLINE_JUDGE_SYSTEM
        model, max_tokens: 16000, system: HEADLINE_JUDGE_SYSTEM,
```

파일 첫머리 주석의 "코드 지표:" 줄 뒤에 한 줄을 추가한다: `//   (분류기·지표·평가 기준은 lib/headline-editorial.ts — 운영 후보 점수와 같은 함수)`.

- [ ] **Step 6: 통과를 확인한다**

Run: `npx tsx --test lib/headline-editorial.test.ts`
Expected: PASS (6 tests)

Run: `npx tsx scripts/headline-quality.ts --n 60 --out /tmp/hq-check > /dev/null && node -e 'const a=require("/tmp/hq-check.json").metrics,b=require("./docs/quality/headline-baseline-2026-10-27.json").metrics; console.log(JSON.stringify(a)===JSON.stringify(b))'`
Expected: `true`. 구현일에 데이터가 늘어 다르면 `--n` 대신 픽스처로 확인한 Step 6의 첫 테스트를 기준으로 삼는다.

Run: `npm test && npm run typecheck`
Expected: 모두 통과

- [ ] **Step 7: 커밋한다**

```bash
git add lib/headline-editorial.ts lib/headline-editorial.test.ts lib/__fixtures__/headline-baseline-2026-10-27.json scripts/headline-quality.ts
git commit -m "$(cat <<'EOF'
feat: 제목 형태 분류·점수·측정 지표 단일 소스(lib/headline-editorial)

측정 스크립트의 분류기·지표·평가 기준을 lib로 옮겨 운영 후보 점수와
측정이 같은 함수를 쓰게 한다. 기준선 60건 픽스처로 수치 재현을 고정.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 공통 편집 기준 문구와 예시 순환

**Files:**
- Modify: `lib/headline-editorial.ts` (기준 문구·최근 제목 줄 추가)
- Modify: `lib/voice-exemplars.ts` (고정 제목 예시 → 풀·순환, 목표 보이스 블록에서 제목 예시 제거)
- Modify: `lib/voice-exemplars.test.ts` (전면 교체)
- Modify: `lib/headline-editorial.test.ts` (테스트 추가)
- Modify: `lib/market-prompt-freeze.test.ts` (테스트 이름), `lib/__fixtures__/market-prompt-freeze.json` (`voice` 재생성)

**Interfaces:**
- Consumes: Task 1의 `headlineForm`, `recentFormStats`, `type HeadlineForm`.
- Produces:
  - `headline-editorial.ts`:
    - `type HeadlineTarget = "market" | "etf"`
    - `NATURALNESS_PAIRS`
    - `renderHeadlineStandard(): string` — 첫 줄은 `[제목 편집 기준 — Market·ETF 공통]`.
    - `renderRecentHeadlineLines(recent: readonly string[]): string` — recent가 비면 `''`.
  - `voice-exemplars.ts`:
    - `type HeadlineStyle`, `interface HeadlineExemplar { text; note; style }`
    - `MARKET_HEADLINE_POOL`, `ETF_HEADLINE_POOL`, `HEADLINE_EXEMPLARS_PER_DAY = 4`
    - `pickHeadlineExemplars(target: VoiceTarget, recent: readonly string[], date: string): HeadlineExemplar[]`
    - `renderHeadlineExemplars(picked: readonly HeadlineExemplar[]): string` — 첫 줄은 `[오늘 참고할 제목 예시`로 시작한다.
    - `renderVoiceExemplars(target)` — 제목 예시 없이.
  - `HEADLINE_EXEMPLARS`·`ETF_HEADLINE_EXEMPLARS` export는 없어진다(사용처는 테스트뿐).

**Ruling (스펙 §2):** 측정 분류기로는 풀에 넣을 만한 형태가 넷뿐이다. 그래서 4개가 서로 달라야 하는 기준은 사람이 붙인 `style`이다. 제외 규칙(직전·우세)은 분류기 `form`으로 본다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/voice-exemplars.test.ts` 전체를 아래로 바꾼다.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderVoiceExemplars, pickHeadlineExemplars, renderHeadlineExemplars,
  MARKET_HEADLINE_POOL, ETF_HEADLINE_POOL, HEADLINE_EXEMPLARS_PER_DAY, type HeadlineStyle,
} from "./voice-exemplars";
import { headlineForm } from "./headline-editorial";
import { comparativeClaimViolations } from "./comparative-claims";
import { findHardAdvice, findSoftAdvice } from "./compliance";

const STYLES: HeadlineStyle[] = ["단문 사실형", "원인형", "배경·동시형", "대비형", "수치 강조형", "명사형 종결", "예고형", "말줄임 이음", "쉼표 두 토막"];

test("목표 보이스 블록: 원칙·본문 예시·표현 반례만 — 제목 예시는 사용자 프롬프트의 순환 예시로 옮겼다", () => {
  const block = renderVoiceExemplars();
  assert.match(block, /진부한 비유와 반복되는 구문 틀은 피하라/);
  assert.match(block, /그린 \[지도/);
  assert.ok(block.includes("괴리율 확대가 체결 비용을 조용히 갉아먹습니다"));
  assert.match(block, /\[제목 편집 기준\]/);
  assert.ok(!block.includes("### 지향할 헤드라인 결"));
  assert.ok(!block.includes("금리 올린 연준, 달러만 웃었다"));
  assert.ok(!block.includes("특히 **제목은 한국 신문 편집자가 쓰듯"));
  const etf = renderVoiceExemplars("etf");
  assert.ok(!etf.includes("원화, 하루 만에 20원 되찾다"));
  assert.ok(etf.includes("한 주를 닫다"));          // ETF 표현 반례 유지
  assert.ok(!etf.includes("데이터피드형 제목"));     // market 형태 반례는 ETF에 없음(기존 결정)
});

test("예시 풀: 기존 예시를 모두 담는다(ETF는 2026-09-30 사용자가 고른 6개)", () => {
  const etf = ETF_HEADLINE_POOL.map((e) => e.text);
  for (const t of ["원화, 하루 만에 20원 되찾다", "금 급락·반도체 하락, 방어 우위 국면 진입", "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화",
    "반도체 직격, 방어주가 버텼다", "미 국채 5% 벽, 원화가 먼저 무너졌다", "무디스 성장률 3.5% 상향, 반도체가 국내 주도"]) assert.ok(etf.includes(t), t);
  const market = MARKET_HEADLINE_POOL.map((e) => e.text);
  for (const t of ["금리 올린 연준, 달러만 웃었다", "반도체 빈자리, 통신·금융이 메웠다", "SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다",
    "삼성·SK, 코스피 급락에도 충청 392조 투자"]) assert.ok(market.includes(t), t);
});

test("예시 풀: 항목 모양·다양성·정확성 검사와의 정합", () => {
  for (const pool of [MARKET_HEADLINE_POOL, ETF_HEADLINE_POOL]) {
    assert.ok(pool.length >= 18);
    assert.equal(new Set(pool.map((e) => e.text)).size, pool.length, "중복 예시");
    assert.ok(new Set(pool.map((e) => headlineForm(e.text))).size >= 3, "형태 3종 이상");
    assert.ok(new Set(pool.map((e) => e.style)).size >= 7, "문형 7종 이상");
    for (const e of pool) {
      assert.ok(STYLES.includes(e.style), e.text);
      assert.ok(e.note.length > 0, e.text);
      // 반례 형태('~사이'·'~한 날/밤')는 예시에 넣지 않는다
      assert.ok(!["A하는 사이 B", "~한 날/밤"].includes(headlineForm(e.text)), e.text);
      // 예시가 검사에 걸리는 표현을 가르치지 않는다
      assert.deepEqual(comparativeClaimViolations([["예시", e.text]]), [], e.text);
      assert.deepEqual([...findHardAdvice(e.text), ...findSoftAdvice(e.text)], [], e.text);
    }
  }
});

test("pickHeadlineExemplars: 날마다 4개, 문형이 모두 다르고, 같은 날짜·같은 최근 제목이면 같은 결과", () => {
  const recent = ["코스피 3.7% 하락, 금통위 주목", "나스닥 1.9% 하락", "삼성전자 실적, 코스피 혼조", "환율 1,400원, 외국인 매도"];
  const a = pickHeadlineExemplars("market", recent, "2026-11-02");
  assert.equal(a.length, HEADLINE_EXEMPLARS_PER_DAY);
  assert.equal(new Set(a.map((e) => e.style)).size, a.length);
  assert.deepEqual(pickHeadlineExemplars("market", recent, "2026-11-02"), a);
  // 직전 형태(쉼표)와 우세 형태(쉼표 3건)는 빠진다
  for (const e of a) assert.notEqual(headlineForm(e.text), "쉼표 두 토막", e.text);
  // 다른 날짜는 (대개) 다른 조합 — 열흘 중 적어도 두 가지 조합
  const combos = new Set(["03", "04", "05", "06", "09", "10", "11", "12", "13", "16"].map((d) => pickHeadlineExemplars("market", recent, `2026-11-${d}`).map((e) => e.text).join("|")));
  assert.ok(combos.size >= 2);
});

test("pickHeadlineExemplars: 남는 예시가 4개보다 적으면 '우세' 제외부터 푼다", () => {
  // 직전=단문, 우세=쉼표 → ETF 풀에서 단문·쉼표를 빼면 말줄임 3 + 예고 1 = 4개 → 그대로 4개
  const recent = ["국내 반도체 ETF 급락", "A, B", "C, D", "E, F"];
  const etf = pickHeadlineExemplars("etf", recent, "2026-11-02");
  assert.equal(etf.length, 4);
  for (const e of etf) assert.ok(!["단문", "쉼표 두 토막"].includes(headlineForm(e.text)), e.text);
  // 최근 제목이 없으면 제외 없이 4개
  assert.equal(pickHeadlineExemplars("etf", [], "2026-11-02").length, 4);
});

test("renderHeadlineExemplars: 머리 줄과 예시·문형·노트", () => {
  const picked = pickHeadlineExemplars("etf", [], "2026-11-02");
  const block = renderHeadlineExemplars(picked);
  assert.match(block, /^\[오늘 참고할 제목 예시/);
  for (const e of picked) assert.ok(block.includes(`"${e.text}" (${e.style}) — ${e.note}`));
});
```

`lib/headline-editorial.test.ts` 끝에 추가한다(import 줄에 `renderHeadlineStandard, renderRecentHeadlineLines, NATURALNESS_PAIRS`를 더한다).

```ts
test("renderHeadlineStandard: 우선순위 넷·자연스러움 쌍·인과 기준·형태 목록·후보 세 개", () => {
  const s = renderHeadlineStandard();
  assert.match(s, /^\[제목 편집 기준 — Market·ETF 공통\]/);
  assert.ok(s.indexOf("1. 명확성") < s.indexOf("2. 자연스러운 한국어"));
  assert.ok(s.indexOf("2. 자연스러운 한국어") < s.indexOf("3. 인과는 입력에 근거가 있을 때만"));
  assert.ok(s.indexOf("3. 인과는") < s.indexOf("4. 변주"));
  for (const [a, b] of NATURALNESS_PAIRS) assert.ok(s.includes(`"${a}" → "${b}"`));
  assert.match(s, /strong — .*\/ thin — .*\/ hollow — /);
  assert.match(s, /cover\.headlineCandidates에 제목 후보 세 개/);
  assert.ok(!s.includes("[제목 작성 규칙]")); // 두 프롬프트의 블록 이름과 겹치지 않게
});

test("renderRecentHeadlineLines: 최신순 제목에 형태를 붙이고 피할 형태를 알린다", () => {
  assert.equal(renderRecentHeadlineLines([]), "");
  const block = renderRecentHeadlineLines(["A, B", "C, D", "E, F", "G 급락"]);
  const lines = block.split("\n");
  assert.equal(lines[0], "- A, B 〔쉼표 두 토막〕");
  assert.equal(lines[3], "- G 급락 〔단문〕");
  assert.match(lines[4], /^오늘 제목은 이 형태를 피하십시오: 쉼표 두 토막 \(직전 제목의 형태, 최근 4건 중 3건이 쓴 형태\)\.$/);
  assert.match(renderRecentHeadlineLines(["G 급락"]), /피하십시오: 단문 \(직전 제목의 형태\)\.$/);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test lib/voice-exemplars.test.ts lib/headline-editorial.test.ts`
Expected: FAIL. 없는 export(`pickHeadlineExemplars`, `renderHeadlineStandard` 등) 때문이다.

- [ ] **Step 3: 기준 문구를 구현한다** — `lib/headline-editorial.ts` 끝에 추가

```ts
export type HeadlineTarget = "market" | "etf";

/** 자연스러움 기준을 보여 주는 쌍 — 금지어가 아니다. 2026-10-27 기준선 평가의 대안 열에서 골랐다. */
export const NATURALNESS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["미 반도체가 달렸다", "미 반도체 ETF 강세"],
  ["원유·채권이 받쳤다", "원유·채권 ETF는 강세"],
  ["연준 인상에 달러 올랐다", "연준 금리 인상에 달러 강세"],
  ["재도전 앞에 서다", "7100선 재탈환 노린다"],
  ["금통위가 내일 답한다", "내일 금통위 기준금리 결정 주목"],
];

const FORM_REPERTOIRE: readonly string[] = [
  `단문 사실형 — "미 반도체 ETF 4.5% 급락"`,
  `원인형(입력 근거가 있을 때만) — "삼성전자 깜짝 실적에 국내 반도체 ETF 강세"`,
  `배경·동시형 — "미 수출규제 우려 속 2차전지 ETF 급락", "호실적에도 코스피 하락"`,
  `대비형 — "S&P500 오르고 코스피 내려"`,
  `수치 강조형 — "원·달러 환율 하루 새 20원 급락"`,
  `명사형 종결 — "금통위 앞둔 코스피 숨 고르기"`,
  `말줄임 이음 — "방산 ETF 5% 하락…미 반도체는 강세"`,
  `쉼표 두 토막 — "반도체 빈자리, 통신·금융이 메웠다"`,
  `예고형 — "다음 변수는 SK하이닉스 실적"`,
];

/** 두 리포트의 제목 규칙 칸 맨 앞에 넣는 공통 기준(스펙 §1). 순서가 곧 우선순위다. */
export function renderHeadlineStandard(): string {
  return `[제목 편집 기준 — Market·ETF 공통]
제목은 개장 전 개인 고객이 가장 먼저 읽는 한 줄입니다. 아래 순서로 판단하고, 앞의 기준이 뒤의 기준보다 우선합니다.

1. 명확성 — 제목만 읽어도 어느 시장의 무엇이 어느 방향으로 움직였는지 알아야 합니다. 주어는 실제로 움직인 자산·지수·종목입니다. 무엇을 가리키는지 흐린 줄임말은 풀어 씁니다(예: "연준 인상" → "연준 금리 인상").
2. 자연스러운 한국어 — 경제신문 증권면 제목에서 실제로 쓰는 어휘와 낱말 짝으로 씁니다. 비유는 한국어 제목에서 자연스럽게 읽히면 씁니다(숨 고르기·훈풍·찬물·발목 같은 관용 표현). 영어를 옮긴 듯한 표현, 무엇을 했는지 대상이 없는 의인화, 어울리지 않는 낱말 짝은 피합니다. 같은 사실이 이렇게 읽힙니다:
${NATURALNESS_PAIRS.map(([a, b]) => `   · "${a}" → "${b}"`).join("\n")}
3. 인과는 입력에 근거가 있을 때만 — "…에", "…로" 같은 인과 연결은 입력(수치·기사)이 그 원인을 뒷받침할 때만 씁니다. 근거가 없으면 두 사실을 나란히 놓습니다("A 급락, B는 강세", "A 속 B"). 조사만 바꾼다고 근거가 생기지 않습니다. 근거 상태(tier)별로: strong — 입력 근거가 있는 인과 표현까지 / thin — 인과를 단정하지 말고 나란히 / hollow — 절제된 사실만.
4. 변주 — 같은 형태를 연일 쓰지 않습니다. 쓸 수 있는 형태(할당량은 없습니다. 오늘 사실에 가장 잘 맞는 것을 고르되, 최근 제목에 많이 쓴 형태는 피합니다):
${FORM_REPERTOIRE.map((f) => `   · ${f}`).join("\n")}

후보 세 개: cover.headlineCandidates에 제목 후보 세 개를 { "headline", "subline" } 짝으로 씁니다.
- 세 후보는 모두 같은 오늘의 주제를 다루고, 형태는 서로 다르게 씁니다.
- subline은 그 제목이 뺀 사건명·수치를 받칩니다(후보마다 따로 씁니다).
- 코드가 정확성 검사를 통과한 후보를 추리고, 편집자가 자연스러움·명확성으로 하나를 고릅니다. 세 후보 모두 아래 제목 규칙을 지켜야 합니다.`;
}

/** 프롬프트에 넣는 최근 제목 줄(최신순, 〔형태〕) + 피할 형태 안내. recent가 비면 ''. */
export function renderRecentHeadlineLines(recent: readonly string[]): string {
  if (recent.length === 0) return "";
  const stats = recentFormStats(recent);
  const lines = recent.map((h) => `- ${h} 〔${headlineForm(h)}〕`);
  const avoid = [...new Set([stats.previous, stats.dominant].filter((f): f is HeadlineForm => f !== null))];
  const why = stats.dominant
    ? `직전 제목의 형태, 최근 ${recent.length}건 중 ${stats.counts.get(stats.dominant)}건이 쓴 형태`
    : "직전 제목의 형태";
  lines.push(`오늘 제목은 이 형태를 피하십시오: ${avoid.join(", ")} (${why}).`);
  return lines.join("\n");
}
```

직전 형태와 우세 형태가 다르면 `why` 문구는 둘을 쉼표로 나열한다. 테스트는 같은 경우와 우세가 없는 경우를 본다.

- [ ] **Step 4: 예시 풀·순환을 구현한다** — `lib/voice-exemplars.ts`

1. 파일 머리 import에 추가한다: `import { headlineForm, recentFormStats, type HeadlineForm } from "./headline-editorial";`
2. `export const HEADLINE_EXEMPLARS …` 블록 전체와 그 위 2026-07-02 주석, 그리고 `export const ETF_HEADLINE_EXEMPLARS …` 블록과 그 위 2026-09-30 주석을 지운다.
3. 지운 자리(`BODY_EXEMPLARS` 위)에 아래를 넣는다.

```ts
// 2026-10-27 제목 편집 기준(스펙 §2): 고정 예시 10개 중 9개가 "A, B" 두 토막이라 모델이 같은 틀을 반복했다.
// 리포트별 풀에 문형(style)을 붙여 두고, 날마다 문형이 다른 4개를 날짜 시드로 골라 사용자 프롬프트의 제목 규칙 칸에 넣는다.
// form(측정 분류)은 headlineForm(text)로 계산한다 — 따로 적지 않아 어긋날 일이 없다.
export type HeadlineStyle =
  | "단문 사실형" | "원인형" | "배경·동시형" | "대비형" | "수치 강조형" | "명사형 종결" | "예고형" | "말줄임 이음" | "쉼표 두 토막";

export interface HeadlineExemplar extends VoiceExemplar {
  style: HeadlineStyle;
}

export const MARKET_HEADLINE_POOL: HeadlineExemplar[] = [
  // 2026-07-02 큐레이션 — 노트 유지
  { text: "금리 올린 연준, 달러만 웃었다", style: "쉼표 두 토막", note: "주어(연준·달러)를 앞세우고 '달러만 웃었다'로 자연스러운 의인화. 종속절('~한 밤,') 없이 압축." },
  { text: "반도체 빈자리, 통신·금융이 메웠다", style: "쉼표 두 토막", note: "'빈자리/메우다' 이미지를 한 호흡에. 기사체 종결, 한국 신문 제목 결." },
  { text: "SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다", style: "말줄임 이음", note: "핵심 사건을 앞세우고 '엇갈렸다'로 종목 움직임을 자연스러운 한 단어에(번역투 '두 방향으로 갈라놓았다' 아님)." },
  { text: "삼성·SK, 코스피 급락에도 충청 392조 투자", style: "배경·동시형", note: "은유 없이 사실 대비(급락↔투자)만으로 후크. 모든 제목에 비유가 필요한 건 아니다." },
  // 2026-10-27 추가 — 기준선 평가의 대안·자연스러운 제목에서
  { text: "SK하이닉스 6% 급락", style: "단문 사실형", note: "주어와 움직임만. 가장 짧은 신문 제목." },
  { text: "연준 금리 인상에 달러 강세", style: "원인형", note: "원인이 입력(연준 결정)으로 확인될 때만 '…에'. 줄임말 없이 무엇이 올랐는지 분명히." },
  { text: "CPI 예상 상회에 나스닥 1.9% 하락", style: "원인형", note: "발표 사실과 지수 움직임을 쉼표 없이 한 호흡에." },
  { text: "삼성전자 깜짝 실적에 반도체주 강세", style: "원인형", note: "원인(실적 발표)이 입력 기사로 확인될 때만 쓰는 결." },
  { text: "미 기술주 약세 여파 속 코스피 3.5% 하락", style: "배경·동시형", note: "'~ 속'으로 배경을 깔고 핵심 사실로 끝맺음. 인과를 단정하지 않는다." },
  { text: "외국인 매도 속 코스피 2% 하락", style: "배경·동시형", note: "가장 짧은 배경형. 수급 수치가 입력에 있을 때." },
  { text: "삼성전자 호실적에도 코스피 하락", style: "배경·동시형", note: "'~에도'로 기대와 다른 결과를 대비. 단정 없이 사실 둘." },
  { text: "S&P500 오르고 코스피 내려", style: "대비형", note: "두 시장의 엇갈림을 동사 대구로. 시장 이름을 모두 밝힌다." },
  { text: "나스닥 반등…코스피는 전날 먼저 올라", style: "대비형", note: "'이미 앞서갔다' 대신 언제 무엇이 올랐는지 그대로." },
  { text: "코스피 349포인트 급락", style: "수치 강조형", note: "숫자 자체가 뉴스인 날. 군더더기 없이 규모만." },
  { text: "원·달러 환율 하루 새 20원 급락", style: "수치 강조형", note: "'원화가 되찾다' 같은 연어 대신 환율 숫자로 방향을 분명히." },
  { text: "미 국채 10년물 금리 5.24%…코스피 191포인트 하락", style: "말줄임 이음", note: "어느 국채 금리인지 밝히고 두 사실을 말줄임표로 잇는다." },
  { text: "트럼프 수입차 관세 50% 예고…현대차 기대 흔들", style: "말줄임 이음", note: "사건(관세 예고)과 영향을 잇되 영향은 단정하지 않는 말로." },
  { text: "금통위 앞둔 코스피 숨 고르기", style: "명사형 종결", note: "관용 은유 '숨 고르기'를 명사형으로. 일정이 핵심인 날." },
  { text: "코스피 5.5% 급락, 6,000선 턱밑까지", style: "쉼표 두 토막", note: "쉼표는 숫자와 위치처럼 두 사실을 나눌 때만." },
  { text: "코스피 3.3% 반등, 오늘 오전 10시 기준금리 결정", style: "예고형", note: "어제 사실 + 오늘 일정. '금통위가 답한다' 같은 의인화 없이 시각을 밝힌다." },
  { text: "다음 변수는 SK하이닉스 3분기 실적", style: "예고형", note: "잠잠한 날의 절제된 사실형. 무엇을 볼지 한 가지만." },
];

export const ETF_HEADLINE_POOL: HeadlineExemplar[] = [
  // 2026-09-30 사용자가 실제 발송본에서 고른 6개 — 노트 유지
  { text: "원화, 하루 만에 20원 되찾다", style: "쉼표 두 토막", note: "주어 + 기사체 현재형. 가장 짧은 신문 제목 결." },
  { text: "금 급락·반도체 하락, 방어 우위 국면 진입", style: "명사형 종결", note: "사실을 나열하고 서술성 명사('진입')로 끝맺음. 티커 없이 한국어 명칭." },
  { text: "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화", style: "말줄임 이음", note: "사실…의미를 말줄임표로 잇고 '본격화'로 끝맺음." },
  { text: "반도체 직격, 방어주가 버텼다", style: "쉼표 두 토막", note: "명사구 + 짧은 주술로 대비를 압축." },
  { text: "미 국채 5% 벽, 원화가 먼저 무너졌다", style: "쉼표 두 토막", note: "분기점 숫자를 은유('벽') 속에 녹임 — strong 근거일 때의 결." },
  { text: "무디스 성장률 3.5% 상향, 반도체가 국내 주도", style: "명사형 종결", note: "출처 있는 사건을 앞세우고 서술성 명사('주도')로 끝맺음." },
  // 2026-10-27 추가
  { text: "미 반도체 ETF 4.5% 급락", style: "단문 사실형", note: "어느 시장의 무엇이 얼마나 — 셋만으로 한 줄." },
  { text: "국내 반도체 ETF 4%대 급등", style: "수치 강조형", note: "규모가 뉴스인 날. '국내'로 시장을 밝힌다." },
  { text: "미 장기채 ETF 2% 상승", style: "수치 강조형", note: "티커(TLT) 대신 한국어 명칭." },
  { text: "삼성전자 깜짝 실적에 국내 반도체 ETF 강세", style: "원인형", note: "원인(실적 발표)이 입력 기사로 확인될 때만 '…에'." },
  { text: "미 수출규제 우려 속 2차전지·반도체 ETF 동반 급락", style: "배경·동시형", note: "'규제가 눌렀다' 대신 '~ 우려 속'으로 동시에 일어난 일로만." },
  { text: "미 반도체 ETF 4.5% 급락 속 국내 방어주 선방", style: "배경·동시형", note: "'홀로 버텼다'의 과장 없이 '선방'." },
  { text: "대미투자 발표 앞두고 반도체 ETF 강세", style: "배경·동시형", note: "'앞서 달렸다' 같은 직역투 대신 시점과 사실." },
  { text: "국내 증시 숨 고르기 속 배당 ETF 선방", style: "배경·동시형", note: "관용 은유 '숨 고르기'와 시장 표시('국내 증시')." },
  { text: "방산 ETF 5% 하락…미 반도체는 강세", style: "대비형", note: "'~사이, ~가 달렸다' 대신 두 사실을 말줄임표로 대비." },
  { text: "미 바이오·반도체 오르고 유틸리티·부동산은 약세", style: "대비형", note: "해외 섹터에 '미'를 붙여 국내와 헷갈리지 않게." },
  { text: "국내 헬스케어 ETF 강세, 미 반도체 급락과 대조", style: "쉼표 두 토막", note: "쉼표 뒤를 명사형('대조')으로 닫아 산문 술어를 피함." },
  { text: "코스피 3.81% 급락, 반도체가 하락 주도", style: "명사형 종결", note: "'낙폭을 이끌었다' 같은 연어 대신 '하락 주도'." },
  { text: "금 ETF 3% 급락…원자재 약세 확산", style: "말줄임 이음", note: "사실…흐름. 흐름은 입력에서 다른 원자재도 내렸을 때만." },
  { text: "국내 반도체 ETF 급등, 다음 변수는 금통위", style: "예고형", note: "어제 사실 + 오늘 볼 것. '금통위가 답한다' 같은 의인화 없이." },
];

export const HEADLINE_EXEMPLARS_PER_DAY = 4;

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rnd = mulberry32(seedOf(seed));
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 오늘 보여 줄 제목 예시 4개(스펙 §2). recent: 같은 리포트의 최근 제목(최신순, 오늘 제외).
 * 직전 제목의 형태와 최근 3번 이상 쓴 형태는 빼고, 문형(style)이 서로 다르게 날짜 시드로 고른다.
 * 남는 예시가 4개보다 적으면 '우세' 제외부터, 그다음 '직전' 제외를 푼다. 같은 입력이면 같은 결과(dry-run 재현).
 */
export function pickHeadlineExemplars(target: VoiceTarget, recent: readonly string[], date: string): HeadlineExemplar[] {
  const pool = target === "etf" ? ETF_HEADLINE_POOL : MARKET_HEADLINE_POOL;
  const n = HEADLINE_EXEMPLARS_PER_DAY;
  const stats = recentFormStats(recent);
  const tries: Array<Array<HeadlineForm | null>> = [[stats.previous, stats.dominant], [stats.previous], []];
  let allowed: HeadlineExemplar[] = pool;
  for (const excluded of tries) {
    allowed = pool.filter((e) => !excluded.includes(headlineForm(e.text)));
    if (allowed.length >= n) break;
  }
  const shuffled = seededShuffle(allowed, `${target}:${date}`);
  const picked: HeadlineExemplar[] = [];
  for (const e of shuffled) if (picked.length < n && !picked.some((p) => p.style === e.style)) picked.push(e);
  for (const e of shuffled) if (picked.length < n && !picked.includes(e)) picked.push(e);
  return picked;
}

/** 사용자 프롬프트의 제목 규칙 칸에 넣는 오늘의 예시 블록. */
export function renderHeadlineExemplars(picked: readonly HeadlineExemplar[]): string {
  return `[오늘 참고할 제목 예시 — 문형이 서로 다른 ${picked.length}개, 날마다 바뀝니다. 문장을 베끼지 말고 결만 참고하십시오]
${picked.map((e) => `  · "${e.text}" (${e.style}) — ${e.note}`).join("\n")}`;
}
```

4. `renderVoiceExemplars`를 아래로 바꾼다. 제목 예시와 제목 자연스러움 문단을 빼고, 제목은 사용자 메시지의 기준을 따른다고 적는다.

```ts
/** 양 프롬프트(시스템)에 주입할 목표 보이스 블록 — 원칙·본문 예시·표현 반례. 제목 예시는 사용자 프롬프트의 순환 예시(2026-10-27). */
export function renderVoiceExemplars(target: VoiceTarget = "market"): string {
  const antis = target === "etf" ? ETF_ANTI_PATTERN_EXAMPLES : ANTI_PATTERN_EXAMPLES;
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = antis.map((a) => `  · ${a}`).join("\n");
  return `## 목표 보이스 — 예시로 익히기 (규칙보다 이 결을 따르라)

데이터에 진실한 구체적 이미지 하나가 제 몫을 하면 환영한다. 매번 어느 날에나
붙일 수 있는 진부한 비유와 반복되는 구문 틀은 피하라(진부함이란 이런 것:
${TIRED_METAPHOR_HINTS.join(" · ")} 등). 문장·제목의 형태를 변주하라.
제목은 사용자 메시지의 [제목 편집 기준]과 그날의 제목 예시를 따르라.

### 지향할 본문 결
${body}

### 피할 형태 (구조·틀 클리셰)
${anti}`;
}
```

5. `export type VoiceTarget = "market" | "etf";` 선언이 `MARKET_HEADLINE_POOL`보다 아래에 있으면 위로 옮긴다. 타입 선언은 호이스팅되므로 순서 때문에 실패하지는 않지만, 읽는 순서를 위해서다.

- [ ] **Step 5: 의도적 갱신 — market 프롬프트 고정 스냅샷**

`lib/market-prompt-freeze.test.ts`의 첫 테스트 이름을 바꾼다.

`"market 목표 보이스 블록은 묶음 3 이전과 바이트 단위로 같다"`
→ `"market 목표 보이스 블록은 고정 스냅샷과 같다(2026-10-27 제목 예시를 순환 예시로 옮겨 의도적 갱신)"`

그다음 스냅샷을 다시 만들고, `voice` 키만 바뀌었는지 확인한다.

```bash
npx tsx scripts/dev/capture-market-freeze.ts
git diff --stat lib/__fixtures__/market-prompt-freeze.json
node -e 'const {execSync}=require("child_process"); const old=JSON.parse(execSync("git show HEAD:lib/__fixtures__/market-prompt-freeze.json")); const cur=require("./lib/__fixtures__/market-prompt-freeze.json"); console.log(Object.keys(cur).filter(k=>cur[k]!==old[k]))'
```
Expected: `[ 'voice' ]`

- [ ] **Step 6: 통과를 확인한다**

Run: `npx tsx --test lib/voice-exemplars.test.ts lib/headline-editorial.test.ts lib/market-prompt-freeze.test.ts`
Expected: PASS

`lib/etf/claude-client.prompt.test.ts`의 `'ETF 시스템 프롬프트: ETF 예시 세트 …'` 테스트는 이 작업으로 반드시 실패한다. `SYSTEM_PROMPT`가 `renderVoiceExemplars('etf')`를 담는데, 거기서 ETF 제목 예시가 빠지기 때문이다. 그 테스트의 `assert.ok(SYSTEM_PROMPT.includes('원화, 하루 만에 20원 되찾다'))` 한 줄을 `assert.ok(!SYSTEM_PROMPT.includes('### 지향할 헤드라인 결'))`로 바꾼다. 예시는 Task 5에서 사용자 프롬프트로 들어간다.

Run: `npm test && npm run typecheck`
Expected: 통과

- [ ] **Step 7: 커밋한다**

```bash
git add lib/headline-editorial.ts lib/headline-editorial.test.ts lib/voice-exemplars.ts lib/voice-exemplars.test.ts lib/market-prompt-freeze.test.ts lib/__fixtures__/market-prompt-freeze.json lib/etf/claude-client.prompt.test.ts
git commit -m "$(cat <<'EOF'
feat: 공통 제목 편집 기준 문구와 문형별 예시 풀·날짜 순환

명확성→자연스러운 한국어→인과 근거→변주 순의 기준 문구와 최근 제목
형태 안내를 만들고, 고정 제목 예시를 문형이 붙은 풀(리포트별 20여 개)과
날짜 시드 순환으로 바꾼다. 목표 보이스 블록에서는 제목 예시를 뺀다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 후보 선택과 편집자 호출 모듈

**Files:**
- Create: `lib/headline-selection.ts`
- Create: `lib/headline-selection.test.ts`
- Modify: `lib/claude-budget.ts` (`REPORT_MODEL` 상수)
- Modify: `lib/claude-client.ts:808`, `lib/etf/claude-client.ts:94` (모델 문자열 → `REPORT_MODEL`)

**Interfaces:**
- Consumes:
  - Task 1: `headlineForm`, `headlineScore`, `HEADLINE_DESK`, `HEADLINE_RUBRIC`, `type HeadlineForm`
  - Task 2: `type HeadlineTarget`
- Produces:
  - 타입:
    - `interface HeadlineCandidate { headline: string; subline: string }`
    - `interface ScoredHeadline extends HeadlineCandidate { index; form; score; scoreReasons; problems }`
    - `interface HeadlineSelection { scored; survivors; chosen }`
    - `interface HeadlineEditorInput { target; candidates; recent; tier?; subjectName?; evidence }`
    - `interface HeadlineEditorVerdict { pick; scores; reason }`
    - `type HeadlineEditor = (input) => Promise<HeadlineEditorVerdict | null>`
  - 상수: `MAX_HEADLINE_CANDIDATES = 3`, `HEADLINE_EDITOR_TIMEOUT_MS = 30_000`, `HEADLINE_EDITOR_ESTIMATE_MS = 60_000`
  - 함수:
    - `extractHeadlineCandidates(cover: unknown): HeadlineCandidate[]`
    - `applyHeadlineSelection(report: unknown, recent: readonly string[], problemsOf: (c: HeadlineCandidate) => string[], options?: { scoring?: boolean }): HeadlineSelection | null`
    - `headlineSelectionEnabled(env?: NodeJS.ProcessEnv): boolean`
    - `buildHeadlineEditorPrompt(input): string`
    - `parseHeadlineEditorVerdict(raw: unknown, n: number): HeadlineEditorVerdict | null`
    - `callHeadlineEditor: HeadlineEditor`
    - `chooseFinalHeadline<T>(o: FinalHeadlineOptions<T>): Promise<T | null>`
  - `lib/claude-budget.ts`: `REPORT_MODEL`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `lib/headline-selection.test.ts`

```ts
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  extractHeadlineCandidates, applyHeadlineSelection, headlineSelectionEnabled, parseHeadlineEditorVerdict,
  buildHeadlineEditorPrompt, chooseFinalHeadline, type HeadlineEditor, type HeadlineSelection,
} from "./headline-selection";

function quiet(t: TestContext) {
  t.mock.method(console, "log", () => {});
}

test("extractHeadlineCandidates: 후보 목록(앞 3개, 빈 제목 제외·공백 정리)이 옛 cover.headline 보다 우선한다", () => {
  const cover = {
    headline: "옛 제목 필드",
    subline: "옛 부제",
    headlineCandidates: [{ headline: " A ", subline: " a " }, { headline: "", subline: "x" }, null, { headline: "B" }, { headline: "C", subline: "c" }, { headline: "D", subline: "d" }],
  };
  assert.deepEqual(extractHeadlineCandidates(cover), [
    { headline: "A", subline: "a" }, { headline: "B", subline: "" }, { headline: "C", subline: "c" },
  ]);
});

test("extractHeadlineCandidates: 후보가 없으면 옛 cover.headline·subline 을 손대지 않고 후보 하나로, 둘 다 없으면 빈 배열", () => {
  assert.deepEqual(extractHeadlineCandidates({ headline: "옛 제목", subline: " 부제 " }), [{ headline: "옛 제목", subline: " 부제 " }]);
  assert.deepEqual(extractHeadlineCandidates({ headline: "옛 제목", headlineCandidates: [] }), [{ headline: "옛 제목", subline: "" }]);
  assert.deepEqual(extractHeadlineCandidates({ subline: "부제만" }), []);
  assert.deepEqual(extractHeadlineCandidates(null), []);
});

test("applyHeadlineSelection: 검사에 걸린 후보는 빼고 점수 1위(동점이면 앞 순서)를 임시 제목으로, 후보 필드는 지운다", (t) => {
  quiet(t);
  const report = { cover: { headlineCandidates: [
    { headline: "나쁜 후보", subline: "s0" },
    { headline: "A, B", subline: "s1" },   // 직전과 같은 쉼표 형태 → -2
    { headline: "C 급락", subline: "s2" },
  ] } } as { cover: Record<string, unknown> };
  const sel = applyHeadlineSelection(report, ["X, Y"], (c) => (c.headline === "나쁜 후보" ? ["기간 비교"] : []));
  assert.ok(sel);
  assert.deepEqual(sel.survivors.map((s) => s.index), [1, 2]);
  assert.equal(sel.chosen.headline, "C 급락");
  assert.equal(report.cover.headline, "C 급락");
  assert.equal(report.cover.subline, "s2");
  assert.equal("headlineCandidates" in report.cover, false);
  assert.deepEqual(sel.scored[0].problems, ["기간 비교"]);
});

test("applyHeadlineSelection: 생존이 없으면 첫 후보, scoring:false 면 점수 대신 첫 생존 후보, 후보가 없으면 null", (t) => {
  quiet(t);
  const none = { cover: { headlineCandidates: [{ headline: "P", subline: "p" }, { headline: "Q", subline: "q" }] } } as { cover: Record<string, unknown> };
  const s1 = applyHeadlineSelection(none, [], () => ["위반"]);
  assert.equal(s1?.survivors.length, 0);
  assert.equal(none.cover.headline, "P");

  const off = { cover: { headlineCandidates: [{ headline: "A, B", subline: "a" }, { headline: "C 급락", subline: "c" }] } } as { cover: Record<string, unknown> };
  applyHeadlineSelection(off, ["X, Y"], () => [], { scoring: false });
  assert.equal(off.cover.headline, "A, B");

  assert.equal(applyHeadlineSelection({ cover: { subline: "s" } }, [], () => []), null);
  assert.equal(applyHeadlineSelection({}, [], () => []), null);
});

test("headlineSelectionEnabled: off(대소문자·공백 무관)만 끈다", () => {
  assert.equal(headlineSelectionEnabled({}), true);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: "on" }), true);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: "off" }), false);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: " OFF " }), false);
});

test("parseHeadlineEditorVerdict: pick 이 0..n-1 정수일 때만", () => {
  assert.deepEqual(parseHeadlineEditorVerdict({ pick: 1, scores: [{ natural: 4, clear: 5 }], reason: "r" }, 2), { pick: 1, scores: [{ natural: 4, clear: 5 }], reason: "r" });
  assert.deepEqual(parseHeadlineEditorVerdict({ pick: 0 }, 2), { pick: 0, scores: [], reason: "" });
  assert.equal(parseHeadlineEditorVerdict({ pick: 2 }, 2), null);
  assert.equal(parseHeadlineEditorVerdict({ pick: 0.5 }, 2), null);
  assert.equal(parseHeadlineEditorVerdict({ pick: "1" }, 2), null);
  assert.equal(parseHeadlineEditorVerdict(undefined, 2), null);
});

test("buildHeadlineEditorPrompt: 리포트·근거·최근 제목·번호 붙은 후보", () => {
  const p = buildHeadlineEditorPrompt({
    target: "etf", tier: "thin", subjectName: "국내 반도체", evidence: ["삼성전자 3분기 실적 발표"],
    recent: ["A, B"], candidates: [{ headline: "H0", subline: "S0" }, { headline: "H1", subline: "S1" }],
  });
  assert.match(p, /ETF Today/);
  assert.match(p, /근거 상태\(tier\): thin/);
  assert.match(p, /오늘의 주제 자산군: 국내 반도체/);
  assert.match(p, /- 삼성전자 3분기 실적 발표/);
  assert.match(p, /최근 제목\(최신순\):\n- A, B/);
  assert.match(p, /0\. 제목: H0\n {3}부제: S0\n1\. 제목: H1/);
  assert.match(buildHeadlineEditorPrompt({ target: "market", recent: [], candidates: [], evidence: [] }), /오늘의 핵심 근거: 없음/);
});

function selectionOf(n: number): HeadlineSelection {
  const scored = Array.from({ length: n }, (_, i) => ({ headline: `H${i}`, subline: `S${i}`, index: i, form: "단문" as const, score: 0, scoreReasons: [], problems: [] }));
  return { scored, survivors: scored, chosen: scored[0] };
}

function editorReturning(v: Awaited<ReturnType<HeadlineEditor>> | Error) {
  let calls = 0;
  const editor: HeadlineEditor = async () => { calls++; if (v instanceof Error) throw v; return v; };
  return { editor, calls: () => calls };
}

const base = { enabled: true, canCall: () => true, input: { target: "market" as const, recent: [], evidence: [] } };

test("chooseFinalHeadline: 다른 생존 후보를 고르면 trySwap 결과, 같은 후보면 다시 보지 않고 null", async (t) => {
  quiet(t);
  const swaps: string[] = [];
  const trySwap = (c: { headline: string }) => { swaps.push(c.headline); return `swapped:${c.headline}`; };
  const other = editorReturning({ pick: 1, scores: [], reason: "r" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: other.editor, trySwap }), "swapped:H1");
  const same = editorReturning({ pick: 0, scores: [], reason: "r" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: same.editor, trySwap }), null);
  assert.deepEqual(swaps, ["H1"]);
});

test("chooseFinalHeadline: 생존 2개 미만·꺼짐·예산 부족이면 편집자를 부르지 않는다", async (t) => {
  quiet(t);
  const e = editorReturning({ pick: 1, scores: [], reason: "r" });
  const trySwap = () => "x";
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(1), editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: null, editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, enabled: false, selection: selectionOf(2), editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, canCall: () => false, selection: selectionOf(2), editor: e.editor, trySwap }), null);
  assert.equal(e.calls(), 0);
});

test("chooseFinalHeadline: 편집자 오류·응답 없음·검증 악화(trySwap null)는 모두 null — 던지지 않는다", async (t) => {
  quiet(t);
  const trySwap = () => "x";
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning(new Error("timeout")).editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning(null).editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning({ pick: 1, scores: [], reason: "" }).editor, trySwap: () => null }), null);
});

test("chooseFinalHeadline: 편집자에게는 생존 후보의 제목·부제만 보낸다", async (t) => {
  quiet(t);
  let seen: unknown = null;
  const editor: HeadlineEditor = async (input) => { seen = input.candidates; return null; };
  const sel = selectionOf(3);
  sel.survivors = [sel.scored[0], sel.scored[2]];
  await chooseFinalHeadline({ ...base, selection: sel, editor, trySwap: () => null });
  assert.deepEqual(seen, [{ headline: "H0", subline: "S0" }, { headline: "H2", subline: "S2" }]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test lib/headline-selection.test.ts`
Expected: FAIL, `Cannot find module './headline-selection'`.

- [ ] **Step 3: 모델 상수를 한곳으로 모은다**

`lib/claude-budget.ts` 끝에 추가한다.

```ts
// 두 리포트 생성과 제목 편집자(headline-selection)가 함께 쓰는 모델 — 2026-10-27 따로 적혀 있던 문자열을 한곳으로.
export const REPORT_MODEL = "claude-sonnet-4-6";
```

이어서 두 곳을 고친다.
- `lib/claude-client.ts`: `model: "claude-sonnet-4-6",`(generateReport 안 stream 호출) → `model: REPORT_MODEL,`. 같은 파일 12행 claude-budget import에 `REPORT_MODEL`을 더한다.
- `lib/etf/claude-client.ts`: `model: 'claude-sonnet-4-6',`(generateMorningReportRaw) → `model: REPORT_MODEL,`. 18행 claude-budget import에 `REPORT_MODEL`을 더한다.

Run: `grep -rn "claude-sonnet-4-6" lib scripts | grep -v node_modules`
Expected: `lib/claude-budget.ts` 한 줄만

- [ ] **Step 4: 구현한다** — `lib/headline-selection.ts`

```ts
// lib/headline-selection.ts
//
// 제목 후보 셋 중 고르기(2026-10-27 스펙 §3). 모델은 cover.headlineCandidates 에 { headline, subline } 후보를 쓰고, 코드는:
//   (1) 파이프라인의 제목 단위 정확성 검사로 거르고
//   (2) 최근 반복 감점으로 임시 제목을 cover.headline·subline 에 쓰고(이후 기존 검증이 그대로 돈다)
//   (3) 발송할 리포트가 정해진 뒤 편집자에게 한 번 묻는다. 편집자는 번호만 고른다 — 문장을 고쳐 쓰지 않는다.
// 어떤 실패도 발송을 막지 않는다: 편집자 오류·시간 초과·예산 부족·꺼짐이면 임시 제목(코드 점수 1위)으로 발송한다.
import Anthropic from "@anthropic-ai/sdk";
import { REPORT_MODEL } from "./claude-budget";
import { headlineForm, headlineScore, HEADLINE_DESK, HEADLINE_RUBRIC, type HeadlineForm, type HeadlineTarget } from "./headline-editorial";

export interface HeadlineCandidate {
  headline: string;
  subline: string;
}

export interface ScoredHeadline extends HeadlineCandidate {
  index: number;          // 모델이 쓴 순서(0부터)
  form: HeadlineForm;
  score: number;          // headlineScore — 0이 가장 좋다
  scoreReasons: string[];
  problems: string[];     // 제목 단위 정확성 검사 위반(빈 배열 = 생존)
}

export interface HeadlineSelection {
  scored: ScoredHeadline[];
  survivors: ScoredHeadline[];
  chosen: ScoredHeadline; // 임시 제목
}

export const MAX_HEADLINE_CANDIDATES = 3;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * cover 에서 후보를 읽는다(앞 3개, 빈 제목 제외). headlineCandidates 가 없거나 비면 옛 cover.headline·subline 을
 * 손대지 않고 후보 하나로 본다(호환 — 기존 응답·테스트 픽스처). 둘 다 없으면 [].
 */
export function extractHeadlineCandidates(cover: unknown): HeadlineCandidate[] {
  const c = asRecord(cover);
  if (!c) return [];
  const list = Array.isArray(c.headlineCandidates) ? c.headlineCandidates : [];
  const candidates = list
    .map(asRecord)
    .filter((x): x is Record<string, unknown> => x !== null && trimmed(x.headline) !== "")
    .slice(0, MAX_HEADLINE_CANDIDATES)
    .map((x) => ({ headline: trimmed(x.headline), subline: trimmed(x.subline) }));
  if (candidates.length > 0) return candidates;
  if (typeof c.headline === "string" && c.headline.trim()) {
    return [{ headline: c.headline, subline: typeof c.subline === "string" ? c.subline : "" }];
  }
  return [];
}

/**
 * 후보를 거르고 점수를 매겨 임시 제목을 cover.headline·cover.subline 에 쓴다. cover.headlineCandidates 는 지운다
 * (렌더·인덱스·로그에 후보가 남지 않게). 후보가 없으면 null — 필수 항목 검사가 누락을 보고한다.
 * recent: 같은 리포트 종류의 최근 제목(최신순, 오늘 제외). problemsOf: 파이프라인의 제목 단위 검사.
 * scoring:false(HEADLINE_SELECTION=off)면 점수 대신 첫 생존 후보를 쓴다.
 */
export function applyHeadlineSelection(
  report: unknown,
  recent: readonly string[],
  problemsOf: (c: HeadlineCandidate) => string[],
  options: { scoring?: boolean } = {},
): HeadlineSelection | null {
  const cover = asRecord(asRecord(report)?.cover);
  if (!cover) return null;
  const candidates = extractHeadlineCandidates(cover);
  delete cover.headlineCandidates;
  if (candidates.length === 0) return null;
  const scored: ScoredHeadline[] = candidates.map((c, index) => {
    const { score, reasons } = headlineScore(c.headline, recent);
    return { ...c, index, form: headlineForm(c.headline), score, scoreReasons: reasons, problems: problemsOf(c) };
  });
  const survivors = scored.filter((s) => s.problems.length === 0);
  const ranked = options.scoring === false ? survivors : [...survivors].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = ranked[0] ?? scored[0];
  cover.headline = chosen.headline;
  cover.subline = chosen.subline;
  console.log(`🏷️ 제목 후보 ${scored.length}개(생존 ${survivors.length}) — 임시 제목: "${chosen.headline}" 〔${chosen.form}, 점수 ${chosen.score}〕`);
  for (const s of scored) {
    const why = [...s.problems.map((p) => `✗ ${p}`), ...s.scoreReasons].join(" / ");
    console.log(`   ${s.index + 1}. "${s.headline}" 〔${s.form}, ${s.score}〕${why ? ` — ${why}` : ""}`);
  }
  return { scored, survivors, chosen };
}

/** HEADLINE_SELECTION=off(대소문자·공백 무관)면 끈다 — 편집자를 부르지 않고 첫 생존 후보로 발송(긴급 되돌리기). */
export function headlineSelectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HEADLINE_SELECTION?.trim().toLowerCase() !== "off";
}

export const HEADLINE_EDITOR_TIMEOUT_MS = 30_000;
// 편집자 호출을 시작할지 판단할 때 생성 예산(makeDeadline.canStartCall)에 넘기는 예상 시간.
export const HEADLINE_EDITOR_ESTIMATE_MS = 60_000;

export interface HeadlineEditorInput {
  target: HeadlineTarget;
  candidates: readonly HeadlineCandidate[];
  recent: readonly string[];
  tier?: string;
  subjectName?: string;
  evidence: readonly string[];
}

export interface HeadlineEditorVerdict {
  pick: number;
  scores: Array<{ natural: number; clear: number }>;
  reason: string;
}

export type HeadlineEditor = (input: HeadlineEditorInput) => Promise<HeadlineEditorVerdict | null>;

const EDITOR_SYSTEM = `${HEADLINE_DESK}
아래 제목 후보 가운데 오늘 발행할 제목 하나를 고릅니다. 고르기만 하고 고쳐 쓰지 않습니다.
기준(앞의 것이 우선):
${HEADLINE_RUBRIC}
- 같은 점수면 최근 제목과 형태·끝 어절이 덜 겹치는 후보.
결과는 pick 도구로 한 번 낸다.`;

export function buildHeadlineEditorPrompt(input: HeadlineEditorInput): string {
  const parts = [
    `리포트: ${input.target === "etf" ? "ETF Today (자산군·ETF)" : "Daily Market (시장 전체)"}`,
    input.tier ? `근거 상태(tier): ${input.tier}` : "",
    input.subjectName ? `오늘의 주제 자산군: ${input.subjectName}` : "",
    input.evidence.length > 0
      ? `오늘의 핵심 근거:\n${input.evidence.map((e) => `- ${e}`).join("\n")}`
      : "오늘의 핵심 근거: 없음(인과를 단정한 후보는 감점)",
    input.recent.length > 0 ? `최근 제목(최신순):\n${input.recent.map((h) => `- ${h}`).join("\n")}` : "",
    `후보:\n${input.candidates.map((c, i) => `${i}. 제목: ${c.headline}\n   부제: ${c.subline}`).join("\n")}`,
    "후보마다 자연스러움·명확성을 1~5로 매기고, 가장 나은 후보의 번호(0부터)를 pick 도구로 내십시오.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

const PICK_SCHEMA = {
  type: "object",
  properties: {
    pick: { type: "integer", minimum: 0 },
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: { natural: { type: "integer", minimum: 1, maximum: 5 }, clear: { type: "integer", minimum: 1, maximum: 5 } },
        required: ["natural", "clear"],
      },
    },
    reason: { type: "string" },
  },
  required: ["pick", "scores", "reason"],
};

/** 도구 입력 검사 — pick 이 0..n-1 정수가 아니면 null. scores·reason 은 기록용이라 모양이 틀리면 비운다. */
export function parseHeadlineEditorVerdict(raw: unknown, n: number): HeadlineEditorVerdict | null {
  const r = asRecord(raw);
  const pick = r?.pick;
  if (typeof pick !== "number" || !Number.isInteger(pick) || pick < 0 || pick >= n) return null;
  const scores = Array.isArray(r?.scores)
    ? r.scores.map(asRecord).filter((s): s is Record<string, unknown> => s !== null).map((s) => ({ natural: Number(s.natural), clear: Number(s.clear) }))
    : [];
  return { pick, scores, reason: typeof r?.reason === "string" ? r.reason : "" };
}

let editorClient: Anthropic | null = null;
function getEditorClient(): Anthropic {
  // SDK 재시도 없이 30초 — 늦으면 임시 제목으로 발송한다.
  if (!editorClient) editorClient = new Anthropic({ timeout: HEADLINE_EDITOR_TIMEOUT_MS, maxRetries: 0 });
  return editorClient;
}

/** 기본 편집자 — 생성과 같은 모델에 한 번 묻는다. 도구 결과가 없거나 틀리면 null(호출자가 임시 제목을 쓴다). */
export const callHeadlineEditor: HeadlineEditor = async (input) => {
  const res = await getEditorClient().messages.create({
    model: REPORT_MODEL,
    max_tokens: 1024,
    system: EDITOR_SYSTEM,
    tools: [{ name: "pick", description: "고른 후보 번호와 후보별 점수를 낸다(반드시 이 도구로 한 번)", input_schema: PICK_SCHEMA as never }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: buildHeadlineEditorPrompt(input) }],
  });
  const call = res.content.find((c) => c.type === "tool_use") as { input?: unknown } | undefined;
  return parseHeadlineEditorVerdict(call?.input, input.candidates.length);
};

export interface FinalHeadlineOptions<T> {
  selection: HeadlineSelection | null;
  enabled: boolean;                               // headlineSelectionEnabled()
  canCall: () => boolean;                         // 생성 예산 — deadline.canStartCall(HEADLINE_EDITOR_ESTIMATE_MS)
  editor: HeadlineEditor;
  input: Omit<HeadlineEditorInput, "candidates">;
  trySwap: (candidate: ScoredHeadline) => T | null; // 고른 후보로 바꾼 리포트를 기존 검증으로 다시 본다 — 나빠지면 null
}

/**
 * 발송할 리포트가 정해진 뒤 한 번만 부른다. 생존 후보가 둘 이상이고 켜져 있고 예산이 있으면 편집자에게 묻고,
 * 고른 후보가 임시 제목과 다르면 trySwap 결과를 돌려준다. 그 밖(후보 부족·꺼짐·예산 부족·편집자 오류·같은 후보·검증 악화)은 null —
 * 호출자는 임시 제목 그대로 발송한다. 던지지 않는다.
 */
export async function chooseFinalHeadline<T>(o: FinalHeadlineOptions<T>): Promise<T | null> {
  const sel = o.selection;
  if (!sel || sel.survivors.length < 2) return null;
  if (!o.enabled) {
    console.log("🏷️ 제목 편집자 꺼짐(HEADLINE_SELECTION=off) — 임시 제목 유지");
    return null;
  }
  if (!o.canCall()) {
    console.log("🏷️ 생성 예산 부족 — 제목 편집자 생략, 임시 제목 유지");
    return null;
  }
  let verdict: HeadlineEditorVerdict | null;
  try {
    verdict = await o.editor({ ...o.input, candidates: sel.survivors.map(({ headline, subline }) => ({ headline, subline })) });
  } catch (e) {
    console.log(`🏷️ 제목 편집자 호출 실패 — 임시 제목 유지: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!verdict) {
    console.log("🏷️ 제목 편집자 응답 없음·형식 오류 — 임시 제목 유지");
    return null;
  }
  const picked = sel.survivors[verdict.pick];
  const scores = verdict.scores.map((s, i) => `${i}:${s.natural}/${s.clear}`).join(" ");
  console.log(`🏷️ 제목 편집자 선택: "${picked.headline}" (자연/명확 ${scores || "-"}) — ${verdict.reason}`);
  if (picked === sel.chosen) return null;
  const swapped = o.trySwap(picked);
  if (swapped === null) console.log("🏷️ 고른 후보로 바꾸면 검증이 나빠져 임시 제목 유지");
  return swapped;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test lib/headline-selection.test.ts`
Expected: PASS (12 tests)

Run: `npm test && npm run typecheck`
Expected: 통과

- [ ] **Step 6: 커밋한다**

```bash
git add lib/headline-selection.ts lib/headline-selection.test.ts lib/claude-budget.ts lib/claude-client.ts lib/etf/claude-client.ts
git commit -m "$(cat <<'EOF'
feat: 제목 후보 거르기·임시 제목·편집자 선택 모듈

후보 3개를 제목 단위 검사로 거르고 최근 반복 감점으로 임시 제목을 정한다.
발송할 결과가 정해지면 편집자에게 번호만 한 번 묻고, 실패·꺼짐·예산 부족은
임시 제목으로 발송한다. 생성·편집자 모델 문자열을 REPORT_MODEL 하나로 모은다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Market 파이프라인 연결

**Files:**
- Modify: `lib/types.ts:282-286` (`ReportContent.cover.headlineCandidates?`)
- Modify: `lib/claude-client.ts` (시스템 프롬프트 73행, 근거 블록 180행, 반복 방지 블록, 스키마, 제목 작성 규칙, 후보 검사, 검증 함수 추출, 루프, 편집자)
- Create: `lib/market-headline.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `takeRecentHeadlines`
  - Task 2: `renderHeadlineStandard`, `renderRecentHeadlineLines`, `pickHeadlineExemplars`, `renderHeadlineExemplars`
  - Task 3: `applyHeadlineSelection`, `chooseFinalHeadline`, `callHeadlineEditor`, `headlineSelectionEnabled`, `HEADLINE_EDITOR_ESTIMATE_MS`, `type HeadlineCandidate`, `type HeadlineSelection`, `REPORT_MODEL`
- Produces: `export function marketHeadlineProblems(c: HeadlineCandidate, content: Pick<ReportContent, "cardLine">): string[]` (`lib/claude-client.ts`).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `lib/market-headline.test.ts`

```ts
// 2026-10-27 제목 편집 기준 — Market: 후보 셋 → 제목 단위 검사로 거르기 → 임시 제목 → 발송 직전 편집자 한 번.
// 네트워크 없이 SDK 의 Messages.stream(생성)·Messages.create(편집자)만 가짜로 바꿔 끼운다.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { generateReport, buildReportPrompt, marketHeadlineProblems } from './claude-client'

const DATA = {
  collectedAt: '2026-10-16T07:00:00+09:00', date: '2026-10-16', dayOfWeek: '금',
  koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
} as never
const LINE = '해외 충격보다 국내 수급 부담이 더 컸습니다'
const BAD = '코스피 사상 최고 경신, 반도체 강세' // 기간 비교·최상급(Ruling 31) — 후보에서 빠진다
const GOOD_A = '코스피 2% 상승에 반도체 강세'
const GOOD_B = 'S&P500 오르고 코스피 내려'

function body(cover: Record<string, unknown>): string {
  return JSON.stringify({
    cover,
    summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸습니다.', today: '개장 30분 거래대금이 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서.' },
    cardLine: { kind: 'cause', text: LINE },
    bigStory: { content: [{ type: 'paragraph', text: '본문입니다.' }] },
    watchPoints: [], soWhat: [], calendar: [], closingMessage: '마무리',
  })
}
const reply = (cands: Array<[string, string]>) => body({ headlineCandidates: cands.map(([headline, subline]) => ({ headline, subline })), imageKeywords: [] })

/** 생성(stream)은 replies 를 차례로, 편집자(create)는 verdict 를 pick 도구 결과로 돌려준다. 시계는 멈춰 둔다(예산 충분). */
function fakeApis(replies: string[], verdict: unknown) {
  let calls = 0
  const systems: string[] = []
  mock.method(console, 'log', () => {})
  mock.method(console, 'error', () => {})
  mock.method(Date, 'now', () => 1_000_000)
  const stream = mock.method(Anthropic.Messages.prototype, 'stream', (...args: unknown[]) => {
    systems.push((args[0] as { system: string }).system)
    const r = replies[Math.min(calls++, replies.length - 1)]
    return { finalMessage: async () => ({ content: [{ type: 'text', text: r }] }) } as never
  })
  const create = mock.method(Anthropic.Messages.prototype, 'create', async () => ({ content: [{ type: 'tool_use', id: 't1', name: 'pick', input: verdict }] }) as never)
  return { stream, create, systems }
}

test('Market 제목: 검사에 걸린 후보는 빼고, 편집자가 고른 생존 후보로 제목·부제를 쓴다(후보 필드는 남기지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, create, systems } = fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 1, scores: [{ natural: 3, clear: 3 }, { natural: 4, clear: 5 }], reason: '대비가 분명' })
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.equal(create.mock.callCount(), 1)
  assert.equal(content.cover.headline, GOOD_B)
  assert.equal(content.cover.subline, '부제B')
  assert.equal(content.cover.headlineCandidates, undefined)
  const sent = JSON.stringify((create.mock.calls[0].arguments[0] as { messages: unknown }).messages)
  assert.ok(!sent.includes('사상 최고'), '검사에 걸린 후보는 편집자에게 보내지 않는다')
  assert.ok(!systems[0].includes('(제목·본문 모두)'), '은유 권장은 본문에만')
  assert.ok(!systems[0].includes('### 지향할 헤드라인 결'), '제목 예시는 사용자 프롬프트로 옮겼다')
})

test('Market 제목: 편집자 응답이 틀리면(번호 범위 밖) 임시 제목(코드 점수 1위·앞 순서)으로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 7, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(content.cover.headline, GOOD_A)
  assert.equal(content.cover.subline, '부제A')
})

test('Market 제목: HEADLINE_SELECTION=OFF 면 편집자를 부르지 않고 첫 생존 후보로', async (t) => {
  process.env.HEADLINE_SELECTION = ' OFF '
  t.after(() => { delete process.env.HEADLINE_SELECTION; mock.restoreAll() })
  const { create } = fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 1, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(create.mock.callCount(), 0)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목: 1회차 후보가 모두 검사에 걸리면 재생성하고, 2회차 생존 후보로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const allBad = reply([[BAD, 's'], ['코스피 역대 최대 낙폭, 반도체 급락', 's'], ['반도체 사상 최저, 코스피 급락', 's']])
  const { stream } = fakeApis([allBad, reply([[GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 0, scores: [], reason: 'r' })
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목: 옛 응답(cover.headline 만)은 후보 하나 — 편집자를 부르지 않는다', async (t) => {
  t.after(() => mock.restoreAll())
  const { create } = fakeApis([body({ headline: GOOD_A, subline: '부제A' })], { pick: 0, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(create.mock.callCount(), 0)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목: cover.headline 과 후보를 함께 쓰면 후보가 이긴다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeApis([body({ headline: '옛 제목 필드', subline: 'x', headlineCandidates: [{ headline: GOOD_A, subline: '부제A' }, { headline: GOOD_B, subline: '부제B' }] })], { pick: 0, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(content.cover.headline, GOOD_A)
})

test('marketHeadlineProblems: 부제의 HARD 권유·제목 최상급·빈 부제·카드 제목 넘침을 후보별로 잡는다', () => {
  const ok = { cardLine: { kind: 'cause' as const, text: LINE } }
  assert.deepEqual(marketHeadlineProblems({ headline: GOOD_A, subline: '부제' }, ok), [])
  assert.ok(marketHeadlineProblems({ headline: GOOD_A, subline: '지금 매수하세요' }, ok).some((p) => /투자 권유성 표현/.test(p)))
  assert.ok(marketHeadlineProblems({ headline: BAD, subline: '부제' }, ok).length > 0)
  assert.ok(marketHeadlineProblems({ headline: GOOD_A, subline: '' }, ok).includes('subline 누락'))
  const long = '코스피 급락 다음 날 미 증시는 숨 고르기에 들어갔고 외국인 매도와 환율 부담이 한꺼번에 겹치며 투자자들의 관망이 길어졌습니다'
  assert.ok(marketHeadlineProblems({ headline: long, subline: '부제' }, ok).some((p) => /^카드 headline/.test(p)))
  // 카드 한 줄 자체의 문제는 후보 탓이 아니다(모든 후보에 같다)
  assert.deepEqual(marketHeadlineProblems({ headline: GOOD_A, subline: '부제' }, { cardLine: { kind: 'cause', text: '' } }), [])
})

test('프롬프트: 공통 기준·순환 예시·후보 스키마·최근 제목 형태(오늘 항목 제외), 옛 은유 지시 없음', () => {
  const entry = (date: string, headline: string) => ({ date, headline, bigStoryTopic: 't', narrativeAngle: 'a', walletTopics: [], metaphors: [], lookingAhead: '' })
  const ctx = {
    angle: { id: 'a', name: '구조적 렌즈', description: '', promptGuide: 'g' },
    recentLog: [entry('2026-10-16', '오늘 다시 만든 제목'), entry('2026-10-15', 'CPI 예상 상회, 나스닥 1.9% 밀렸다'), entry('2026-10-14', '코스피, 349포인트 무너지며 6,035선 후퇴')],
    sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null,
  }
  const p = buildReportPrompt(DATA, ctx as never, null)
  assert.match(p, /\[제목 편집 기준 — Market·ETF 공통\]/)
  assert.match(p, /\[오늘 참고할 제목 예시/)
  assert.match(p, /"headlineCandidates": \[/)
  assert.match(p, /- CPI 예상 상회, 나스닥 1\.9% 밀렸다 〔쉼표 두 토막〕/)
  assert.match(p, /오늘 제목은 이 형태를 피하십시오: 쉼표 두 토막/)
  assert.ok(!p.includes('오늘 다시 만든 제목'), '오늘 날짜 항목은 최근 제목에서 뺀다')
  for (const gone of ['호기심의 방아쇠', '본문이 갚으십시오', '은유가 전면', '신선한 은유·관점을 적극 허용', '오늘 본문을 관통하는 호기심 유발 한 줄', '"…가 그린 …"']) {
    assert.ok(!p.includes(gone), gone)
  }
  // 유지되는 규칙
  assert.match(p, /표제어체로 쓰십시오/)
  assert.match(p, /\*\*수치 앵커\*\*/)
  assert.match(p, /\*\*hollow\*\* 면 \*\*사실 모드\*\*/)
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test lib/market-headline.test.ts`
Expected: FAIL. `marketHeadlineProblems`가 export되지 않았고, 프롬프트 단언도 실패한다.

- [ ] **Step 3: 타입에 후보 필드를 더한다** — `lib/types.ts` `ReportContent.cover`

```ts
  cover: {
    headline: string;
    subline: string;
    imageKeywords?: string[]; // 제목/본문 핵심 이미지·은유 단어 (반복 회피 로그용). 사실 모드면 빈 배열.
    // 2026-10-27: 모델이 쓰는 제목 후보 — 코드가 하나를 골라 headline·subline 에 쓰고 이 필드는 지운다(렌더·인덱스에 남지 않는다).
    headlineCandidates?: Array<{ headline: string; subline: string }>;
  };
```

- [ ] **Step 4: 프롬프트를 바꾼다** — `lib/claude-client.ts`

a. import를 고친다. 기존 `renderVoiceExemplars` import 줄을 바꾸고, 아래 줄들을 더한다.

```ts
import { renderVoiceExemplars, pickHeadlineExemplars, renderHeadlineExemplars } from "./voice-exemplars";
// 2026-10-27 제목 편집 기준: 공통 기준 문구·최근 제목 형태·후보 선택(스펙 docs/superpowers/specs/2026-10-27-headline-editorial-design.md).
import { renderHeadlineStandard, renderRecentHeadlineLines, takeRecentHeadlines } from "./headline-editorial";
import {
  applyHeadlineSelection, chooseFinalHeadline, callHeadlineEditor, headlineSelectionEnabled, HEADLINE_EDITOR_ESTIMATE_MS,
  type HeadlineCandidate, type HeadlineSelection,
} from "./headline-selection";
```

b. 시스템 프롬프트 73행을 바꾼다.
- 옛: `- **신선하고 구체적인 은유·관점**을 적극 사용할 것 (제목·본문 모두). 단 오늘의 데이터에서 길어올린 은유만 — "아무 날에나 붙일 수 있는 비유"는 쓰지 말 것.`
- 새: `- 본문에는 **신선하고 구체적인 은유·관점**을 써도 좋다. 단 오늘의 데이터에서 길어올린 은유만 — "아무 날에나 붙일 수 있는 비유"는 쓰지 말 것. 제목은 사용자 메시지의 [제목 편집 기준]을 따를 것.`

c. 최근 제목 도우미를 `buildAntiRepetitionBlock` 위에 추가한다.

```ts
/** Market 최근 제목(최신순, 오늘 날짜 제외 — 같은 날 강제 재생성하면 오늘 항목이 기록에 있다). */
function marketRecentHeadlines(ctx: AntiRepetitionContext, date: string): string[] {
  return takeRecentHeadlines(ctx.recentLog.filter((e) => e.date !== date).map((e) => e.headline));
}
```

d. `buildAntiRepetitionBlock(ctx)`의 시그니처를 `buildAntiRepetitionBlock(ctx: AntiRepetitionContext, date: string)`로 바꾼다. `buildReportPrompt`의 호출부는 `buildAntiRepetitionBlock(ctx, data.date)`가 된다. 블록 안에서 두 곳을 고친다.

옛 코드:

```ts
    const usedHeadlines = ctx.recentLog.map((e) => e.headline).filter(Boolean);
    if (usedHeadlines.length > 0) {
      block += `- 헤드라인: ${usedHeadlines.join(" / ")}\n`;
    }
```

새 코드:

```ts
    const recentHeadlines = marketRecentHeadlines(ctx, date);
    if (recentHeadlines.length > 0) {
      block += `- 헤드라인(최신순, 〔형태〕):\n${renderRecentHeadlineLines(recentHeadlines)}\n`;
    }
```

맺음 문장도 바꾼다.

옛:

```ts
    block += `\n위 요소와 동일하거나 유사한 **단어**뿐 아니라, **구조·골격·이미지의 재사용**도 피하십시오. 특히 최근 헤드라인들의 공통 구문 틀(예: "…가 그린 …", "…한 자리에 …" 류)이 보이면 같은 문형을 반복하지 말고 다른 골격으로 쓰십시오.\n`;
```

새:

```ts
    block += `\n위 요소와 동일하거나 유사한 **단어**뿐 아니라 **구조·이미지의 재사용**도 피하십시오. 제목의 형태는 아래 [제목 작성 규칙]의 기준을 따릅니다.\n`;
```

e. `buildEvidenceBlock`의 `이 근거 상태는 아래 [제목 작성 규칙]의 tier 종속 동작을 결정합니다.`를 `이 근거 상태는 아래 [제목 작성 규칙]에서 인과 표현의 강도를 정합니다.`로 바꾼다.

f. JSON 스키마의 cover 두 줄(`"headline": string,   // 오늘 본문을 관통하는 …`, `"subline": string,    // 헤드라인 보충 …`)을 아래로 바꾼다. `imageKeywords` 줄은 그대로 둔다.

```
    "headlineCandidates": [   // 제목 후보 3개 — 아래 [제목 작성 규칙]의 [제목 편집 기준] 참조. 코드가 하나를 골라 제목·부제로 씁니다.
      { "headline": string, "subline": string }   // subline: 그 제목에서 뺀 구체 사건명·핵심 수치를 받치는 1~2문장
    ],
```

g. `buildReportPrompt` 안 `const contextBlock = …` 아래에 추가한다.

```ts
  const headlineExemplars = renderHeadlineExemplars(pickHeadlineExemplars("market", marketRecentHeadlines(ctx, data.date), data.date));
```

h. 템플릿에서 `### 제목 작성 규칙` 줄부터 `**JSON만 출력하십시오.` 줄 바로 앞까지를 아래로 통째로 바꾼다. 마지막 빈 줄은 유지한다. "표제어체"·"수치 앵커"·"기간 비교" 세 줄은 원문 그대로 옮긴다.

```
### 제목 작성 규칙

${renderHeadlineStandard()}

${headlineExemplars}

- **표제어체로 쓰십시오 (문체 규칙 — 최우선).** 한국어 신문·리포트 제목의 어투는 **명사로 끝맺거나(권장)** 기사체 종결('~다')입니다. **존댓말 종결('~습니다')과 완결 서술문("…을 갈라놓았다", "…가 채웠습니다" 같은 산문 술어)은 제목에 쓰지 마십시오** — 그건 본문·칼럼의 어투이지 표제어가 아닙니다. 조사·어미를 덜어 압축하십시오. 은유는 그대로 살리되 종결형만 표제어체로. (예: "서울은 삼성과 SK를 두 방향으로 갈라놓았다" → "마이크론 쇼크에 엇갈린 삼성·SK")
- **수치 앵커**(코스피 +X%, 환율 N원 등)는 기본적으로 **부제(subline)** 가 받칩니다. 단 그 숫자 자체가 오늘의 후크(예: 코스피 3000 돌파, 환율 1,500 같은 심리적 분기점)라면 제목에 남길지 직접 판단하십시오.
- **기간 비교·최상급 금지 (제목·cardLine 공통).** 제목·카드 문구에는 'N년치·N개월치', '역대·사상 최대/최고/최저', 'N년 만에 최고/최저', '연중 최고/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않는다 — 입력 데이터로 확인되는 수치와 사실만. (과거 기준점은 historicalComparison의 1주·1개월·3개월·1년뿐이라 이런 주장은 확인할 수 없습니다. 비교가 필요하면 부제·본문에서 그 기준점의 수치("1년 전 대비 N%" 등)로 쓰십시오.)
- 길이는 압축 지향(대략 15~25자 권장). 명확성을 위해 필요하면 약간 넘어도 됩니다.
- **본문과의 관계**: 세 후보 모두 bigStory 가 다루는 오늘의 중심 사건을 다룹니다. 어느 후보가 뽑혀도 본문과 맞아야 합니다.
- **catalyst 반복 회피**: 같은 catalyst 가 최근 3일 헤드라인에 등장했다면 (a) 사건의 국면·단계를 다르게 표현하거나 (b) catalyst 를 부제로 내리고 제목은 새 각도로 쓰십시오.

**근거 상태(tier) — 위 [오늘의 근거 상태] 참조:** 인과 표현의 강도는 [제목 편집 기준] 3을 따릅니다. **hollow** 면 **사실 모드**입니다 — 은유를 만들지 말고 절제된 사실로 쓰고, imageKeywords 는 빈 배열로 두십시오.

```

- [ ] **Step 5: 후보 검사와 검증 함수를 추가한다** — `lib/claude-client.ts`

`validateMarketSoftAdvice` 함수 아래에 추가한다.

```ts
/**
 * 제목 후보 하나의 제목 단위 검사(2026-10-27 스펙 §3) — 위반 목록(빈 배열 = 생존). 던지지 않는다.
 * 기간 비교·최상급(Ruling 31), 제목·부제 화면 글자의 권유 HARD·SOFT(Ruling 37e), 빈 부제, 카드 제목 넘침.
 * 후보마다 다른 것만 본다 — 카드 한 줄 자체의 문제는 모든 후보에 같으므로 기존 검증(validateMarketCardText 등)이 보고한다.
 */
export function marketHeadlineProblems(c: HeadlineCandidate, content: Pick<ReportContent, "cardLine">): string[] {
  const headline = marketAdviceText(c.headline, "title");
  const subline = marketAdviceText(c.subline, "title");
  const problems = [
    ...comparativeClaimViolations([["cover.headline", c.headline]]),
    ...[...findHardAdvice(headline), ...findHardAdvice(subline)].map((f) => `투자 권유성 표현: "${f}"`),
    ...[...findSoftAdvice(headline), ...findSoftAdvice(subline)].map((f) => `권유성 단정 표현: "${f}"`),
  ];
  if (!subline) problems.push("subline 누락");
  const fit = cardTextFits("market", { headline: stripEmphasisTags(c.headline).trim(), line: plainText(content?.cardLine?.text) });
  problems.push(...fit.reasons.filter((r) => r.startsWith("headline")).map((r) => `카드 ${r}`));
  return problems;
}

interface MarketAssessment {
  content: ReportContent;   // 시점·출처 soft fix 를 반영한 결과
  requiredMissing: string[];
  base: string[];           // 일반 기준 위반(1~2번째 재생성, 마지막 경고)
  card: string[];           // 카드 글자 맞춤
  advice: string[];         // HARD 권유 — 모든 시도에서 위반
}

/**
 * 한 결과의 soft fix·검증 — 매 시도와 제목 편집자 교체 뒤 재검증이 같은 함수를 쓴다.
 * 형식이 깨진 응답이면 던질 수 있다 — 호출자가 파싱 실패처럼 다룬다(Ruling 28).
 */
function assessMarketContent(parsed: ReportContent, reportDate: string, todaySources: string[]): MarketAssessment {
  let content = parsed;
  const temporal = checkAndFixTemporal(JSON.stringify(content), reportDate);
  const sourceFix = softFixUnquotableSources(temporal.fixed, todaySources);
  const softFixes = [...temporal.softFixes, ...sourceFix.softFixes];
  if (softFixes.length > 0) {
    console.log(`🩹 정합성 soft fix ${softFixes.length}건: ${softFixes.join(", ")}`);
    content = JSON.parse(sourceFix.fixed) as ReportContent;
  }
  if (sourceFix.warnings.length > 0) {
    console.log(`⚠️ 비승인 출처 잔존: ${sourceFix.warnings.join(", ")}`);
  }
  const requiredMissing = validateMarketRequired(content);
  // Ruling 31: 제목·카드 한 줄의 기간 비교·최상급은 일반 기준 위반(1~2번째 재생성, 마지막 시도 경고만).
  // Ruling 37e: 권유성 단정(SOFT)도 일반 기준 위반 — 해설에 섞여 걸려도 재생성 한 번이 비용이고 마지막 시도는 경고만.
  const base = [...temporal.violations, ...requiredMissing, ...validateMarketSummary(content), ...validateMarketComparativeClaims(content), ...validateMarketSoftAdvice(content)];
  const citationCount = countCitationPhrases(sourceFix.fixed);
  if (citationCount >= 8) {
    base.push(`"에 따르면" 인용 ${citationCount}회 과다`);
  } else if (citationCount >= 5) {
    console.log(`⚠️ "에 따르면" 인용 ${citationCount}회 (허용 한도 이하)`);
  }
  // 카드 글자 맞춤: 1~2번째 시도에선 다시 쓰게 하는 사유, 마지막 시도에선 "위반 잔존" 경고로만 남는다.
  // Ruling 37·37e: 매수·매도 권유 HARD(명령형) — 모든 시도에서 위반(마지막 시도도 경고로 넘기지 않는다).
  return { content, requiredMissing, base, card: validateMarketCardText(content), advice: validateMarketAdvice(content) };
}

/** 편집자에게 줄 오늘의 핵심 근거 — 근거 상태의 최상위 catalyst 제목(없으면 빈 배열). */
function marketEditorEvidence(ctx: AntiRepetitionContext): string[] {
  const top = ctx.evidence?.topCatalyst?.title;
  return top ? [top] : [];
}
```

- [ ] **Step 6: 루프를 바꾼다** — `generateReport`

a. `type MarketCandidate`에 `selection` 필드를 더한다.

```ts
  type MarketCandidate = { content: ReportContent; base: string[]; card: string[]; attempt: number; selection: HeadlineSelection | null };
```

b. `const deadline = makeDeadline(MARKET_GENERATION_BUDGET_MS);` 바로 아래에 추가한다.

```ts
  // 2026-10-27 제목 편집 기준: 최근 제목(최신순, 오늘 제외)·출처 목록·선택 켬 여부는 시도마다 같다.
  const recentHeadlines = marketRecentHeadlines(defaultCtx, data.date);
  const todaySources = (context?.news ?? []).map((n) => n.source);
  const selectionOn = headlineSelectionEnabled();
```

c. 루프 안 `// R2·R3 (2026-07-22): 파싱 성공 직후 정합성 검사.` 주석 블록부터 `} catch (validationErr) {` 바로 앞까지가 교체 대상이다. 이 구간의 앞부분, 곧 `try {`부터 `const hardViolations = …;` 다음 `if (requiredMissing.length === 0 && adviceViolations.length === 0) { candidates.push(…); }`까지를 아래로 바꾼다. 그 뒤의 `if (hardViolations.length > 0 && attempt < maxRetries) {` 이하 분기는 그대로 둔다.

```ts
    // R2·R3 (2026-07-22): 파싱 성공 직후 정합성 검사 — 시점·출처 soft fix 후 검증(assessMarketContent).
    // Ruling 28: 형식이 깨진 응답 때문에 검증 중 예외가 나면 파싱 실패처럼 다룬다 — 함수 밖으로 던지지 않고
    // 기록·경고 뒤 다음 시도로(마지막 시도면 루프 뒤 앞선 결과 발송 경로로).
    try {
      // 2026-10-27: 제목 후보 셋 → 제목 단위 검사로 거르고 최근 반복 감점으로 임시 제목(cover.headline·subline)을 정한다.
      // 생존 후보가 없으면 첫 후보가 임시 제목이 되고, 그 위반을 아래 기존 검증이 보고한다(1~2번째 재생성, 마지막 경고).
      const current = parsed;
      const selection = applyHeadlineSelection(current, recentHeadlines, (c) => marketHeadlineProblems(c, current), { scoring: selectionOn });
      const assessed = assessMarketContent(parsed, data.date, todaySources);
      parsed = assessed.content;
      const { requiredMissing, base: baseViolations, card: cardViolations, advice: adviceViolations } = assessed;
      if (requiredMissing.length > 0) lastRequiredMissing = { attempt, fields: requiredMissing };
      if (adviceViolations.length > 0) lastAdvice = { attempt, fields: adviceViolations };
      const hardViolations = [...baseViolations, ...adviceViolations, ...cardViolations];
      // 필수 항목이 빠진 결과·권유 표현이 남은 결과는 후보에서 뺀다 — 위반 수로 겨루면 발송할 수 있는 결과를 밀어낼 수 있다.
      if (requiredMissing.length === 0 && adviceViolations.length === 0) {
        candidates.push({ content: parsed, base: baseViolations, card: cardViolations, attempt, selection });
      }
```

`reportDate`, `todaySources`(지역), `canonical`, `temporal`, `sourceFix`, `softFixes`, `citationCount`, `cardViolations`, `adviceViolations`의 옛 지역 선언이 남아 있지 않은지 확인한다. 모두 `assessMarketContent`로 옮겨졌다.

d. 루프 뒤 `// Ruling 38: 선호 순서대로 마무리·렌더한다 …` 주석과 `const ordered = preferenceOrder();` 줄을 아래로 바꾼다. 그 뒤 `let finalizeErr …`와 for 문은 그대로 둔다.

```ts
  // 2026-10-27: 발송할 결과가 정해졌다 — 제목 후보가 둘 이상 살아 있으면 편집자에게 한 번 묻는다(번호만).
  // 바꾼 결과를 같은 검증으로 다시 보고, 권유·필수 누락이 생기거나 위반이 늘면 임시 제목을 그대로 쓴다. 어떤 실패도 발송을 막지 않는다.
  const ordered = preferenceOrder();
  const top = ordered[0];
  const swapped = await chooseFinalHeadline<MarketCandidate>({
    selection: top.selection,
    enabled: selectionOn,
    canCall: () => deadline.canStartCall(HEADLINE_EDITOR_ESTIMATE_MS),
    editor: callHeadlineEditor,
    input: { target: "market", recent: recentHeadlines, tier: defaultCtx.evidence?.tier, evidence: marketEditorEvidence(defaultCtx) },
    trySwap: (c) => {
      try {
        const next = structuredClone(top.content);
        next.cover.headline = c.headline;
        next.cover.subline = c.subline;
        const a = assessMarketContent(next, data.date, todaySources);
        const worse = a.requiredMissing.length > 0 || a.advice.length > 0 || a.base.length + a.card.length > top.base.length + top.card.length;
        return worse ? null : { ...top, content: a.content, base: a.base, card: a.card };
      } catch {
        return null;
      }
    },
  });
  if (swapped) ordered[0] = swapped;
  // Ruling 38: 선호 순서대로 마무리·렌더한다 — 고른 결과가 던지면(모양이 깨진 응답) 다음 후보로. 모두 실패할 때만 실패한다.
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx tsx --test lib/market-headline.test.ts lib/market-card-gate.test.ts lib/market-content.test.ts`
Expected: PASS. 기존 카드 관문·내용 테스트도 그대로 통과해야 한다. 그 테스트들의 응답은 옛 `cover.headline` 형식이라 후보가 하나이고, 편집자는 불리지 않는다.

Run: `npm test && npm run typecheck`
Expected: 통과

- [ ] **Step 8: 커밋한다**

```bash
git add lib/types.ts lib/claude-client.ts lib/market-headline.test.ts
git commit -m "$(cat <<'EOF'
feat: Market 제목 후보 3개·공통 기준·편집자 선택 연결

제목 작성 규칙을 공통 편집 기준과 순환 예시로 바꾸고 호기심·은유 권장·
본문 payoff 지시를 걷어 낸다. 후보는 제목 단위 검사로 거른 뒤 임시 제목을
정하고, 발송 직전 편집자가 한 번 고른다. 검증 로직은 assessMarketContent로
모아 매 시도와 교체 뒤 재검증이 같이 쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ETF 파이프라인 연결

**Files:**
- Modify: `lib/etf/types.ts` (`MorningReport.cover.headlineCandidates?`)
- Modify: `lib/etf/report-language.ts:37-42` (후보도 정규화)
- Modify: `lib/etf/report-quality.ts` (`headlineCandidateProblems` export)
- Modify: `lib/etf/claude-client.ts` (SYSTEM_PROMPT 57행, 주제 규칙 예시, 최근 제목 블록, 제목 작성 규칙, JSON 스키마, 생성 루프)
- Modify: `lib/etf/claude-client.prompt.test.ts` (기대 문구 갱신)
- Modify: `lib/etf/morning-fallback.test.ts` (테스트 추가)

**Interfaces:**
- Consumes:
  - Task 1: `takeRecentHeadlines`
  - Task 2: `renderHeadlineStandard`, `renderRecentHeadlineLines`, `pickHeadlineExemplars`, `renderHeadlineExemplars`
  - Task 3: `applyHeadlineSelection`, `chooseFinalHeadline`, `callHeadlineEditor`, `headlineSelectionEnabled`, `HEADLINE_EDITOR_ESTIMATE_MS`, `type HeadlineEditor`, `type HeadlineSelection`, `type HeadlineCandidate`
- Produces:
  - `export function headlineCandidateProblems(c: HeadlineCandidate, report: MorningReport, data: CollectedData): string[]` (`lib/etf/report-quality.ts`)
  - `MorningGenerationOptions.headlineEditor?: HeadlineEditor`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/etf/morning-fallback.test.ts` 끝에 추가한다. import도 추가한다: `import type { HeadlineEditor } from '../headline-selection'`, `import { normalizeMorningReportLanguage } from './report-language'`.

```ts
// ─── 2026-10-27 제목 편집 기준: 후보 셋 → 제목 단위 검사 → 임시 제목 → 발송 직전 편집자 한 번 ───
const SUB = validReport().cover.subline
function withCandidates(cands: Array<[string, string]>): MorningReport {
  return { ...validReport(), cover: { headlineCandidates: cands.map(([headline, subline]) => ({ headline, subline })) } as unknown as MorningReport['cover'] }
}
function fakeEditor(verdict: Awaited<ReturnType<HeadlineEditor>> | Error) {
  const seen: unknown[] = []
  const editor: HeadlineEditor = async (input) => { seen.push(input); if (verdict instanceof Error) throw verdict; return verdict }
  return { editor, seen }
}
const OFF_SUBJECT = '미 증시 소폭 상승, 금은 강세'      // 주제 자산군(반도체) 없음 — Ruling 35로 빠진다
const PROVISIONAL = '국내 반도체 급락, 미 증시는 버텼다'
const ALT = '국내 반도체 ETF 낙폭 확대'

test('ETF 제목: 주제 없는 후보는 빼고, 편집자가 고른 생존 후보로 발송한다(편집자는 생존 후보만 본다)', async (t) => {
  quiet(t)
  const gen = fakeGenerator([withCandidates([[OFF_SUBJECT, SUB], [PROVISIONAL, SUB], [ALT, SUB]])])
  const ed = fakeEditor({ pick: 1, scores: [], reason: 'r' })
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, headlineEditor: ed.editor })
  assert.equal(report.cover.headline, ALT)
  assert.equal(report.cover.headlineCandidates, undefined)
  assert.equal(ed.seen.length, 1)
  assert.deepEqual((ed.seen[0] as { candidates: Array<{ headline: string }> }).candidates.map(c => c.headline), [PROVISIONAL, ALT])
  assert.equal((ed.seen[0] as { subjectName?: string }).subjectName, '국내 반도체')
})

test('ETF 제목: 편집자가 실패하면 임시 제목(코드 점수 1위·앞 순서)으로 발송한다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([withCandidates([[OFF_SUBJECT, SUB], [PROVISIONAL, SUB], [ALT, SUB]])])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, headlineEditor: fakeEditor(new Error('timeout')).editor })
  assert.equal(report.cover.headline, PROVISIONAL)
})

test('ETF 제목: 1회차 후보가 모두 주제를 놓치면 재생성하고 2회차 결과로', async (t) => {
  quiet(t)
  const gen = fakeGenerator([withCandidates([[OFF_SUBJECT, SUB], ['미 증시 혼조, 달러는 약세', SUB]]), validReport(ALT)])
  const ed = fakeEditor({ pick: 0, scores: [], reason: '' })
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, headlineEditor: ed.editor })
  assert.equal(gen.calls(), 2)
  assert.equal(report.cover.headline, ALT)
  assert.equal(ed.seen.length, 0) // 2회차는 옛 형식(후보 하나)
})

test('ETF 제목: 투자 권유가 한 후보의 부제에만 있으면 그 후보만 빠진다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([withCandidates([[ALT, '반등이 나오면 매수하세요.'], [PROVISIONAL, SUB]])])
  const ed = fakeEditor({ pick: 0, scores: [], reason: '' })
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, headlineEditor: ed.editor })
  assert.equal(report.cover.headline, PROVISIONAL)
  assert.equal(ed.seen.length, 0) // 생존 후보 하나
})

test('ETF 제목: HEADLINE_SELECTION=off 면 편집자를 부르지 않는다', async (t) => {
  quiet(t)
  process.env.HEADLINE_SELECTION = 'off'
  t.after(() => { delete process.env.HEADLINE_SELECTION })
  const gen = fakeGenerator([withCandidates([[OFF_SUBJECT, SUB], [PROVISIONAL, SUB], [ALT, SUB]])])
  const ed = fakeEditor({ pick: 1, scores: [], reason: '' })
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, headlineEditor: ed.editor })
  assert.equal(ed.seen.length, 0)
  assert.equal(report.cover.headline, PROVISIONAL)
})

test('언어 정규화는 제목 후보도 거친다(후보로 금지 어휘가 우회되지 않게)', () => {
  const r = normalizeMorningReportLanguage({ ...validReport(), cover: { headline: 'h', subline: 's', headlineCandidates: [{ headline: '반도체 매수 검토 구간', subline: '신규 진입은 보류' }] } })
  assert.deepEqual(r.cover.headlineCandidates, [{ headline: '반도체 거래 전 점검 구간', subline: '추가 편입 판단은 보류' }])
})
```

`lib/etf/claude-client.prompt.test.ts`를 고친다.

- 첫 테스트(`'ETF 사용자 프롬프트(월요일·최근 헤드라인 있음) …'`): `assert.match(p, /tier 는 강도만 정합니다/)` → `assert.match(p, /3\. 근거 상태\(tier\)/)`
- `'ETF 시스템 프롬프트: …'` 테스트: Task 2에서 바꾼 줄 아래에 `assert.match(buildMorningPrompt(makeData('2026-09-28', [])), /\[오늘 참고할 제목 예시/)`를 추가한다.
- `'Ruling 35: 제목 규칙 1번에 …'` 테스트의 예시 단언:
  - 옛: `/해외 원인·다른 자산군과의 대비는 함께 써도 됩니다\(예: "미 반도체 급락에도 국내 헬스케어가 받쳤다"\)/`
  - 새: `/해외 원인·다른 자산군과의 대비는 함께 써도 됩니다\(예: "미 반도체 급락에도 국내 헬스케어 ETF 강세"\)\. 세 후보 모두에 적용됩니다\./`
- `'Ruling 35: 최근 헤드라인 반복 금지는 …'` 테스트:
  - 옛: `const block = p.slice(p.indexOf('[최근 ETF 리포트 헤드라인 — 절대'))`와 `.slice(0, 4)`
  - 새: `const block = p.slice(p.indexOf('[최근 ETF 리포트 헤드라인 — 같은'))`와 `.slice(0, 5)`
- 같은 파일 끝에 추가한다.

```ts
test('2026-10-27 제목 편집 기준: 공통 기준·순환 예시·후보 스키마, 옛 은유·예시 동사 지시 없음', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  assert.match(p, /\[제목 편집 기준 — Market·ETF 공통\]/)
  assert.match(p, /\[오늘 참고할 제목 예시/)
  assert.match(p, /"headlineCandidates": \[/)
  assert.match(p, /summary와의 관계: summary 세 줄은 제목과 같은 주제를 다루되/)
  for (const gone of ['(되찾다·버텼다·무너졌다)', '헬스케어가 받쳤다', '이미지를 받아 전개', '신선한 은유와 단정을 허용', 'tier 는 강도만 정합니다']) {
    assert.ok(!p.includes(gone), gone)
  }
  assert.ok(!SYSTEM_PROMPT.includes('신선하고 구체적인 은유·관점은 권장'))
  const withRecent = buildMorningPrompt({ ...withQuotes('2026-10-16', SLOT_QUOTES), recentHeadlines: ['A, B', 'C, D', 'E, F', 'G', 'H', 'I', 'J'] })
  assert.match(withRecent, /- A, B 〔쉼표 두 토막〕/)
  assert.ok(!withRecent.includes('- I 〔'), '최근 제목은 앞 5건만')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test lib/etf/morning-fallback.test.ts lib/etf/claude-client.prompt.test.ts`
Expected: FAIL. `headlineEditor` 옵션이 없고, 후보가 정규화에서 사라지고, 프롬프트 단언이 맞지 않는다.

- [ ] **Step 3: 타입과 언어 정규화**

`lib/etf/types.ts`의 `MorningReport`를 고친다.

```ts
  // 2026-10-27: headlineCandidates 는 모델이 쓰는 제목 후보 — 코드가 하나를 골라 headline·subline 에 쓰고 지운다.
  cover: { headline: string; subline: string; headlineCandidates?: Array<{ headline: string; subline: string }> }
```

`lib/etf/report-language.ts`의 cover 재구성(37-42행)을 바꾼다.

```ts
  if (isObject(report.cover)) {
    normalized.cover = {
      headline: neutralizeOptional(report.cover.headline),
      subline: neutralizeOptional(report.cover.subline),
      // 2026-10-27: 제목 후보도 같은 규칙을 거친다(후보로 금지 어휘가 우회되지 않게).
      ...(Array.isArray(report.cover.headlineCandidates)
        ? {
            headlineCandidates: report.cover.headlineCandidates.map(c => (isObject(c) ? {
              headline: neutralizeOptional(c.headline),
              subline: neutralizeOptional(c.subline),
            } : c)),
          }
        : {}),
    }
  }
```

- [ ] **Step 4: 후보 검사** — `lib/etf/report-quality.ts`

import를 추가한다: `import type { HeadlineCandidate } from '../headline-selection'`. `cardSlot`·`buildAssetClassSlots`를 이미 import하는지 확인하고, 없으면 `./asset-classes` import에 더한다. `assessMorningReportQuality` 위에 추가한다.

```ts
/**
 * 제목 후보 하나의 제목 단위 검사(2026-10-27 스펙 §3) — 위반 목록(빈 배열 = 생존). 던지지 않는다.
 * 기간 비교·최상급(Ruling 31), 주제 자산군(Ruling 35), 시장 미특정 '지수/증시/시장', 수치 대조, 투자 권유, 빈 부제, 카드 제목 넘침.
 * 주제 슬롯은 기존 검사와 같은 계산(cardSlot — card.key, 없으면 주제 슬롯)이다. 카드 한 줄 자체의 문제는 기존 검증이 본다.
 */
export function headlineCandidateProblems(c: HeadlineCandidate, report: MorningReport, data: CollectedData): string[] {
  const problems: string[] = [...comparativeClaimViolations([['cover.headline', c.headline]])]
  const card = isObjectValue(report.card) ? report.card : undefined
  const slot = cardSlot(buildAssetClassSlots(data.quotes), card?.key)
  if (slot && !headlineCoversSlot(c.headline, slot)) problems.push(`주제 자산군(${subjectNameOf(slot)})을 다루지 않음`)
  const ambiguous = [...findUnqualifiedAmbiguousWords(c.headline), ...findUnqualifiedAmbiguousWords(c.subline)]
  if (ambiguous.length > 0) problems.push(`시장이 특정되지 않은 표현: ${ambiguous.slice(0, AMBIGUOUS_SAMPLE_LIMIT).join(' | ')}`)
  const both = `${c.headline}\n${c.subline}`
  const numeric = findNumericClaimMismatches(both, data.quotes, data.indices)
  if (numeric.length > 0) problems.push(`수치가 입력 데이터와 다름: ${numeric.slice(0, 2).join(' / ')}`)
  const advice = findMatches(both, INVESTMENT_ADVICE_PATTERNS)
  if (advice.length > 0) problems.push(`투자 권유성 표현: ${advice.join(', ')}`)
  if (!isFilled(c.subline)) problems.push('subline 누락')
  const line = typeof card?.line === 'string' ? card.line : ''
  if (isFilled(line)) {
    const fit = cardTextFits('etf', { headline: c.headline, line, holdingLabel: slot?.holdingLabel ?? '' })
    problems.push(...fit.reasons.filter(r => r.startsWith('headline')).map(r => `카드 ${r}`))
  }
  return problems
}
```

`isObjectValue`, `isFilled`, `findMatches`, `findUnqualifiedAmbiguousWords`, `AMBIGUOUS_SAMPLE_LIMIT`는 이 파일 안에 이미 있다. 선언 위치가 이 함수보다 아래면 함수 선언·`const`의 TDZ를 확인한다. 이 함수는 호출 시점에만 그 값들을 쓰므로 모듈 최상위 `const`여도 문제없다.

- [ ] **Step 5: 프롬프트를 바꾼다** — `lib/etf/claude-client.ts`

a. import를 추가한다.

```ts
import { renderVoiceExemplars, pickHeadlineExemplars, renderHeadlineExemplars } from '../voice-exemplars'
// 2026-10-27 제목 편집 기준: 공통 기준 문구·최근 제목 형태·후보 선택(스펙 docs/superpowers/specs/2026-10-27-headline-editorial-design.md).
import { renderHeadlineStandard, renderRecentHeadlineLines, takeRecentHeadlines } from '../headline-editorial'
import {
  applyHeadlineSelection, chooseFinalHeadline, callHeadlineEditor, headlineSelectionEnabled, HEADLINE_EDITOR_ESTIMATE_MS,
  type HeadlineEditor, type HeadlineSelection,
} from '../headline-selection'
import { headlineCandidateProblems } from './report-quality'
```

기존 `renderVoiceExemplars` import 줄은 위 첫 줄로 대체한다. `./report-quality` import는 기존 줄에 `headlineCandidateProblems`를 더하는 방식으로 합친다.

b. `SYSTEM_PROMPT`의 `- 신선하고 구체적인 은유·관점은 권장합니다. 무엇이 진부한지는 …` 줄을 바꾼다.

`- 은유·관점은 자연스러운 한국어로 읽힐 때 씁니다. 무엇이 진부한지는 아래 [목표 보이스] 예시로 익히고, "아무 날에나 붙일 수 있는 비유"·반복되는 구문 틀은 쓰지 마십시오. (하드 금지어 목록이 아니라 결을 따르는 것입니다.)`

c. `buildHeadlineSubjectRule`의 반환 문자열 끝을 바꾼다.

옛: `…함께 써도 됩니다(예: "미 반도체 급락에도 국내 헬스케어가 받쳤다").${domesticNote}`

새: `…함께 써도 됩니다(예: "미 반도체 급락에도 국내 헬스케어 ETF 강세"). 세 후보 모두에 적용됩니다.${domesticNote}`

d. `buildMorningPrompt` 첫머리(`const featured = pickFeaturedSlot(slots)` 아래)에 추가한다.

```ts
  // 2026-10-27: 제목 비교·순환 예시·최근 제목 줄은 앞 5건만(data.recentHeadlines 7건은 catalyst 반복 감점에 그대로 쓴다).
  const recentHeadlines = takeRecentHeadlines(data.recentHeadlines ?? [])
```

e. 최근 헤드라인 블록(`${data.recentHeadlines && data.recentHeadlines.length > 0 ? \``부터 그 삼항식의 `` ` : ''} `` 끝까지)을 아래로 바꾼다.

```ts
${recentHeadlines.length > 0 ? `
[최근 ETF 리포트 헤드라인 — 같은 표현·같은 형태 반복 금지]
${renderRecentHeadlineLines(recentHeadlines)}
최근 제목과 3어절 이상 겹치거나 핵심 단어·동사를 되풀이하지 마십시오.${featured ? ` 단, 오늘의 주제 자산군 이름("${subjectNameOf(featured)}" 등)은 예외입니다 — 최근 헤드라인에 있어도 제목에 넣고, 각도·동사를 바꿉니다.` : ''}
` : ''}
```

f. `[cover.headline 작성 규칙]` 줄부터 `- 본문 payoff: …` 줄(포함)까지를 아래로 통째로 바꾼다. 1번의 세 줄과 4번의 catalyst·시장 특정·기간 비교·길이 네 줄은 원문 그대로다.

```
[cover.headline 작성 규칙]

이 헤드라인은 개장 전 한국 개인투자자가 가장 먼저 만나는 한 줄이며, 페이지 제목이자 링크 미리보기 카드의 큰 제목입니다. 한국 신문 편집자가 쓰듯 씁니다.

${renderHeadlineStandard()}

${renderHeadlineExemplars(pickHeadlineExemplars('etf', recentHeadlines, data.date))}

1. 형태 (모든 tier 공통)
- 주어·핵심 사실을 앞세워 한 호흡으로 씁니다. 정확한 등락률·티커는 cover.subline 이 받칩니다.
- 제목에는 티커·6자리 코드 대신 한국어 명칭을 씁니다 (예: SOXX → 미 반도체, GDX → 금광주, TLT → 미 장기채).
- 등락률·티커를 제목 맨 앞 앵커로 두지 마십시오. 사건의 규모를 전하는 수치 하나(20원·45조·성장률 3.5% 상향 등)는 문장 안에 둘 수 있고, 코스피 7,000·환율 1,500원 같은 심리적 분기점 숫자는 앞에 와도 됩니다.${featured ? buildHeadlineSubjectRule(featured) : ''}

2. 종결
- 기사체 '~다' 또는 서술성 명사(급등·반등·마감·경신·진입·본격화 등)로 끝냅니다.
- '~다'는 짧은 기사체 술어로 씁니다. 목적어·부사가 늘어진 산문 문장은 표제어가 아닙니다.
- 피할 형태: 시간명사 종결("~한 날", "~한 밤", "~한 하루", "~한 주말", "~한 금요일"), "~ 다음 날,"로 시작하는 틀, 존댓말 '~습니다', 체크리스트형 어미("확인", "점검", "~해야").

3. 근거 상태(tier) (위 [오늘의 근거 상태] 참조 — 블록이 없으면 thin)
- 인과 표현의 강도는 [제목 편집 기준] 3을 따릅니다.
- hollow: 사실 모드. 은유를 만들지 않고 절제된 사실로 씁니다. catalyst 반영 의무는 없습니다.

4. 그 밖의 규칙
- catalyst 반영 (기본 + 예외): strong·thin 에서 [🔥 오늘의 forward catalyst] 항목이 있으면 사건을 근거로 반영합니다. [반복 회피 — 기본보다 우선] 같은 catalyst·anchor 가 [최근 ETF 리포트 헤드라인]에 이미 등장했으면 (a) 사건의 국면·단계를 다르게(진전→타결→후속/확산/정착) 쓰거나 (b) anchor 를 subline 으로 내리고 새 각도(환율·금·은·원유·국내 ETF 등 오늘 의미 있게 움직인 지표)로 씁니다.
- 시장 특정: "지수/시장/증시" 단독 표기 금지. 어느 시장인지 명시합니다(S&P500·나스닥·코스피 등 구체 명칭, 또는 "미·국내·채권" 수식어). 해외 시장의 섹터·자산을 가리키는 단어(반도체·바이오·유틸리티·부동산·기술주 등)에는 반드시 그 시장(미·미국·중국 등)을 붙입니다 — 한국 독자는 시장 표시 없는 섹터 이름을 국내 섹터로 읽습니다(예: 미국 섹터 이야기라면 "바이오·반도체 올랐다"가 아니라 "미 바이오·반도체 올랐다").
- 기간 비교·최상급 금지: 제목·카드 문구(cover.headline·card.line)에는 'N년치·N개월치', '역대·사상 최대/최고/최저', 'N년 만에 최고/최저', '연중 최고/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않습니다 — 입력 데이터로 확인되는 수치와 사실만 씁니다. (입력의 등락률은 직전 거래일 하루 기준이라 이런 주장은 확인할 수 없습니다.)
- 길이: 14~26자 권장, 최대 28자. 프리뷰는 3줄까지만 깔끔히 렌더되므로 보조 수치·맥락은 subline 으로 넘깁니다.
- summary와의 관계: summary 세 줄은 제목과 같은 주제를 다루되 제목 문장을 되풀이하지 않습니다. 어느 후보가 뽑혀도 맞도록 씁니다.
```

g. JSON 형식의 cover 줄을 바꾼다.

옛: `"cover": { "headline": "...", "subline": "..." },`

새: `"cover": { "headlineCandidates": [ { "headline": "...", "subline": "..." }, { "headline": "...", "subline": "..." }, { "headline": "...", "subline": "..." } ] },`

- [ ] **Step 6: 생성 루프를 바꾼다** — `generateMorningReportWithFallback`

a. `MorningGenerationOptions`에 필드를 추가한다.

```ts
  // 테스트용 주입. 기본: callHeadlineEditor(생성과 같은 모델에 한 번 묻는다).
  headlineEditor?: HeadlineEditor
```

b. `kept` 배열 타입에 `selection: HeadlineSelection | null`을 더한다.

c. `const strategy = buildMorningStrategyInput(data)` 아래에 추가한다.

```ts
  // 2026-10-27 제목 편집 기준: 후보를 제목 단위 검사로 거르고 임시 제목을 정한 뒤, 발송할 결과가 정해지면 편집자에게 한 번 묻는다.
  const editor = options.headlineEditor ?? callHeadlineEditor
  const selectionOn = headlineSelectionEnabled()
  const recent = takeRecentHeadlines(data.recentHeadlines ?? [])
  const featured = pickFeaturedSlot(buildAssetClassSlots(data.quotes))
  const selectHeadline = (raw: MorningReport) =>
    applyHeadlineSelection(raw, recent, c => headlineCandidateProblems(c, raw, data), { scoring: selectionOn })
  const strictOk = (r: MorningReport) => assessMorningReportQuality(r, data, strategy).violations.length === 0
  const reducedOk = (r: MorningReport) => { validateMorningReport(r, data); return true }
  // 편집자가 다른 생존 후보를 고르면 원본(pristine)에 그 후보를 넣어 같은 검증(ok)으로 다시 본다 — 통과할 때만 그 결과로.
  const finishHeadline = async (report: MorningReport, pristine: MorningReport, selection: HeadlineSelection | null, ok: (r: MorningReport) => boolean): Promise<MorningReport> => {
    const swapped = await chooseFinalHeadline<MorningReport>({
      selection,
      enabled: selectionOn,
      canCall: () => deadline.canStartCall(HEADLINE_EDITOR_ESTIMATE_MS),
      editor,
      input: {
        target: 'etf',
        recent,
        tier: data.etfEvidence?.tier,
        subjectName: featured ? subjectNameOf(featured) : undefined,
        evidence: data.etfEvidence?.topCatalyst ? [data.etfEvidence.topCatalyst.title] : [],
      },
      trySwap: c => {
        const next = structuredClone(pristine)
        next.cover = { ...next.cover, headline: c.headline, subline: c.subline }
        try { return ok(next) ? next : null } catch { return null }
      },
    })
    return swapped ?? report
  }
```

d. 엄격 시도 루프를 고친다.
- 위로 올린 `let selection: HeadlineSelection | null = null`을 `let pristine` 선언 옆에 둔다.
- try 안 `pristine = structuredClone(raw)` 바로 앞에 `selection = selectHeadline(raw)`를 넣는다. 위치는 `isReportObject` 검사 다음이다.
- 성공 분기의 `return raw`를 `return await finishHeadline(raw, pristine, selection, strictOk)`로 바꾼다.
- `kept.push({ … attempt })`를 `kept.push({ …, attempt, selection })`으로 바꾼다.

e. Tier 1 분기의 `if (raw) { try { validateMorningReport(raw, data) … return raw } … }`를 아래로 바꾼다.

```ts
    if (raw) {
      try {
        const tierSelection = isReportObject(raw) ? selectHeadline(raw) : null
        const tierPristine = isReportObject(raw) ? structuredClone(raw) : null
        validateMorningReport(raw, data)
        console.log('  ✓ Tier 1 fallback 성공 — 경고([*-warn]·[struct-fix])가 있으면 로그를 확인하십시오')
        return tierPristine ? await finishHeadline(raw, tierPristine, tierSelection, reducedOk) : raw
      } catch (e) {
        lastError = e
        console.warn('[warn] Tier 1 fallback 결과도 축소판 검증 실패:', errorMessage(e))
      }
    }
```

f. 앞선 결과 루프를 고친다.

```ts
  for (const candidate of ranked) {
    try {
      const pristine = structuredClone(candidate.report)
      validateMorningReport(candidate.report, data)
      console.warn(`[warn] 마지막 생성을 쓰지 못해 앞선 ${candidate.attempt}회차 결과로 발송 진행(축소판 검증 통과 — 엄격 검증 위반: ${candidate.violations.join(' / ')})`)
      return await finishHeadline(candidate.report, pristine, candidate.selection, reducedOk)
    } catch (e) {
```

`kept`의 report는 이미 선택이 적용된 원본이다. 앞선 결과로 발송할 때도 편집자는 그 결과의 생존 후보 중에서 고른다.

g. `pickFeaturedSlot`, `buildAssetClassSlots`, `subjectNameOf`가 이 파일에 이미 import되어 있는지 확인한다. 셋 다 있다.

- [ ] **Step 7: 통과를 확인한다**

Run: `npx tsx --test lib/etf/morning-fallback.test.ts lib/etf/claude-client.prompt.test.ts`
Expected: PASS. 기존 테스트 모두 포함이다. 기존 픽스처는 옛 `cover.headline` 형식이라 후보가 하나이고, 편집자는 불리지 않는다.

Run: `npm test && npm run typecheck`
Expected: 통과

- [ ] **Step 8: 커밋한다**

```bash
git add lib/etf/types.ts lib/etf/report-language.ts lib/etf/report-quality.ts lib/etf/claude-client.ts lib/etf/claude-client.prompt.test.ts lib/etf/morning-fallback.test.ts
git commit -m "$(cat <<'EOF'
feat: ETF 제목 후보 3개·공통 기준·편집자 선택 연결

[cover.headline 작성 규칙]에 공통 편집 기준과 순환 예시를 넣고 은유 권장·
예시 동사·tier별 은유 강도·본문 payoff 지시를 바꾼다. 후보는 주제 자산군·
수치·권유 등 제목 단위 검사로 거르고, 엄격·Tier 1·앞선 결과 어느 경로로
발송하든 같은 방식으로 편집자가 한 번 고른다. 언어 정규화가 후보도 거친다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 통합 점검과 사용자 인계

**Files:**
- Create (커밋하지 않음): `/tmp/headline-prompt-preview/` 아래 미리보기 파일

**Interfaces:**
- Consumes: Task 1~5 전부.

- [ ] **Step 1: 전체 검증**

Run: `npm test && npm run typecheck && npm run lint`
Expected: 모두 통과. lint 경고가 이번 변경 파일에서 새로 생겼다면 고친다.

Run: `grep -rn "claude-sonnet-4-6\|claude-opus\|claude-haiku" lib scripts docs/superpowers/plans docs/superpowers/specs | grep -v node_modules`
Expected: `lib/claude-budget.ts`의 `REPORT_MODEL` 한 줄만

- [ ] **Step 2: 조립된 프롬프트를 눈으로 본다** (API 호출 없음)

```bash
mkdir -p /tmp/headline-prompt-preview
npx tsx -e '
import fs from "node:fs";
import { buildMorningPrompt } from "./lib/etf/claude-client";
import { buildReportPrompt } from "./lib/claude-client";
import { getMarketCalendarInfo } from "./lib/market-calendar";
const etfIdx = JSON.parse(fs.readFileSync("data/etf-reports-index.json","utf8")).reports;
const etf = buildMorningPrompt({ reportType: "morning", date: "2026-10-28", quotes: [], flows: [], investorFlows: [], macro: {} as never, news: [], analysisLens: "", narrativeAngle: "글로벌→국내_전이", recentHeadlines: etfIdx.map((r: {headline: string}) => r.headline).slice(0, 7), calendarInfo: getMarketCalendarInfo("2026-10-28"), failedSources: [] } as never);
const log = JSON.parse(fs.readFileSync("data/narrative-log.json","utf8")).entries.slice(0, 5);
const market = buildReportPrompt({ collectedAt: "2026-10-28T06:40:00+09:00", date: "2026-10-28", dayOfWeek: "수", koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [] } as never, { angle: { id: "a", name: "구조적 렌즈", description: "", promptGuide: "g" }, recentLog: log, sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null } as never, null);
const cut = (p: string, from: string, to: string) => p.slice(p.indexOf(from), p.indexOf(to, p.indexOf(from)));
fs.writeFileSync("/tmp/headline-prompt-preview/etf-headline.txt", cut(etf, "[cover.headline 작성 규칙]", "[준법·표현 규칙]"));
fs.writeFileSync("/tmp/headline-prompt-preview/market-headline.txt", cut(market, "### 제목 작성 규칙", "**JSON만 출력하십시오."));
console.log("ok");
'
wc -l /tmp/headline-prompt-preview/*.txt
```

두 파일을 읽고 아래를 확인한다.
- 공통 기준 → 예시 4개(문형이 모두 다름) → 기존 규칙 순서로 이어진다.
- 최근 제목 줄에 〔형태〕와 피할 형태가 나온다.
- 깨진 `${…}`와 `undefined`가 없다.

ETF 미리보기에서 `[준법·표현 규칙]`이 `[cover.headline 작성 규칙]`보다 앞에 있으면, `cut`의 끝 표지를 `아래 JSON 형식으로만 응답하십시오`로 바꿔 다시 뽑는다.

- [ ] **Step 3: Codex 읽기 전용 점검**

```bash
git worktree list   # 이 작업 worktree 경로 확인
cat > /tmp/headline-codex-prompt.md <<'EOF'
이 저장소의 feat/headline-editorial 브랜치(main 대비 커밋들)를 읽기 전용으로 점검하라. 파일을 고치지 마라.
스펙: docs/superpowers/specs/2026-10-27-headline-editorial-design.md, 계획: docs/superpowers/plans/2026-10-27-headline-editorial.md.
특히 볼 것:
1) F02 불변 — 선택 단계 때문에 발송이 막히는 경로가 있는가(편집자 예외·예산·후보 0개·후보 필드만 있고 headline 없음).
2) HARD 권유·필수 항목 누락 차단이 약해진 경로가 있는가(교체 후 재검증, 앞선 결과 경로, Tier 1 경로).
3) 후보가 렌더·인덱스·내러티브 로그·발행물 검사(published-check M5/E4)에 남거나 어긋날 수 있는가.
4) 측정 분류기가 기준선과 달라졌는가.
5) 프롬프트에 깨진 참조·모순 지시가 남았는가(제목 규칙 칸 전후).
각 지적은 파일:줄, 재현 입력, 영향으로 적어라.
EOF
codex exec -C <위 worktree 경로> -s read-only -o /tmp/headline-codex-review.md - < /tmp/headline-codex-prompt.md
```

지적은 하나씩 직접 재현해 확인한다. 맞는 것만 고치고, 테스트와 함께 커밋한다(파일 경로 명시). 아니라고 판단한 지적은 이유를 ledger에 남긴다.

- [ ] **Step 4: 사용자 인계** (여기서 멈춘다 — push·dry-run·merge는 사용자 확인 후)

사용자에게 다음을 보고한다.
1. 커밋 목록과 테스트 결과.
2. 예시 풀 전체(`MARKET_HEADLINE_POOL`, `ETF_HEADLINE_POOL`, 리포트별 20여 개)와 확정 요청. 스펙 §2에 따라 사용자 확정 뒤 운영에 넣는다.
3. 다음 단계 제안:
   - (a) 브랜치 push → `gh workflow run 260067407 --ref feat/headline-editorial -f only=both -f dry_run=true -f force_regenerate=true -f test_date=<최근 평일>` 2회로 후보·선택 로그와 결과물 확인(비용 발생).
   - (b) `--no-ff` 병합과 push.
   - (c) 시행 후 10거래일이 지나면 `HEADLINE_JUDGE_MODEL=<기준선 평가 모델> npx tsx scripts/headline-quality.ts --judge --n <시행 후 건수> --out docs/quality/headline-YYYY-MM-DD`로 재측정하고 목표표와 비교.
