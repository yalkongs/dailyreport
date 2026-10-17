import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAssetClassSlots, cardSlot, pickFeaturedSlot } from './asset-classes'
import { buildMosaicTiles } from '../preview/data-card'
import { KR_ETF_UNIVERSE } from './universe'
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

// Ruling 12: 유니버스의 국내 섹터·테마 전부에 theme이 있어 은행·자동차 같은 업종도 섹터 슬롯 후보가 된다.
test('유니버스: 국내 섹터·테마 ETF는 전부 theme이 있다', () => {
  const missing = KR_ETF_UNIVERSE.filter(e => (e.category === '섹터' || e.category === '테마') && !e.theme).map(e => e.name)
  assert.deepEqual(missing, [])
})

test('그날 움직인 국내 섹터: 은행 +7%가 조선 +2%를 이긴다', () => {
  const s = buildAssetClassSlots([
    q('494670.KS', 'TIGER 조선TOP10', 2.0),
    q('091170.KS', 'KODEX 은행', 7.0),
  ])
  const sector = s.find(x => x.key === 'kr-sector')!
  assert.equal(sector.label, '은행')
  assert.equal(sector.theme, '은행')
  assert.equal(sector.holdingLabel, '은행을 갖고 있다면')
  assert.deepEqual(sector.reps.map(r => r.ticker), ['091170.KS'])
})

test('같은 theme의 국내 ETF는 한 섹터로 묶인다(에너지화학 두 종 평균)', () => {
  const s = buildAssetClassSlots([
    q('117460.KS', 'KODEX 에너지화학', 3.0),
    q('139250.KS', 'TIGER 200 에너지화학', 5.0),  // 에너지화학 평균 4.0
    q('139270.KS', 'TIGER 200 금융', -3.5),
    q('300610.KS', 'TIGER K게임', 1.0),
  ])
  const sector = s.find(x => x.key === 'kr-sector')!
  assert.equal(sector.label, '에너지화학')
  assert.equal(sector.holdingLabel, '에너지화학을 갖고 있다면')
  assert.deepEqual(sector.reps.map(r => r.ticker), ['139250.KS', '117460.KS'])
})

test('TIGER 200 IT는 theme IT로 국내 반도체·IT 슬롯에 들어가고 섹터 후보가 아니다', () => {
  const s = buildAssetClassSlots([q('139260.KS', 'TIGER 200 IT', -6.0), q('091170.KS', 'KODEX 은행', 1.0)])
  assert.deepEqual(s.find(x => x.key === 'kr-semi')?.reps.map(r => r.ticker), ['139260.KS'])
  assert.equal(s.find(x => x.key === 'kr-sector')?.label, '은행')
})

test('해외 기초지수 국내 상장 ETF는 국내 슬롯에 넣지 않는다(국내 세션만)', () => {
  const s = buildAssetClassSlots([
    q('390390.KS', 'KODEX 미국반도체', -6),                             // 미국 반도체 — kr-semi 아님
    q('394670.KS', 'TIGER 글로벌리튬&2차전지SOLACTIVE(합성)', 8),        // 글로벌 — kr-sector 아님
    q('099140.KS', 'KODEX 차이나H', 3),                                 // 미국 아님 — us-equity 아님
    q('133690.KS', 'TIGER 미국나스닥100', 1.5),
  ])
  assert.deepEqual(s.map(x => x.key), ['us-equity'])
})

// Ruling 13: us-equity = 국내 상장 해외 기초지수 주식형 중 이름에 '미국'(해외지수·섹터·테마, 채권·대안 제외) + SPY·QQQ.
test('미국 주식 슬롯: KODEX 미국반도체도 포함, 미국채·미국달러 채권은 제외', () => {
  const s = buildAssetClassSlots([
    q('390390.KS', 'KODEX 미국반도체', -6),
    q('133690.KS', 'TIGER 미국나스닥100', 1.5),
    q('305080.KS', 'TIGER 미국채10년선물', 0.3),
    q('329750.KS', 'TIGER 미국달러단기채권액티브', 0.1),
    q('QQQ', 'Invesco NASDAQ-100 ETF', 0.9),
    q('IWM', 'iShares Russell 2000 ETF', 3.0),                           // SPY·QQQ만
  ])
  const us = s.find(x => x.key === 'us-equity')!
  assert.deepEqual(us.reps.map(r => r.ticker), ['390390.KS', 'QQQ'])
  assert.equal(us.movePct, -6)
  assert.deepEqual(s.find(x => x.key === 'bonds')?.reps.map(r => r.ticker), ['305080.KS']) // 달러단기채는 채권 예시에서 제외(Ruling 16)
  const noUs = buildAssetClassSlots([q('390390.KS', 'KODEX 미국반도체', -6), q('133690.KS', 'TIGER 미국나스닥100', 1.5)])
  assert.deepEqual(noUs[0].reps.map(r => r.ticker), ['390390.KS', '133690.KS']) // 해외 대표가 없으면 국내 2위
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

// Ruling 16: 달러 단기채·SOFR 같은 현금성 달러 상품은 환율 날 크게 움직여도 '채권' 예시가 아니다.
test('채권 슬롯: 현금성 달러 상품(달러단기·SOFR)은 대표 ETF에서 제외', () => {
  const s = buildAssetClassSlots([
    q('329750.KS', 'TIGER 미국달러단기채권액티브', 1.85),           // 환율 급등일 — 원화 환산으로 크게 움직임
    q('456610.KS', 'TIGER 미국달러SOFR금리액티브(합성)', 1.79),
    q('114260.KS', 'KODEX 국고채3년', 0.05),
    q('TLT', 'iShares 20+ Year Treasury Bond ETF', -0.3),
  ])
  const bonds = s.find(x => x.key === 'bonds')!
  assert.deepEqual(bonds.reps.map(r => r.ticker), ['114260.KS', 'TLT'])
  assert.equal(bonds.movePct, 0.05)
  const cashOnly = buildAssetClassSlots([q('329750.KS', 'TIGER 미국달러단기채권액티브', 1.85), q('456610.KS', 'TIGER 미국달러SOFR금리액티브(합성)', 1.79)])
  assert.deepEqual(cashOnly, [])
})

// Ruling 19: 원화 현금성 단기채(단기통안채 등)도 채권 예시가 아니다.
test('채권 슬롯: 단기통안채 같은 현금성 단기채도 대표 ETF에서 제외', () => {
  const s = buildAssetClassSlots([
    q('157450.KS', 'TIGER 단기통안채', 0.02),
    q('148070.KS', 'KIWOOM 국고채10년', -0.01),
  ])
  const bonds = s.find(x => x.key === 'bonds')!
  assert.deepEqual(bonds.reps.map(r => r.ticker), ['148070.KS'])
  assert.deepEqual(bonds.memberTickers, ['148070.KS'])
  assert.deepEqual(buildAssetClassSlots([q('157450.KS', 'TIGER 단기통안채', 0.02)]), [])
})

// ─── Ruling 21: 모자이크 강조는 테마 문자열이 아니라 슬롯 구성원을 따른다 ─────────────
const MEMBER_QUOTES = [
  q('069500.KS', 'KODEX 200', -8.21), q('102110.KS', 'TIGER 200', -8.0), q('292190.KS', 'KODEX KRX300', -7.5),
  q('229200.KS', 'KODEX 코스닥150', -6.0),                                        // 대형주 아님
  q('091160.KS', 'KODEX 반도체', -11.94), q('157490.KS', 'TIGER 소프트웨어', -5.0),  // 반도체·AI
  q('139260.KS', 'TIGER 200 IT', -9.0),                                           // IT
  q('390390.KS', 'KODEX 미국반도체', -2.0), q('SOXX', 'iShares Semiconductor ETF', -0.9), // 테마 반도체지만 국내 반도체 슬롯 밖
  q('360750.KS', 'TIGER 미국S&P500', -1.04), q('133690.KS', 'TIGER 미국나스닥100', -1.2),
  q('SPY', 'SPDR S&P 500 ETF', 0.28), q('QQQ', 'Invesco NASDAQ-100 ETF', 0.41), q('IWM', 'iShares Russell 2000 ETF', 1.0),
  q('122630.KS', 'KODEX 레버리지', -16.42),
]

function featuredFor(key: string): string[] {
  const slot = buildAssetClassSlots(MEMBER_QUOTES).find(s => s.key === key)!
  return buildMosaicTiles(MEMBER_QUOTES, new Set(slot.memberTickers)).filter(t => t.featured).map(t => t.ticker).sort()
}

test('슬롯 구성원: 대표(최대 2개)가 아니라 슬롯에 든 ETF 전부', () => {
  const semi = buildAssetClassSlots(MEMBER_QUOTES).find(s => s.key === 'kr-semi')!
  assert.equal(semi.reps.length, 2)
  assert.deepEqual([...semi.memberTickers].sort(), ['091160.KS', '139260.KS', '157490.KS'])
})

test('모자이크 강조: 국내 대형주는 구성원 타일만(코스닥150·해외지수 제외)', () => {
  assert.deepEqual(featuredFor('kr-large'), ['069500.KS', '102110.KS', '292190.KS'])
})

test('모자이크 강조: 미국 주식(환노출)은 국내 상장 미국 주식형 + SPY·QQQ만(IWM 제외)', () => {
  assert.deepEqual(featuredFor('us-equity'), ['133690.KS', '360750.KS', '390390.KS', 'QQQ', 'SPY'])
})

test('모자이크 강조: 국내 반도체·IT는 AI·IT 구성원 포함, KODEX 미국반도체·SOXX 제외', () => {
  const featured = featuredFor('kr-semi')
  assert.deepEqual(featured, ['091160.KS', '139260.KS', '157490.KS'])
  assert.ok(!featured.includes('390390.KS') && !featured.includes('SOXX'))
})

test('cardSlot: card.key 슬롯, 없거나 슬롯 밖이면 주제 슬롯', () => {
  const slots = buildAssetClassSlots(MEMBER_QUOTES)
  assert.equal(cardSlot(slots, 'us-equity')?.key, 'us-equity')
  assert.equal(cardSlot(slots, 'kr-sector')?.key, pickFeaturedSlot(slots)?.key)
  assert.equal(cardSlot(slots, undefined)?.key, pickFeaturedSlot(slots)?.key)
  assert.equal(cardSlot([], 'kr-semi'), null)
})
