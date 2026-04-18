// lib/report-quality.ts
import type { CollectedData, MorningReport, MorningStrategyInput } from './types'

const INVESTMENT_ADVICE_PATTERNS = [
  /강력\s*매수/,
  /무조건/,
  /지금\s*사/,
  /매수해야/,
  /매도해야/,
  /매수\s*검토/,
  /신규\s*진입/,
  /분할\s*접근/,
  /비중\s*확대/,
  /선호\s*ETF군/,
  /일반적인\s*매수/,
  /확실/,
  /폭등\s*예상/,
]

const FLOW_WORD_PATTERNS = [
  /자금\s*유입/,
  /자금\s*유출/,
  /순유입/,
  /순유출/,
  /flow/i,
  /fund\s*flow/i,
]

const NEWS_OVERREACH_PATTERNS = [
  /보도에\s*따르면/,
  /기사에\s*따르면/,
  /전문가들은/,
  /시장에서는/,
]

const STYLE_ISSUE_PATTERNS = [
  /ETF은/,
  /가능성이\s*존재합니다/,
  /가능성이\s*있습니다/,
  /구조입니다/,
  /시사합니다/,
  /나타냅니다/,
  /판단됩니다/,
  /보입니다/,
  /투자에\s*주의하시기\s*바랍니다/,
  /확인이\s*필요합니다/,
  /주목해야\s*합니다/,
  /직접\s*연결됩니다/,
  /필수/,
]

const UNFORMATTED_USD_KRW_PATTERN = /USD\/KRW\s+(?:1[0-9]{3}|[2-9][0-9]{3})(?![,\d])/g
const RAW_KRW_AMOUNT_PATTERN = /\d{10,}원/g
const ETF_OR_NUMBER_PATTERN = /([A-Z]{2,5}|[가-힣A-Za-z]+ ETF|ETF|USD\/KRW|US 10Y|VIX|NAV|거래대금|\d+(?:,\d{3})*(?:\.\d+)?%?)/

function flattenMorningReport(report: MorningReport): string {
  return [
    report.cover.headline,
    report.cover.subline,
    report.overnightBrief.narrative,
    report.overnightBrief.krImpact,
    report.usEtfHighlights.topMover.reason,
    report.usEtfHighlights.bottomMover.reason,
    report.usEtfHighlights.sectorNarrative,
    ...report.todayWatch.items.flatMap(item => [item.title, item.body]),
    report.closingLine,
  ].join('\n')
}

function findMatches(text: string, patterns: RegExp[]): string[] {
  return patterns.filter(p => p.test(text)).map(p => p.source)
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]?/g)?.map(s => s.trim()).filter(Boolean) ?? []
}

function duplicateSentences(text: string): string[] {
  const counts = new Map<string, number>()
  for (const sentence of splitSentences(text)) {
    const normalized = sentence.replace(/\s+/g, ' ')
    if (normalized.length < 18) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([sentence]) => sentence)
}

export function validateMorningReportQuality(
  report: MorningReport,
  data: CollectedData,
  strategy: MorningStrategyInput
): void {
  const text = flattenMorningReport(report)
  const violations: string[] = []

  const adviceMatches = findMatches(text, INVESTMENT_ADVICE_PATTERNS)
  if (adviceMatches.length > 0) {
    violations.push(`투자 권유성 표현 감지: ${adviceMatches.join(', ')}`)
  }

  if (!strategy.dataCoverage.hasRealFlowData) {
    const flowMatches = findMatches(text, FLOW_WORD_PATTERNS)
    if (flowMatches.length > 0) {
      violations.push('실제 fund flow 데이터가 없는데 자금 유입/유출 표현을 사용했습니다')
    }
  }

  const hasNewsBody = data.news.some(n => n.title.length > 0 && n.url.length > 0)
  if (hasNewsBody) {
    const newsMatches = findMatches(text, NEWS_OVERREACH_PATTERNS)
    if (newsMatches.length > 0) {
      violations.push(`뉴스 제목 이상의 단정 표현 감지: ${newsMatches.join(', ')}`)
    }
  }

  const styleMatches = findMatches(text, STYLE_ISSUE_PATTERNS)
  if (styleMatches.length > 0) {
    violations.push(`문체 개선 필요 표현 감지: ${styleMatches.join(', ')}`)
  }

  const repeated = duplicateSentences(text)
  if (repeated.length > 0) {
    violations.push(`중복 문장 감지: ${repeated.slice(0, 2).join(' / ')}`)
  }

  const unformattedUsdKrw = text.match(UNFORMATTED_USD_KRW_PATTERN)
  if (unformattedUsdKrw) {
    violations.push(`USD/KRW 천 단위 쉼표 누락: ${unformattedUsdKrw.join(', ')}`)
  }

  const rawKrwAmount = text.match(RAW_KRW_AMOUNT_PATTERN)
  if (rawKrwAmount) {
    violations.push(`원화 금액은 억 원/조 원 단위로 축약해야 합니다: ${rawKrwAmount.slice(0, 2).join(', ')}`)
  }

  const weakActionCount = (text.match(/확인합니다|점검합니다|봅니다/g) ?? []).length
  if (weakActionCount >= 10) {
    violations.push('확인/점검/봅니다 문장이 과도합니다. 확인 결과에 따른 행동 기준까지 써야 합니다')
  }

  if (/\b\d{6}\.(KS|KQ)\b/i.test(text)) {
    violations.push('국내 ETF는 "종목명 (6자리 코드)" 형식으로 표기해야 합니다')
  }

  if (report.todayWatch.items.length < 3) {
    violations.push('Today Watch 항목은 국내 개장, 환율/금리, ETF 실행 리스크를 포함해 최소 3개가 필요합니다')
  }

  const vagueWatchItems = report.todayWatch.items.filter(item => !ETF_OR_NUMBER_PATTERN.test(item.body))
  if (vagueWatchItems.length > 0) {
    violations.push('Today Watch 각 항목은 ETF명, 수치, NAV, 거래대금 등 구체적 확인 대상을 포함해야 합니다')
  }

  const krImpactHasBridge = /(SOXX|QQQ|TLT|USD\/KRW|VIX|US 10Y).*(\(\d{6}\)|국내|KODEX|TIGER)|(\(\d{6}\)|국내|KODEX|TIGER).*(SOXX|QQQ|TLT|USD\/KRW|VIX|US 10Y)/.test(report.overnightBrief.krImpact)
  if (!krImpactHasBridge) {
    violations.push('krImpact는 해외 ETF 또는 거시지표와 국내 ETF 실행 확인점을 직접 연결해야 합니다')
  }

  if (violations.length > 0) {
    throw new Error(`[report-quality] Morning 리포트 품질 검증 실패\n- ${violations.join('\n- ')}`)
  }
}
