// 세 줄 요약·카드 한 줄을 다루는 순수 텍스트 도구 — 부수 효과 없는 모듈.
// claude-client(검증·기본값)와 report-renderer(og:description)가 함께 쓰는데, 둘이 서로를 import하지 않도록 여기로 분리했다.

import type { ReportSummary } from "./types";

/** 인라인 태그를 벗기고 공백을 정리한 순수 텍스트(길이 검사·og:description·카드용). */
export function plainText(v: unknown): string {
  return typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
}

/** 마지막 문장 경계(마침표류, 또는 공백·끝 앞의 '다')가 max 이내인 지점에서 자른다. 경계가 없으면 말줄임표로 자른다. */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = -1;
  for (const m of text.matchAll(/[.!?](?=\s|$)|다(?=[\s.]|$)/g)) {
    const e = (m.index ?? 0) + m[0].length;
    if (e > max) break;
    end = e;
  }
  return end > 0 ? text.slice(0, end).trim() : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** og:description·인덱스 description — 세 줄 요약 중 어제+오늘을 한 문장으로, 90자 이내(문장 경계에서 자름). */
export function summarySentence(summary: ReportSummary): string {
  const joined = [plainText(summary?.yesterday), plainText(summary?.today)].filter(Boolean).join(" ");
  return cutAtSentence(joined, 90);
}
