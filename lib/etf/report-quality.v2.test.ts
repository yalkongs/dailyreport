// lib/etf/report-quality.v2.test.ts
// 2026-10-17 아침 리포트 개편: 새 출력 스키마(세 줄 요약·자산군 카드·확인 3가지·카드 한 줄)의 검증.
// 사실 검증(수치·주간·환율)은 새 산문 필드 전부에 적용되고, 축소판(factChecksAsWarnings)에서는 경고만 남는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMorningReportQuality } from './report-quality'
import { normalizeMorningReportLanguage } from './report-language'
import { buildMorningStrategyInput } from './morning-strategy'
import { buildAssetClassSlots } from './asset-classes'
import type { CollectedData, EtfQuote, IndexQuote, MorningReport } from './types'

const q = (ticker: string, name: string, pct: number): EtfQuote => ({
  ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
} as EtfQuote)

const QUOTES = [
  q('069500.KS', 'KODEX 200', -8.21), q('091160.KS', 'KODEX 반도체', -11.94), q('396500.KS', 'TIGER 반도체TOP10', -10.86),
  q('122630.KS', 'KODEX 레버리지', -16.42), q('360750.KS', 'TIGER 미국S&P500', -1.04), q('SPY', 'SPDR S&P 500', 0.28),
  q('TLT', 'iShares 20+ Year Treasury', 0.4), q('GLD', 'SPDR Gold', 0.5), q('305080.KS', 'TIGER 미국채10년선물', -0.2),
]
const INDICES: IndexQuote[] = [
  { symbol: '^KS11', nameKo: '코스피', price: 6035.35, changePercent: -5.46, asOf: '2026-10-16' },
  { symbol: '^IXIC', nameKo: '나스닥', price: 22000, changePercent: 0.15, asOf: '2026-10-16' },
]

function makeData(quotes: EtfQuote[] = QUOTES): CollectedData {
  return {
    reportType: 'morning', date: '2026-10-19', quotes, flows: [], investorFlows: [], news: [], analysisLens: '',
    macro: { usdKrw: 1420, dxy: null, vix: 18, moveIndex: null, us10y: 4.1, fearGreed: null, wti: null, gold: null },
    indices: INDICES,
  }
}

// 슬롯 순서: kr-semi, kr-large, us-equity, commodities, bonds (asset-classes.test.ts 참조)
function validReport(): MorningReport {
  return {
    cover: { headline: '국내 반도체 급락, 미 증시는 버텼다', subline: '간밤 미 증시는 소폭 올랐지만 국내 반도체의 낙폭이 오늘 개장의 부담으로 남았습니다.' },
    summary: {
      overseas: '간밤 미 증시는 금리 안정 속에 조용히 마감했습니다.',
      domestic: '전일 국내 증시는 반도체를 중심으로 매물이 쏟아졌습니다.',
      focus: '개장 직후 반도체 ETF가 낙폭을 줄이는지가 오늘의 핵심입니다.',
    },
    assetCards: [
      { key: 'kr-semi', reason: '메모리 가격 둔화 보도가 반도체 매물을 키웠습니다.', ifHolding: '개장 30분 동안 낙폭이 줄어드는지 지켜볼 때입니다.', ifConsidering: '급락 다음 날의 반등은 거래대금이 붙는지 확인한 뒤 판단할 일입니다.' },
      { key: 'kr-large', ifHolding: '반도체 비중이 큰 만큼 반도체 흐름과 함께 움직이는지 볼 때입니다.', ifConsidering: '대형주 전반의 하락 폭이 좁혀지는지 먼저 살필 자리입니다.' },
      { key: 'us-equity', ifHolding: '원화 약세는 환노출 상품의 원화 환산 성과에 보탬이 됩니다.', ifConsidering: '환율이 높은 구간이라 원화 강세 전환 시의 환산 손실을 따로 고려할 때입니다.' },
      { key: 'commodities', ifHolding: '금 가격이 안전자산 수요를 계속 받는지 지켜볼 자리입니다.', ifConsidering: '국내 급락이 진정되면 금의 상승 동력도 약해질 수 있다는 점을 염두에 둘 때입니다.' },
      { key: 'bonds', ifHolding: '미 국채 금리가 안정 흐름을 이어가는지가 관건입니다.', ifConsidering: '금리 방향이 정해지기 전까지 장기채 변동성이 크다는 점을 볼 자리입니다.' },
    ],
    todayChecks: [
      { time: '09:00~09:30', what: '국내 반도체 ETF 개장 흐름', baseline: '전일 종가 대비 낙폭 축소 여부', invalidation: '낙폭이 더 커지면 반등 가설은 접습니다' },
      { time: '15:30', what: '국내 증시 마감 방향', baseline: '전일 종가', invalidation: '마감까지 약세가 이어지면 하루짜리 충격이라는 가설은 버립니다' },
      { time: '21:30', what: '미국 소매판매 발표', baseline: '시장 예상치', invalidation: '예상보다 강하면 금리 안정 가설은 다음 거래일에 다시 봅니다' },
    ],
    card: { key: 'kr-semi', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다' },
    tacticalWarning: '레버리지·인버스 ETF는 하루 변동이 커 장기 보유 수단과 구분해서 봐야 합니다.',
  }
}

function errorOf(fn: () => void): string {
  try { fn(); return '' } catch (e) { return (e as Error).message }
}
function validate(report: MorningReport, data: CollectedData = makeData(), warn = false): string {
  return errorOf(() => validateMorningReportQuality(report, data, buildMorningStrategyInput(data), warn ? { factChecksAsWarnings: true } : {}))
}

test('픽스처 전제: 슬롯 key가 카드 key와 일치', () => {
  assert.deepEqual(buildAssetClassSlots(QUOTES).map(s => s.key), validReport().assetCards.map(c => c.key))
})

test('새 스키마의 정상 리포트는 통과한다', () => {
  assert.equal(validate(validReport()), '')
})

test('(a) todayChecks가 정확히 3개가 아니면 위반', () => {
  const two = validReport(); two.todayChecks = two.todayChecks.slice(0, 2)
  assert.match(validate(two), /오늘 확인할 것은 정확히 3개/)
  const four = validReport(); four.todayChecks = [...four.todayChecks, { ...four.todayChecks[0], what: '추가 항목입니다' }]
  assert.match(validate(four), /오늘 확인할 것은 정확히 3개/)
})

test('(b) card.key가 슬롯에 없으면 위반', () => {
  const r = validReport(); r.card.key = 'kr-sector' // 이날 섹터 슬롯 없음
  assert.match(validate(r), /card\.key/)
})

test('(b) assetCards의 key가 슬롯에 없으면 위반', () => {
  const r = validReport(); r.assetCards.push({ key: 'kr-sector', ifHolding: '섹터 흐름을 지켜볼 때입니다.', ifConsidering: '섹터 순환을 먼저 볼 자리입니다.' })
  assert.match(validate(r), /assetCards key가 자산군 슬롯에 없음: kr-sector/)
})

test('(c) card.line이 32자를 넘으면 위반', () => {
  const r = validReport(); r.card.line = '반등인지 추가 하락인지 오전 흐름과 거래대금을 함께 지켜볼 때입니다'
  assert.ok(Array.from(r.card.line).length > 32)
  assert.match(validate(r), /card\.line/)
})

test('(c) card.line이 질문형이면 위반', () => {
  for (const line of ['반등이 이어질까요?', '반등은 이어질 수 있을까', '오늘 반도체는 바닥인가', '낙폭을 줄일 수 있습니까']) {
    const r = validReport(); r.card.line = line
    assert.match(validate(r), /card\.line/, line)
  }
})

// (d) flatten에 새 산문 필드가 모두 들어가야 수치 대조가 적용된다 — 필드마다 하나씩 넣어 본다.
const BAD = '전일 코스피가 6.21% 밀렸습니다.' // 실제 -5.46%
const FIELD_SETTERS: Array<[string, (r: MorningReport) => void]> = [
  ['cover.headline', r => { r.cover.headline = '코스피 6.21% 급락' }],
  ['cover.subline', r => { r.cover.subline = BAD }],
  ['summary.overseas', r => { r.summary.overseas = BAD }],
  ['summary.domestic', r => { r.summary.domestic = BAD }],
  ['summary.focus', r => { r.summary.focus = BAD }],
  ['assetCards[].reason', r => { r.assetCards[1].reason = BAD }],
  ['assetCards[].ifHolding', r => { r.assetCards[2].ifHolding = BAD }],
  ['assetCards[].ifConsidering', r => { r.assetCards[3].ifConsidering = BAD }],
  ['todayChecks[].time', r => { r.todayChecks[0].time = BAD }],
  ['todayChecks[].what', r => { r.todayChecks[0].what = BAD }],
  ['todayChecks[].baseline', r => { r.todayChecks[1].baseline = BAD }],
  ['todayChecks[].invalidation', r => { r.todayChecks[2].invalidation = BAD }],
  ['card.line', r => { r.card.line = '코스피가 6.21% 밀린 다음 날입니다' }],
  ['tacticalWarning', r => { r.tacticalWarning = BAD }],
]

for (const [field, set] of FIELD_SETTERS) {
  test(`(d) ${field}의 틀린 지수 수치를 잡는다`, () => {
    const r = validReport(); set(r)
    assert.match(validate(r), /수치가 입력 데이터와 다름/)
  })
}

test('(e) 축소판(factChecksAsWarnings)에서는 수치 오류가 위반 목록에 없다', () => {
  const r = validReport(); r.summary.domestic = BAD
  assert.doesNotMatch(validate(r, makeData(), true), /수치가 입력 데이터와 다름/)
  assert.equal(validate(validReport(), makeData(), true), '')
})

test('주간 수익률·환율 방향 오류도 새 필드에서 잡는다', () => {
  const weekly = validReport(); weekly.assetCards[0].reason = '이번 주 KODEX 반도체 (091160)는 -11.94% 밀렸습니다.'
  assert.match(validate(weekly), /주간 수익률 서술/)
  const fx = validReport(); fx.assetCards[2].ifHolding = '원화 약세가 이어지면 환율 손실이 수익을 상쇄합니다.'
  assert.match(validate(fx), /환율 방향 오류/)
})

test('필수 필드가 비면 위반(형식 오류 응답도 TypeError 없이 위반 메시지로)', () => {
  const r = validReport(); r.summary.focus = ''
  assert.match(validate(r), /필수 필드 누락: summary\.focus/)
  const broken = { cover: { headline: '국내 반도체 급락', subline: '미 증시는 소폭 올랐습니다.' } } as unknown as MorningReport
  const msg = validate(broken)
  assert.match(msg, /\[report-quality\]/)
  assert.match(msg, /필수 필드 누락/)
  assert.match(msg, /오늘 확인할 것은 정확히 3개/)
})

test('갖고 있다면·새로 본다면의 지시형 매매 표현은 투자 권유로 잡는다', () => {
  for (const s of ['반등이 나오면 매수하세요.', '지금이라도 담으세요.', '손실이 커지기 전에 비중을 줄이는 것이 좋습니다.', '오늘은 파세요.']) {
    const r = validReport(); r.assetCards[0].ifHolding = s
    assert.match(validate(r), /투자 권유성 표현/, s)
  }
})

test('tacticalWarning: 레버리지·인버스 |등락| 10% 미만이면 자동 생략, 이상이면 유지', () => {
  const calm = makeData(QUOTES.map(x => (x.ticker === '122630.KS' ? { ...x, changePercent: -4 } : x)))
  const r1 = validReport()
  assert.equal(validate(r1, calm), '')
  assert.equal(r1.tacticalWarning, undefined)
  const r2 = validReport()
  assert.equal(validate(r2), '')
  assert.ok(r2.tacticalWarning && r2.tacticalWarning.length > 0)
})

test('soft fix가 새 필드에 적용된다', () => {
  const r = validReport(); r.assetCards[0].ifHolding = '개장 흐름이 반등의 단서로 판단됩니다.'
  r.todayChecks[0].invalidation = '낙폭 확대 시 반등 가설은 무리로 보입니다.'
  assert.equal(validate(r), '')
  assert.equal(r.assetCards[0].ifHolding, '개장 흐름이 반등의 단서로 읽힙니다.')
  assert.equal(r.todayChecks[0].invalidation, '낙폭 확대 시 반등 가설은 무리로 관측됩니다.')
})

test('언어 정규화가 새 필드 전부에 적용된다', () => {
  const r = validReport()
  r.summary.focus = '매수 검토 시점을 가늠하는 날입니다.'
  r.assetCards[1].ifConsidering = '신규 진입은 거래대금을 본 뒤입니다.'
  r.todayChecks[2].what = '분할 접근 여부'
  r.card.line = '선호 ETF군을 다시 보는 날입니다'
  r.tacticalWarning = '비중 확대보다 변동성 관리가 먼저입니다.'
  const n = normalizeMorningReportLanguage(r)
  assert.equal(n.summary.focus, '거래 전 점검 시점을 가늠하는 날입니다.')
  assert.equal(n.assetCards[1].ifConsidering, '추가 편입 판단은 거래대금을 본 뒤입니다.')
  assert.equal(n.todayChecks[2].what, '단계적 판단 여부')
  assert.equal(n.card.line, '확인 우선 ETF군을 다시 보는 날입니다')
  assert.equal(n.tacticalWarning, '노출 확대 판단보다 변동성 관리가 먼저입니다.')
  assert.equal(n.assetCards[0].key, 'kr-semi')
  assert.equal(n.card.key, 'kr-semi')
})

test('언어 정규화는 형식이 깨진 응답에서 던지지 않는다(검증이 위반으로 보고)', () => {
  const broken = { cover: { headline: '매수 검토', subline: 's' }, assetCards: 'x' } as unknown as MorningReport
  const n = normalizeMorningReportLanguage(broken)
  assert.equal(n.cover.headline, '거래 전 점검')
})
