import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAssetClassSlots, pickFeaturedSlot } from './asset-classes'
import type { EtfQuote } from './types'

const q = (ticker: string, name: string, pct: number): EtfQuote => ({
  ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
} as EtfQuote)

const QUOTES = [
  q('069500.KS', 'KODEX 200', -8.21), q('091160.KS', 'KODEX 반도체', -11.94), q('396500.KS', 'TIGER 반도체TOP10', -10.86),
  q('122630.KS', 'KODEX 레버리지', -16.42), q('360750.KS', 'TIGER 미국S&P500', -1.04), q('SPY', 'SPDR S&P 500', 0.28),
  q('TLT', 'iShares 20+ Year Treasury', 0.4), q('GLD', 'SPDR Gold', 0.5), q('305080.KS', 'TIGER 미국채10년선물', -0.2),
]

test('슬롯: 레버리지 제외, 대표 ETF 최대 2개, 중요도순', () => {
  const s = buildAssetClassSlots(QUOTES)
  assert.equal(s[0].key, 'kr-semi')
  assert.ok(s.every(x => x.reps.length >= 1 && x.reps.length <= 2))
  assert.ok(!s.some(x => x.reps.some(r => r.ticker === '122630.KS')))
  assert.equal(s.find(x => x.key === 'kr-semi')?.holdingLabel, '반도체를 갖고 있다면')
})

test('주제 슬롯: 국내 슬롯 중 움직임 최대', () => {
  assert.equal(pickFeaturedSlot(buildAssetClassSlots(QUOTES))?.key, 'kr-semi')
  assert.equal(pickFeaturedSlot([]), null)
})

test('데이터 없는 자산군은 슬롯을 만들지 않는다', () => {
  const s = buildAssetClassSlots([q('SPY', 'SPDR S&P 500', 0.3)])
  assert.deepEqual(s.map(x => x.key), ['us-equity'])
})

// ─── 세부 규칙(브리프 슬롯 정의) ──────────────────────────────────────

test('슬롯 순서·movePct는 국내 대표 등락 기준(없으면 첫 대표)', () => {
  const s = buildAssetClassSlots(QUOTES)
  assert.deepEqual(s.map(x => x.key), ['kr-semi', 'kr-large', 'us-equity', 'commodities', 'bonds'])
  const us = s.find(x => x.key === 'us-equity')!
  assert.equal(us.movePct, -1.04) // TIGER 미국S&P500 (국내 대표) — SPY +0.28이 아니라
  assert.deepEqual(us.reps.map(r => r.ticker), ['360750.KS', 'SPY'])
  const bonds = s.find(x => x.key === 'bonds')!
  assert.equal(bonds.movePct, -0.2)
  assert.deepEqual(bonds.reps.map(r => r.ticker), ['305080.KS', 'TLT'])
  const cmd = s.find(x => x.key === 'commodities')!
  assert.equal(cmd.movePct, 0.5) // 국내 대표가 없으면 첫 대표(GLD)
  assert.equal(cmd.holdingLabel, '금·원자재를 갖고 있다면')
})

test('국내 전용 슬롯은 국내 |등락| 큰 순으로 최대 2개, 라벨·주제', () => {
  const s = buildAssetClassSlots(QUOTES)
  const semi = s.find(x => x.key === 'kr-semi')!
  assert.deepEqual(semi.reps.map(r => r.ticker), ['091160.KS', '396500.KS'])
  assert.equal(semi.reps[0].name, 'KODEX 반도체')
  assert.equal(semi.reps[0].market, 'KR')
  assert.equal(semi.reps[0].pct, -11.94)
  assert.equal(semi.label, '국내 반도체·IT')
  assert.equal(semi.theme, '반도체')
  const large = s.find(x => x.key === 'kr-large')!
  assert.equal(large.label, '국내 대형주')
  assert.equal(large.holdingLabel, '국내 대형주를 갖고 있다면')
  assert.equal(large.theme, null)
  assert.equal(s.find(x => x.key === 'us-equity')?.holdingLabel, '미국 주식을 갖고 있다면')
  assert.equal(s.find(x => x.key === 'bonds')?.holdingLabel, '채권을 갖고 있다면')
})

test('그날 움직인 국내 섹터: 반도체·AI 제외, theme별 평균 |등락| 최대 theme, 받침에 따라 을/를', () => {
  const s = buildAssetClassSlots([
    q('494670.KS', 'TIGER 조선TOP10', 4.1),        // 조선 4.1
    q('449450.KS', 'PLUS K방산', 2.0),             // 방산 평균 (2.0 + 3.0) / 2 = 2.5
    q('463250.KS', 'TIGER K방산&우주', -3.0),
    q('157490.KS', 'TIGER 소프트웨어', 9.0),        // AI — 섹터 슬롯 후보 아님(kr-semi)
    q('091170.KS', 'KODEX 은행', 7.0),             // theme 없음 — 섹터 슬롯 후보 아님
  ])
  const sector = s.find(x => x.key === 'kr-sector')!
  assert.equal(sector.label, '조선')
  assert.equal(sector.theme, '조선')
  assert.equal(sector.holdingLabel, '조선을 갖고 있다면')
  assert.deepEqual(sector.reps.map(r => r.ticker), ['494670.KS'])
  assert.equal(s.find(x => x.key === 'kr-semi')?.reps[0].ticker, '157490.KS')

  const battery = buildAssetClassSlots([q('305720.KS', 'KODEX 2차전지산업', -5)]).find(x => x.key === 'kr-sector')!
  assert.equal(battery.holdingLabel, '2차전지를 갖고 있다면')
})

test('해외 기초지수 국내 상장 ETF는 국내 슬롯에 넣지 않는다(국내 세션만)', () => {
  const s = buildAssetClassSlots([
    q('390390.KS', 'KODEX 미국반도체', -6),                             // 미국 반도체 — kr-semi 아님
    q('394670.KS', 'TIGER 글로벌리튬&2차전지SOLACTIVE(합성)', 8),        // 글로벌 — kr-sector 아님
    q('099140.KS', 'KODEX 차이나H', 3),                                 // 미국 아님 — us-equity 아님
    q('133690.KS', 'TIGER 미국나스닥100', 1.5),
  ])
  assert.deepEqual(s.map(x => x.key), ['us-equity'])
  assert.deepEqual(s[0].reps.map(r => r.ticker), ['133690.KS'])
})

test('국내 대형주는 코스닥150을 넣지 않고, 원자재는 리츠·비트코인을 넣지 않는다', () => {
  const s = buildAssetClassSlots([
    q('229200.KS', 'KODEX 코스닥150', -4),
    q('VNQ', 'Vanguard Real Estate ETF', 2),
    q('BITO', 'ProShares Bitcoin ETF', 6),
  ])
  assert.deepEqual(s, [])
})

test('등락률이 없거나 유니버스 밖이면 제외, 인버스도 제외', () => {
  const s = buildAssetClassSlots([
    { ...q('069500.KS', 'KODEX 200', 0), changePercent: null },
    q('999999.KS', 'ACME 반도체', 5),
    q('252670.KS', 'KODEX 200선물인버스2X', 15.79),
    q('102110.KS', 'TIGER 200', -1.2),
  ])
  assert.deepEqual(s.map(x => x.key), ['kr-large'])
  assert.deepEqual(s[0].reps.map(r => r.ticker), ['102110.KS'])
})

test('주제 슬롯: 국내 슬롯이 없으면 첫 슬롯', () => {
  const s = buildAssetClassSlots([q('SPY', 'SPDR S&P 500', 0.3), q('GLD', 'SPDR Gold', -2)])
  assert.equal(s[0].key, 'commodities')
  assert.equal(pickFeaturedSlot(s)?.key, 'commodities')
})
