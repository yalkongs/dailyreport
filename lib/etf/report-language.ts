// lib/report-language.ts
import type { MorningReport } from './types'

export function neutralizeInvestmentLanguage(text: string): string {
  return text
    .replaceAll('일반적인 매수 검토 대상', '일반 장기투자 점검 대상')
    .replaceAll('일반 매수 검토 대상', '일반 장기투자 점검 대상')
    .replaceAll('매수 검토', '거래 전 점검')
    .replaceAll('신규 진입', '추가 편입 판단')
    .replaceAll('신규 비중 확대', '추가 노출 확대')
    .replaceAll('신규 위험자산 확대', '추가 위험자산 노출 확대')
    .replaceAll('분할 접근', '단계적 판단')
    .replaceAll('선호 ETF군', '확인 우선 ETF군')
    .replaceAll('비중 확대', '노출 확대 판단')
}

export function polishKoreanReportText(text: string): string {
  return neutralizeInvestmentLanguage(text)
    .replace(/(^|[.!?]\s+)(중립·선별 국면)\./g, '$1$2입니다.')
    .replace(/(^|[.!?]\s+)(위험자산 선호 국면)\./g, '$1$2입니다.')
    .replace(/(^|[.!?]\s+)(방어 우위 국면)\./g, '$1$2입니다.')
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function neutralizeOptional<T>(value: T): T {
  return (typeof value === 'string' ? neutralizeInvestmentLanguage(value) : value) as T
}

// 2026-10-17 출력 스키마 개편: 산문 필드 전부(cover·summary·assetCards·todayChecks·card.line·tacticalWarning)에
// 같은 규칙을 적용한다(새 필드로 "매수 검토" 같은 금지 어휘가 우회되지 않도록). key 같은 열거값은 그대로 둔다.
// 형식이 깨진 응답(필드 누락·배열 아님)에서도 던지지 않는다 — 누락은 품질 검증이 위반으로 보고한다.
export function normalizeMorningReportLanguage(report: MorningReport): MorningReport {
  const normalized: MorningReport = { ...report }
  if (isObject(report.cover)) {
    normalized.cover = {
      headline: neutralizeOptional(report.cover.headline),
      subline: neutralizeOptional(report.cover.subline),
    }
  }
  if (isObject(report.summary)) {
    normalized.summary = {
      overseas: neutralizeOptional(report.summary.overseas),
      domestic: neutralizeOptional(report.summary.domestic),
      focus: neutralizeOptional(report.summary.focus),
    }
  }
  if (Array.isArray(report.assetCards)) {
    normalized.assetCards = report.assetCards.map(card => (isObject(card) ? {
      ...card,
      ...(card.reason !== undefined ? { reason: neutralizeOptional(card.reason) } : {}),
      ifHolding: neutralizeOptional(card.ifHolding),
      ifConsidering: neutralizeOptional(card.ifConsidering),
    } : card))
  }
  if (Array.isArray(report.todayChecks)) {
    normalized.todayChecks = report.todayChecks.map(check => (isObject(check) ? {
      time: neutralizeOptional(check.time),
      what: neutralizeOptional(check.what),
      baseline: neutralizeOptional(check.baseline),
      invalidation: neutralizeOptional(check.invalidation),
    } : check))
  }
  if (isObject(report.card)) {
    normalized.card = { ...report.card, line: neutralizeOptional(report.card.line) }
  }
  if (report.tacticalWarning !== undefined) {
    normalized.tacticalWarning = neutralizeOptional(report.tacticalWarning)
  }
  return normalized
}
