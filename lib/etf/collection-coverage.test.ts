// lib/etf/collection-coverage.test.ts
// F01 (2026-10-16 감사): 실패한 종목이 배열에서 빠지면 1/1이 '성공'으로 보였다. 유니버스 기준 커버리지와
// 비정상 가격(NaN·0·음수)을 검사한다.
// F09: Yahoo에서 빠진 국내 종목을 정상 KRX 전일 행으로 복구한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateData, sanitizeQuotes } from './pipeline-utils'
import { mergeKrxIntoQuotes, type KrxEtfDailyTrade } from './etf-data'
import type { EtfQuote } from './types'

function q(ticker: string, price: number | null, market: 'KR' | 'US' = ticker.endsWith('.KS') ? 'KR' : 'US'): EtfQuote {
  return {
    ticker, name: ticker, market, price, change: 0, changePercent: price === null ? null : 1, volume: 1,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote
}

test('F01: 유니버스 기준 — 100종 중 1종만 남으면 실패', () => {
  assert.throws(() => validateData([q('SPY', 500)], { KR: 55, US: 45 }), /수집 성공률/)
})

test('F01: 국내 전량 누락이면 실패(미국이 다 있어도)', () => {
  const us = Array.from({ length: 45 }, (_, i) => q(`U${String.fromCharCode(65 + (i % 26))}${i}`, 100, 'US'))
  assert.throws(() => validateData(us, { KR: 55, US: 45 }), /KR 수집 성공률/)
})

test('F01: 정상 커버리지는 통과, 기대치 없이 부르면 기존 동작', () => {
  const kr = Array.from({ length: 50 }, (_, i) => q(`${String(100000 + i)}.KS`, 100))
  const us = Array.from({ length: 40 }, (_, i) => q(`US${i}`, 100, 'US'))
  assert.doesNotThrow(() => validateData([...kr, ...us], { KR: 55, US: 45 }))
  assert.doesNotThrow(() => validateData([q('SPY', 500)]))
})

test('F01: NaN·0·음수 가격은 결측으로 바꾼다', () => {
  const { quotes, invalidCount } = sanitizeQuotes([q('SPY', NaN), q('QQQ', -5), q('IWM', 0), q('TLT', 90)])
  assert.equal(invalidCount, 3)
  assert.deepEqual(quotes.map(x => x.price), [null, null, null, 90])
  assert.deepEqual(quotes.map(x => x.changePercent), [null, null, null, 1])
})

function krxRow(ticker: string, name: string, close: number): KrxEtfDailyTrade {
  return {
    date: '20261015', ticker, name, close, change: -10, changePercent: -1.5, nav: close, volume: 1000,
    tradingValue: 5e9, marketCap: 1, netAssetTotal: 2, underlyingIndexName: 'IDX', underlyingIndexClose: 100,
    underlyingIndexChangePercent: -1.4, premiumDiscount: 0.1, dailyIndexGap: -0.1,
  }
}

test('F09: Yahoo에서 빠진 국내 유니버스 종목을 KRX 전일 행으로 복구', () => {
  const yahoo = [q('SPY', 500)]
  const krx = new Map([['069500.KS', krxRow('069500.KS', 'KODEX 200', 30000)]])
  const out = mergeKrxIntoQuotes(yahoo, krx, 'prev-session')
  const kodex = out.find(x => x.ticker === '069500.KS')
  assert.ok(kodex, 'KRX로 복구')
  assert.equal(kodex.market, 'KR')
  assert.equal(kodex.price, 30000)
  assert.equal(kodex.changePercent, -1.5)
  assert.equal(kodex.nav, 30000)
})

test('F09: 유니버스 밖 KRX 행·stale 세션은 복구하지 않는다', () => {
  const krx = new Map([['999999.KS', krxRow('999999.KS', 'ACME', 100)], ['069500.KS', krxRow('069500.KS', 'KODEX 200', 30000)]])
  assert.equal(mergeKrxIntoQuotes([], krx, 'prev-session').some(x => x.ticker === '999999.KS'), false)
  assert.equal(mergeKrxIntoQuotes([], krx, 'stale').length, 0)
})

test('F09: 거시 지표 전량 null은 실패 소스로 판정', async () => {
  const { isMacroEmpty } = await import('./market-context')
  assert.equal(isMacroEmpty({ usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: 40, wti: null, gold: null }), true)
  assert.equal(isMacroEmpty({ usdKrw: 1400, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null }), false)
})
