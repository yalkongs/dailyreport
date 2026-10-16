// lib/etf/numeric-claims.test.ts
// C01·C04 (2026-10-16 감사): 본문의 "대상 + 등락률" 주장을 실제 데이터와 대조한다.
// 사례는 실제 발행물에서 확인된 오류(ETF14·ETF16)와 같은 형태다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNumericClaimMismatches } from './numeric-claims'
import type { EtfQuote, IndexQuote } from './types'

function q(ticker: string, name: string, changePercent: number): EtfQuote {
  return {
    ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent, volume: 1,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote
}

const QUOTES = [
  q('091160.KS', 'KODEX 반도체', -3.96),
  q('396500.KS', 'TIGER 반도체TOP10', -8.24),
  q('069500.KS', 'KODEX 200', -6.25),
  q('252670.KS', 'KODEX 200선물인버스2X', 12.1),
  q('SOXX', 'iShares Semiconductor ETF', -0.17),
  q('QQQ', 'Invesco QQQ Trust', -0.33),
]
const INDICES: IndexQuote[] = [
  { symbol: '^KS11', nameKo: '코스피', price: 6035.35, changePercent: -5.46, asOf: '2026-10-13' },
  { symbol: '^IXIC', nameKo: '나스닥', price: 22000, changePercent: -0.15, asOf: '2026-10-13' },
]

const check = (text: string, indices: IndexQuote[] | undefined = INDICES) => findNumericClaimMismatches(text, QUOTES, indices)

test('C01: ETF 등락을 코스피 등락으로 쓴 문장을 잡는다', () => {
  assert.equal(check('전일 코스피가 6.21% 밀리는 사이 간밤 S&P500은 사실상 정지했습니다.').length, 1)
  assert.equal(check('전 거래일 코스피가 8% 넘게 내려앉은 배경에는 AI 수익성 우려가 있었습니다.', [
    { symbol: '^KS11', nameKo: '코스피', price: 5554, changePercent: -7.57, asOf: '2026-10-15' },
  ]).length, 1)
  assert.equal(check('간밤 나스닥은 -0.33%로 사실상 정지에 가까웠습니다.').length, 1)
})

test('C04: 같은 ETF의 카드 수치와 다른 본문 수치를 잡는다(각각 포함)', () => {
  assert.equal(check('KODEX 반도체 (091160)는 전일 -8%대 낙폭 이후 오늘의 핵심 관찰 ETF입니다.').length, 1)
  const both = check('전일 KODEX 반도체 (091160)와 TIGER 반도체TOP10 (396500)이 각각 8%대 하락을 기록했습니다.')
  assert.equal(both.length, 1)
  assert.match(both[0], /KODEX 반도체/)
})

test('맞는 수치·반올림·범위 표현은 통과한다', () => {
  assert.deepEqual(check('전일 코스피는 5.46% 하락했고 KODEX 반도체 (091160)는 -3.96%였습니다.'), [])
  assert.deepEqual(check('KODEX 반도체 (091160)는 약 4% 내렸습니다.'), [])
  assert.deepEqual(check('TIGER 반도체TOP10 (396500)은 8%대 하락했습니다.'), [])
  assert.deepEqual(check('코스피가 5% 넘게 밀렸습니다.'), [])
  assert.deepEqual(check('SOXX는 -0.17%에 그쳤습니다.'), [])
})

test('다른 대상·다른 지표의 퍼센트는 대조하지 않는다', () => {
  // 긴 이름 우선: 'KODEX 200선물인버스2X'를 'KODEX 200'으로 오인하지 않는다
  assert.deepEqual(check('KODEX 200선물인버스2X (252670)는 +12.10% 올랐습니다.'), [])
  // 괴리율·금리·%p는 등락률이 아니다
  assert.deepEqual(check('KODEX 200 (069500)의 괴리율은 0.35%로 안정적입니다.'), [])
  assert.deepEqual(check('KODEX 반도체 (091160)의 지수대비는 +0.30%p입니다.'), [])
  // 코스피200·나스닥100은 별도 지수 — 코스피·나스닥 값과 대조하지 않는다
  assert.deepEqual(check('코스피200 선물은 6.2% 밀렸습니다.'), [])
  assert.deepEqual(check('나스닥100을 추종하는 QQQ는 -0.33%였습니다.'), [])
})

test('지수 실측이 없는데 지수 등락률을 쓰면 잡는다', () => {
  assert.equal(check('전일 코스피가 6.21% 밀렸습니다.', []).length, 1)
  assert.deepEqual(check('전일 국내 증시는 크게 밀렸습니다.', []), [])
})

test('가정·조건·미래 관찰 문장의 수치는 대조하지 않는다', () => {
  assert.deepEqual(check('KODEX 반도체 (091160)가 개장 직후 3% 이상 반등하면 과잉 낙폭 해소 신호입니다.'), [])
  assert.deepEqual(check('KODEX 200 (069500)이 2% 넘게 밀릴 경우 방어적으로 봅니다.'), [])
  assert.deepEqual(check('오늘 SOXX가 1% 반등할지가 관건입니다.'), [])
})

test('각각 + 수치 여러 개는 순서대로 짝짓는다', () => {
  assert.deepEqual(check('KODEX 반도체 (091160)와 TIGER 반도체TOP10 (396500)은 각각 -3.96%, -8.24%였습니다.'), [])
  assert.equal(check('KODEX 반도체 (091160)와 TIGER 반도체TOP10 (396500)은 각각 -8.24%, -3.96%였습니다.').length, 2)
})

test('발행물 오탐 사례: 상품명 속 지수명·쉼표 뒤 다른 주어·보합 근처 부호', () => {
  // 'TIGER 미국S&P500' 안의 S&P500은 지수 언급이 아니다(시세 목록에 없을 때도)
  assert.deepEqual(check('TIGER 미국S&P500 (360750)은 -0.61%였습니다.'), [])
  // 쉼표 뒤 다른 주어의 수치
  assert.deepEqual(check('간밤 나스닥이 무너진 사이, 헬스케어·필수소비재는 2%대 상승했습니다.'), [])
  // 사이에 다른 티커
  assert.deepEqual(check('SOXX는 XLK(-0.70%)보다 크게 밀렸습니다.'), [])
  // 보합 근처 부호 차이
  assert.deepEqual(findNumericClaimMismatches('간밤 S&P500은 +0.01%로 제자리였습니다.', QUOTES, [
    { symbol: '^GSPC', nameKo: 'S&P500', price: 1, changePercent: -0.02, asOf: null },
  ]), [])
})

test('국내 이름 경계: 조사는 허용, 상품명 연속은 불허', () => {
  assert.equal(check('KODEX 200은 전일 -8.21% 밀렸습니다.').length, 1) // 실제 -6.25
  assert.deepEqual(check('KODEX 200선물 관련 수치 -8.21%는 다른 상품입니다.'), [])
})

// 검증기 연결: 정상 시도에서는 위반(재생성 사유), 축소판에서는 경고만(전송 > 침묵).
import { validateMorningReportQuality } from './report-quality'
import { buildMorningStrategyInput } from './morning-strategy'
import type { CollectedData, MorningReport } from './types'

function reportWith(narrative: string): MorningReport {
  return {
    cover: { headline: '제목', subline: '부제' },
    overnightBrief: { narrative, krImpact: 'K' },
    usEtfHighlights: { topMover: { ticker: 'SPY', reason: 'R' }, bottomMover: { ticker: 'QQQ', reason: 'R' }, sectorNarrative: 'N' },
    todayWatch: { items: [{ title: 'T', body: 'B' }] },
    closingLine: 'C',
  } as unknown as MorningReport
}
const DATA = {
  reportType: 'morning', date: '2026-10-14', quotes: QUOTES, flows: [], investorFlows: [], news: [], analysisLens: '',
  macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
  indices: INDICES,
} as CollectedData

function errorOf(fn: () => void): string {
  try { fn(); return '' } catch (e) { return (e as Error).message }
}

test('검증기: 지수 수치 오류는 정상 시도에서 위반, 축소판에서는 위반 목록에 없다', () => {
  const report = () => reportWith('전일 코스피가 6.21% 밀리는 사이 미 증시는 쉬었습니다.')
  assert.match(errorOf(() => validateMorningReportQuality(report(), DATA, buildMorningStrategyInput(DATA))), /수치가 입력 데이터와 다름/)
  assert.doesNotMatch(errorOf(() => validateMorningReportQuality(report(), DATA, buildMorningStrategyInput(DATA), { factChecksAsWarnings: true })), /수치가 입력 데이터와 다름/)
})

test('허용오차는 표기 자릿수 기준: 7.57%를 7.5%·7.6%로 쓴 것은 통과, 7.4%는 위반', () => {
  const idx: IndexQuote[] = [{ symbol: '^KS11', nameKo: '코스피', price: 5554, changePercent: -7.57, asOf: '2026-10-15' }]
  assert.deepEqual(check('전 거래일 코스피가 7.5% 급락했습니다.', idx), [])
  assert.deepEqual(check('전 거래일 코스피가 7.6% 급락했습니다.', idx), [])
  assert.equal(check('전 거래일 코스피가 7.4% 급락했습니다.', idx).length, 1)
  assert.equal(check('전 거래일 코스피가 -7.62% 밀렸습니다.', idx).length, 1) // 두 자리는 복사값이어야
})
