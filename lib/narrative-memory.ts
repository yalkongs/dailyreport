import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { NarrativeLog, NarrativeLogEntry } from "./types";

const LOG_PATH = path.join(process.cwd(), "data", "narrative-log.json");
const MAX_ENTRIES = 30;

export function loadNarrativeLog(): NarrativeLog {
  if (fs.existsSync(LOG_PATH)) {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  }
  return { entries: [] };
}

export function getRecentEntries(count: number = 5): NarrativeLogEntry[] {
  const log = loadNarrativeLog();
  return log.entries.slice(0, count);
}

export function saveNarrativeEntry(entry: NarrativeLogEntry): void {
  const log = loadNarrativeLog();

  // 같은 날짜 엔트리 교체
  const existingIdx = log.entries.findIndex((e) => e.date === entry.date);
  if (existingIdx >= 0) {
    log.entries[existingIdx] = entry;
  } else {
    log.entries.unshift(entry);
  }

  // 최대 30일치만 보관
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(0, MAX_ENTRIES);
  }

  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
}

/**
 * HTML에서 텍스트만 추출 (태그 제거, 공백 정리)
 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HTML에서 섹션별 핵심 텍스트를 추출하여 구조화
 */
function extractKeySections(html: string): string {
  const sections: string[] = [];

  // 커버 헤드라인 추출
  const headlineMatch = html.match(/class="cover-headline"[^>]*>([\s\S]*?)<\//i);
  if (headlineMatch) {
    sections.push(`[헤드라인] ${stripHtmlToText(headlineMatch[1])}`);
  }

  // 커버 서브라인 추출
  const sublineMatch = html.match(/class="cover-subline"[^>]*>([\s\S]*?)<\//i);
  if (sublineMatch) {
    sections.push(`[서브라인] ${stripHtmlToText(sublineMatch[1])}`);
  }

  // 섹션 타이틀들 추출
  const sectionTitleRegex = /class="section-title"[^>]*>([\s\S]*?)<\//gi;
  let match;
  while ((match = sectionTitleRegex.exec(html)) !== null) {
    sections.push(`[섹션] ${stripHtmlToText(match[1])}`);
  }

  // narrative 본문 추출 (pull-quote, compass, sowhat 등 핵심 텍스트)
  const pullQuoteRegex = /class="pull-quote"[^>]*>([\s\S]*?)<\/div>/gi;
  while ((match = pullQuoteRegex.exec(html)) !== null) {
    sections.push(`[인용] ${stripHtmlToText(match[1])}`);
  }

  // sowhat 카드 제목 + 내용
  const sowhatRegex = /class="sowhat-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((match = sowhatRegex.exec(html)) !== null) {
    const title = match[1].match(/class="sowhat-title"[^>]*>([\s\S]*?)<\//i);
    const body = stripHtmlToText(match[1]);
    if (title) sections.push(`[So What] ${stripHtmlToText(title[1])}: ${body.substring(0, 200)}`);
  }

  // watch 카드 제목 + 내용
  const watchRegex = /class="watch-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((match = watchRegex.exec(html)) !== null) {
    const title = match[1].match(/class="watch-title"[^>]*>([\s\S]*?)<\//i);
    if (title) sections.push(`[관찰] ${stripHtmlToText(title[1])}`);
  }

  // compass 본문
  const compassRegex = /class="compass-box"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((match = compassRegex.exec(html)) !== null) {
    const title = match[1].match(/class="compass-title"[^>]*>([\s\S]*?)<\//i);
    if (title) sections.push(`[나침반] ${stripHtmlToText(title[1])}`);
  }

  // 섹션 정보가 부족하면 전체 텍스트에서 추출
  if (sections.length < 3) {
    const fullText = stripHtmlToText(html);
    sections.push(`[전체텍스트] ${fullText.substring(0, 3000)}`);
  }

  return sections.join("\n");
}

/** 금지 표현 목록 — 내러티브 로그에 기록하지 않을 뻔한 비유들 */
const BANNED_METAPHORS = [
  "파도", "항해", "나침반", "폭풍", "등대", "파고",
  "불꽃", "뇌관", "도화선", "시한폭탄",
  "롤러코스터", "시소", "줄타기",
  "유령", "악몽", "그림자",
];

function filterBannedMetaphors(metaphors: string[]): string[] {
  return metaphors.filter((m) => {
    const lower = m.toLowerCase();
    return !BANNED_METAPHORS.some((banned) => lower.includes(banned));
  });
}

export async function extractNarrativeFromHtml(
  html: string,
  date: string,
  angleId: string
): Promise<NarrativeLogEntry> {
  const client = new Anthropic();

  // 구조화된 섹션 텍스트 추출 (전체 HTML 분석)
  const structuredText = extractKeySections(html);

  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `아래는 금융 시장 리포트에서 추출한 구조화된 텍스트입니다.
이 리포트의 내러티브 요소를 분석하여 JSON으로 반환하세요.

## 추출 규칙
1. headline: 커버 헤드라인 원문 그대로 (없으면 빅스토리 주제로 20자 이내 요약)
2. bigStoryTopic: 메인 스토리의 핵심 인과관계 (예: "유가 급등 → 인플레이션 우려")
3. walletTopics: "So What" 또는 "내 지갑" 섹션에서 다룬 구체적 토픽들 (예: ["주유비", "해외직구", "적금 금리"])
4. metaphors: 리포트에서 실제 사용된 비유적 표현들만 추출 (뻔한 표현 제외: 파도, 항해, 롤러코스터, 폭풍, 시한폭탄 등)
5. lookingAhead: "관찰 포인트" 또는 "Looking Ahead" 섹션의 핵심 이벤트 (20자 이내)
6. compassTopics: "투자 나침반" 섹션에서 다룬 토픽들 (없으면 빈 배열)

반드시 다음 형식의 JSON만 반환하세요 (설명 없이):
{
  "headline": "",
  "bigStoryTopic": "",
  "walletTopics": [],
  "metaphors": [],
  "lookingAhead": "",
  "compassTopics": []
}

## 리포트 구조화 텍스트:
${structuredText}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return fallbackEntry(date, angleId);
  }

  try {
    let jsonStr = textBlock.text.trim();
    // 코드 블록 제거
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(jsonStr);

    // 금지 비유 필터링
    const rawMetaphors: string[] = parsed.metaphors || [];
    const filteredMetaphors = filterBannedMetaphors(rawMetaphors);

    return {
      date,
      narrativeAngle: angleId,
      headline: parsed.headline || "",
      bigStoryTopic: parsed.bigStoryTopic || "",
      walletTopics: [
        ...(parsed.walletTopics || []),
        ...(parsed.compassTopics || []),
      ],
      metaphors: filteredMetaphors,
      lookingAhead: parsed.lookingAhead || "",
    };
  } catch {
    return fallbackEntry(date, angleId);
  }
}

function fallbackEntry(date: string, angleId: string): NarrativeLogEntry {
  return {
    date,
    narrativeAngle: angleId,
    headline: "",
    bigStoryTopic: "",
    walletTopics: [],
    metaphors: [],
    lookingAhead: "",
  };
}
