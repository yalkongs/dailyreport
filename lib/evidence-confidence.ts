// lib/evidence-confidence.ts
//
// Layer 0 — 근거 토대. 생성 시점에 이미 수집된 신호(뉴스 건수·신선도·
// catalyst 점수·contextErrors)만으로 근거 충분성 tier 를 판정한다.
// 외부 호출 없는 순수 함수. 새 데이터 소스 없음.
//
// tier 는 제목 규칙(Layer 1)이 소비한다: strong=은유 전면, thin=은유 신중,
// hollow=사실 모드(은유 만들지 말 것).

import type { ContextData, NewsHeadline } from "./types";
import { extractTopCatalysts, type CatalystScored } from "./catalyst-extractor";

export type EvidenceTier = "strong" | "thin" | "hollow";

export interface EvidenceConfidence {
  tier: EvidenceTier;
  newsCount: number;
  freshCount: number;          // publishedHoursAgo < FRESH_HOURS 인 건수
  topCatalystScore: number;    // 최상위 catalyst 점수 (없으면 0)
  topCatalyst: CatalystScored | null;
  failedSources: string[];     // contextErrors 의 source 목록
  reason: string;              // 사람이 읽는 판정 근거 (로그·프롬프트용)
}

// 초안 임계값 — 1주 운영 후 실측 분포로 보정 (market-mode.ts 패턴).
const FRESH_HOURS = 12;
const STRONG_CATALYST = 7;

export function analyzeEvidenceConfidence(
  context: ContextData | null,
  recentHeadlines: string[] = [],
): EvidenceConfidence {
  const news: NewsHeadline[] = context?.news ?? [];
  const failedSources = (context?.contextErrors ?? []).map((e) => e.source);
  const newsCount = news.length;
  const freshCount = news.filter(
    (n) => typeof n.publishedHoursAgo === "number" && n.publishedHoursAgo < FRESH_HOURS,
  ).length;

  // extractTopCatalysts 가 minScore=4 미만을 이미 걸러냄.
  // 결과가 0건이면 곧 "강한 forward catalyst 부재".
  const catalysts = extractTopCatalysts(news, { topN: 1, recentHeadlines });
  const topCatalyst = catalysts[0] ?? null;
  const topCatalystScore = topCatalyst?.score ?? 0;

  const newsFailed = failedSources.includes("news");
  const hollow = catalysts.length === 0 || newsFailed;
  const strong = !hollow && topCatalystScore >= STRONG_CATALYST && freshCount >= 1;
  const tier: EvidenceTier = hollow ? "hollow" : strong ? "strong" : "thin";

  const reason = hollow
    ? newsFailed
      ? "뉴스 소스 수집 실패 → 사실 모드"
      : "minScore 통과 catalyst 없음 → 사실 모드"
    : strong
      ? `강한 catalyst(점수 ${topCatalystScore}) + 신선 뉴스 ${freshCount}건`
      : `약한 근거(최상위 점수 ${topCatalystScore}, 신선 ${freshCount}건)`;

  return { tier, newsCount, freshCount, topCatalystScore, topCatalyst, failedSources, reason };
}
