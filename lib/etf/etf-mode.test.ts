import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEtfMode } from './etf-mode'
import type { CollectedData, EtfQuote, Anomaly, MacroContext } from './types'

function q(ticker: string, changePercent: number): EtfQuote {
  return {
    ticker, name: ticker, market: ticker.endsWith('.KS') ? 'KR' : 'US',
    price: 100, change: 0, changePercent,
    volume: null, aum: null, nav: null, premiumDiscount: null,
    trackingError: null, prev20AvgVolume: null,
  }
}
function anom(type: Anomaly['type']): Anomaly {
  return { ticker: 'X', market: 'US', type, value: 1, threshold: 0.5, severity: 'warning' }
}
function data(quotes: EtfQuote[]): CollectedData {
  return {
    reportType: 'morning', date: '2026-05-29', quotes,
    flows: [], investorFlows: [], macro: {} as MacroContext, news: [], analysisLens: 'x',
  }
}
// SOXX 0.2% · SPY 0.1% → coreAvgAbs 0.15 < 0.5 (가격 평온)
const calm = [q('SOXX', 0.2), q('SPY', 0.1)]

test('괴리율 10건만 + 가격 평온 → event 아님, quiet', () => {
  const anomalies = Array.from({ length: 10 }, () => anom('premiumDiscount'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.notEqual(r.mode, 'event')
  assert.equal(r.mode, 'quiet')
})

test('유의미 이상치(trackingError) 5건 → event', () => {
  const anomalies = Array.from({ length: 5 }, () => anom('trackingError'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.mode, 'event')
})

test('가격 트리거(SOXX 3.5%) → event (이상치 무관)', () => {
  const r = analyzeEtfMode(data([q('SOXX', 3.5), q('SPY', 0.1)]), [])
  assert.equal(r.mode, 'event')
})

test('괴리율 다수 + 가격 평온 + 유의미 0 → quiet (과거엔 억제됐던 케이스)', () => {
  const anomalies = Array.from({ length: 8 }, () => anom('premiumDiscount'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.mode, 'quiet')
})

test('metrics.anomalyCount는 전체(괴리율 포함) 유지', () => {
  const anomalies = [
    ...Array.from({ length: 6 }, () => anom('premiumDiscount')),
    anom('trackingError'),
  ]
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.metrics.anomalyCount, 7)
})
