// lib/etf/etf-evidence.ts
//
// Layer 0 — ETF 근거 토대. 생성 시점 신호(뉴스 건수·신선도·catalyst 점수·
// failedSources)로 근거 충분성 tier 를 판정. tier 는 헤드라인 규칙(Layer 1)이
// 소비: strong=호크+앵커 subline, thin=앵커 신중, hollow=사실 모드.
// 외부 호출 없는 순수 함수. Market evidence-confidence.ts 패턴 차용.

import type { CollectedData } from './types'
import { extractTopCatalysts, type CatalystScored } from '../catalyst-extractor'

export type EtfEvidenceTier = 'strong' | 'thin' | 'hollow'

export interface EtfEvidence {
  tier: EtfEvidenceTier
  newsCount: number
  freshCount: number          // publishedHoursAgo < FRESH_HOURS
  topCatalystScore: number    // 없으면 0
  topCatalyst: CatalystScored | null
  anomalyCount: number        // 맥락 노출용 — tier 판정엔 미사용
  failedSources: string[]
  reason: string
}

// 초안 임계값 — 1주 운영 후 실측 보정 (market-mode.ts 패턴)
const FRESH_HOURS = 12
const STRONG_CATALYST = 7

export function analyzeEtfEvidence(
  data: CollectedData,
  anomalyCount: number,
  failedSources: string[] = [],
): EtfEvidence {
  const news = data.news ?? []
  const newsCount = news.length
  const freshCount = news.filter(
    n => typeof n.publishedHoursAgo === 'number' && n.publishedHoursAgo < FRESH_HOURS,
  ).length

  const recentHeadlines = data.recentHeadlines ?? []
  const catalysts = extractTopCatalysts(news, { topN: 1, recentHeadlines })
  const topCatalyst = catalysts[0] ?? null
  const topCatalystScore = topCatalyst?.score ?? 0

  const newsFailed = failedSources.includes('news')
  const krxFailed = failedSources.includes('krx-nav')
  const hollow = catalysts.length === 0 || newsFailed || newsCount === 0
  const strong =
    !hollow && topCatalystScore >= STRONG_CATALYST && freshCount >= 1 && !krxFailed
  const tier: EtfEvidenceTier = hollow ? 'hollow' : strong ? 'strong' : 'thin'

  const reason = hollow
    ? newsFailed
      ? '뉴스 소스 실패 → 사실 모드'
      : 'minScore 통과 catalyst 없음 → 사실 모드'
    : strong
      ? `강한 catalyst(점수 ${topCatalystScore}) + 신선 뉴스 ${freshCount}건`
      : `약한 근거(최상위 점수 ${topCatalystScore}, 신선 ${freshCount}건${krxFailed ? ', KRX 실패' : ''})`

  return { tier, newsCount, freshCount, topCatalystScore, topCatalyst, anomalyCount, failedSources, reason }
}
