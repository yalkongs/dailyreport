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

export async function extractNarrativeFromHtml(
  html: string,
  date: string,
  angleId: string
): Promise<NarrativeLogEntry> {
  const client = new Anthropic();

  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `아래 HTML 리포트에서 내러티브 요소를 추출하여 JSON으로 반환하세요.

반드시 다음 형식의 JSON만 반환하세요 (설명 없이):
{
  "headline": "리포트의 메인 헤드라인 (20자 이내)",
  "bigStoryTopic": "빅스토리의 핵심 주제 (예: 유가 급등 → 인플레이션)",
  "walletTopics": ["내 지갑 섹션에서 다룬 토픽들"],
  "metaphors": ["사용된 주요 비유/은유 표현들"],
  "lookingAhead": "앞으로의 방향 섹션의 핵심 (20자 이내)"
}

HTML:
${html.substring(0, 3000)}...`,
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
    return {
      date,
      narrativeAngle: angleId,
      headline: parsed.headline || "",
      bigStoryTopic: parsed.bigStoryTopic || "",
      walletTopics: parsed.walletTopics || [],
      metaphors: parsed.metaphors || [],
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
