// lib/etf/pipeline-utils.ts  (originally scripts/utils.ts in etfreport)
import * as fs from 'fs'
import * as path from 'path'
import type { EtfQuote, ReportMeta, ReportsIndex } from './types'
import { loadJson } from './json-helpers'
export { loadJson } from './json-helpers'

// ETF-specific index path (distinct from the market report index)
export const ETF_REPORTS_INDEX_PATH = 'data/etf-reports-index.json'

export function saveJson(filePath: string, data: unknown): void {
  const abs = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf-8')
}

export function updateReportsIndex(meta: ReportMeta): void {
  const index = loadJson<ReportsIndex>(ETF_REPORTS_INDEX_PATH, { reports: [] })
  const exists = index.reports.findIndex(r => r.date === meta.date)
  if (exists >= 0) {
    index.reports[exists] = meta
  } else {
    index.reports.unshift(meta)
  }
  // 최근 180개만 유지
  index.reports = index.reports.slice(0, 180)
  saveJson(ETF_REPORTS_INDEX_PATH, index)
}

const isValidPrice = (p: number | null | undefined): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0

// F01 (2026-10-16 감사): NaN·0·음수 가격은 결측으로 바꾼다(렌더에 'NaN'이 찍히지 않게, 실패율에 반영되게).
export function sanitizeQuotes(quotes: EtfQuote[]): { quotes: EtfQuote[]; invalidCount: number } {
  let invalidCount = 0
  const out = quotes.map(q => {
    if (q.price === null || isValidPrice(q.price)) return q
    invalidCount++
    return { ...q, price: null, change: null, changePercent: null }
  })
  return { quotes: out, invalidCount }
}

/**
 * expected(유니버스 종목 수)를 주면 시장별 커버리지를 유니버스 기준으로 검사한다(F01). 실패 종목이
 * 배열에서 빠지면 남은 1종이 1/1 '성공'으로 보이던 분모 문제를 막는다. 기준: 시장별 60% 이상.
 */
export function validateData(quotes: EtfQuote[], expected?: { KR: number; US: number }): void {
  if (quotes.length === 0) throw new Error('수집된 ETF 시세가 없습니다')
  if (expected) {
    for (const market of ['KR', 'US'] as const) {
      const total = expected[market]
      if (total <= 0) continue
      const valid = quotes.filter(q => q.market === market && isValidPrice(q.price)).length
      if (valid / total < 0.6) {
        throw new Error(`${market} 수집 성공률 ${((valid / total) * 100).toFixed(0)}% (${valid}/${total}, 유니버스 기준 60% 미만)`)
      }
    }
  }
  const nullCount = quotes.filter(q => !isValidPrice(q.price)).length
  const failRate = nullCount / quotes.length
  if (failRate > 0.4) {
    throw new Error(`데이터 수집 실패율 ${(failRate * 100).toFixed(0)}% 초과 (${nullCount}/${quotes.length})`)
  }

  const duplicateTickers = quotes
    .map(q => q.ticker)
    .filter((ticker, index, tickers) => tickers.indexOf(ticker) !== index)
  if (duplicateTickers.length > 0) {
    throw new Error(`중복 ETF 티커 감지: ${[...new Set(duplicateTickers)].slice(0, 5).join(', ')}`)
  }

  const invalidKrNav = quotes.filter(q =>
    q.market === 'KR' &&
    q.price !== null &&
    q.nav !== null &&
    q.nav > 0 &&
    Math.abs((q.price - q.nav) / q.nav) > 0.1
  )
  if (invalidKrNav.length > 0) {
    const sample = invalidKrNav.slice(0, 3).map(q => `${q.name} ${q.ticker}`).join(', ')
    throw new Error(`국내 ETF 가격/NAV 괴리 10% 초과 데이터 감지: ${sample}`)
  }

  console.log(`[validate] 수집 성공: ${quotes.length - nullCount}/${quotes.length}`)
}
