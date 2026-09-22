import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeKrxIntoQuotes, type KrxEtfDailyTrade } from './etf-data'
import { validateData } from './pipeline-utils'
import { detectAnomalies } from './analyzer'
import type { EtfQuote } from './types'

function yahooQuote(ticker: string, price: number, changePercent: number): EtfQuote {
  return {
    ticker, name: ticker, market: 'KR', price, change: 0, changePercent, volume: 1000,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote
}
function krxRow(ticker: string, close: number, nav: number, changePercent: number): KrxEtfDailyTrade {
  return {
    date: '20260916', ticker, name: 'KRX ' + ticker, close, change: 0, changePercent, nav,
    volume: 5000, tradingValue: 9_000_000, marketCap: 1, netAssetTotal: 2,
    underlyingIndexName: 'IDX', underlyingIndexClose: 100, underlyingIndexChangePercent: changePercent,
    premiumDiscount: ((close - nav) / nav) * 100, dailyIndexGap: 0,
  }
}

// KODEX 레버리지가 하루 +11% 움직인 날: Yahoo(D-1)=111, KRX(D-2) 종가·NAV=100
const QUOTES = [yahooQuote('122630.KS', 111, 11), yahooQuote('069500.KS', 105, 5)]
const KRX = new Map([
  ['122630.KS', krxRow('122630.KS', 100, 100, -3)],
  ['069500.KS', krxRow('069500.KS', 100, 97, -1.5)], // D-2 괴리율 +3.09%
])

test('prev-session: KRX 공식값이 가격·등락률·NAV를 채운다 (현행 동작)', () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, 'prev-session')
  assert.equal(out[0].price, 100)
  assert.equal(out[0].changePercent, -3)
  assert.equal(out[0].nav, 100)
  assert.equal(out[1].name, 'KRX 069500.KS')
})

test('stale: KRX 값이 하나도 섞이지 않는다 — Yahoo 시세 그대로, KRX 보조지표는 null', () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, 'stale')
  assert.deepEqual(out, QUOTES)
  assert.equal(out[0].nav, null)
  assert.equal(out[1].premiumDiscount, null)
})

test('none: stale과 동일', () => {
  assert.deepEqual(mergeKrxIntoQuotes(QUOTES, new Map(), 'none'), QUOTES)
})

test('하류 연결: stale 병합 결과는 가격/NAV 10% 검증을 통과하고 괴리율 이상 탐지가 0건', () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, 'stale')
  assert.doesNotThrow(() => validateData(out))
  const premium = detectAnomalies(out, [], []).filter(a => a.type === 'premiumDiscount')
  assert.equal(premium.length, 0)
})

test('회귀 증명: 날짜를 섞으면(D-1 가격 + D-2 NAV) validateData가 리포트를 중단시킨다', () => {
  const mixed = QUOTES.map(q => ({ ...q, nav: KRX.get(q.ticker)!.nav }))
  assert.throws(() => validateData(mixed), /괴리 10% 초과/)
})
