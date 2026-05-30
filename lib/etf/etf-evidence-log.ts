// lib/etf/etf-evidence-log.ts
//
// B5 (2026-05-30): 매 ETF 실행의 evidence tier·mode·신호를 일별 로그에 적재.
// 임계값(FRESH_HOURS·STRONG_CATALYST·event/quiet anomaly) 운영 보정을 위한 표본 누적.
// 순수 유틸. 외부 호출 없음(파일 IO만).

import type { AnomalyType } from './types'
import { loadJson, saveJson } from './pipeline-utils'

export interface EtfEvidenceLogEntry {
  date: string
  tier: 'strong' | 'thin' | 'hollow'
  mode: 'event' | 'normal' | 'quiet'
  newsCount: number
  freshCount: number
  topCatalystScore: number
  anomalyCount: number                                     // 전체(괴리율 포함)
  anomalyBreakdown: Partial<Record<AnomalyType, number>>   // 타입별 분해
  failedSources: string[]
}

const DEFAULT_PATH = 'data/etf-evidence-log.json'
const DEFAULT_RETENTION = 60 // 초안값 — 평일 ≈ 3개월. 1~2개월 운영 후 보정.

export function appendEtfEvidenceLog(
  entry: EtfEvidenceLogEntry,
  options: { path?: string; retentionDays?: number } = {},
): void {
  const file = options.path ?? DEFAULT_PATH
  const retention = options.retentionDays ?? DEFAULT_RETENTION
  const existing = loadJson<EtfEvidenceLogEntry[]>(file, [])
  const next = [...existing, entry].slice(-retention)
  saveJson(file, next)
}
