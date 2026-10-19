// lib/etf/report-quality.v2.test.ts
// 2026-10-17 아침 리포트 개편: 새 출력 스키마(세 줄 요약·자산군 카드·확인 3가지·카드 한 줄)의 검증.
// 사실 검증(수치·주간·환율)은 새 산문 필드 전부에 적용되고, 축소판(factChecksAsWarnings)에서는 경고만 남는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySoftFixesInPlace, validateMorningReportQuality } from './report-quality'
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

test('(c) card.line이 40자를 넘으면 위반', () => {
  const r = validReport(); r.card.line = '반등인지 추가 하락인지 오전 흐름과 거래대금, 환율을 함께 지켜볼 때입니다'
  assert.equal(Array.from(r.card.line).length, 41)
  assert.match(validate(r), /card\.line은 40자 이내/)
})

// Ruling 32: 34~38자 한 줄도 1080×1350 카드에 두 줄로 들어간다 — 글자 수 상한은 40자, 넘침은 픽셀 관문(cardTextFits)이 본다.
test('(c) card.line 33~40자는 글자 수로 막지 않는다(카드에 들어가면 통과)', () => {
  for (const line of [
    '반등인지 추가 하락인지 오전 흐름과 거래대금을 함께 지켜볼 때입니다', // 37자
    '반도체 낙폭이 줄어드는지, 거래대금이 다시 붙는지가 오늘의 관전점입니다', // 39자
  ]) {
    const r = validReport(); r.card.line = line
    assert.ok(Array.from(line).length > 32 && Array.from(line).length <= 40, line)
    assert.equal(validate(r), '', line)
  }
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
  // 같은 리포트가 1·2회차에서는 막히고, 마지막 시도에서는 다른 위반 없이 통과(발송)한다.
  const again = validReport(); again.summary.domestic = BAD
  assert.match(validate(again), /수치가 입력 데이터와 다름/)
  const last = validReport(); last.summary.domestic = BAD
  assert.equal(validate(last, makeData(), true), '')
})

// ─── Ruling 10: 마지막 축소판에서는 코드가 고칠 수 있는 구조 문제를 교정하고 경고만 남긴다 ─────
const validateLast = (r: MorningReport, data: CollectedData = makeData()) => validate(r, data, true)

test('마지막 시도: todayChecks가 3개를 넘으면 앞 3개만 남기고 통과', () => {
  const r = validReport()
  const firstThree = r.todayChecks.map(c => c.what)
  r.todayChecks.push({ time: '22:00', what: '추가로 붙은 네 번째 항목', baseline: '없음', invalidation: '없음' })
  assert.match(validate(structuredClone(r)), /오늘 확인할 것은 정확히 3개/) // 1·2회차는 재생성 사유
  assert.equal(validateLast(r), '')
  assert.deepEqual(r.todayChecks.map(c => c.what), firstThree)
})

test('마지막 시도: todayChecks가 1~2개면 경고만, 0개면 필수 필드 누락으로 막는다', () => {
  const two = validReport(); two.todayChecks = two.todayChecks.slice(0, 2)
  assert.equal(validateLast(two), '')
  assert.equal(two.todayChecks.length, 2)
  const none = validReport(); none.todayChecks = []
  assert.match(validateLast(none), /필수 필드 누락: todayChecks/)
  const absent = validReport() as unknown as Record<string, unknown>; delete absent.todayChecks
  assert.match(validateLast(absent as unknown as MorningReport), /필수 필드 누락: todayChecks/)
})

test('마지막 시도: card.key가 슬롯에 없으면 주제 슬롯 key로 교정(console.warn 기록)', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const r = validReport(); r.card.key = 'kr-sector'
  assert.equal(validateLast(r), '')
  assert.equal(r.card.key, 'kr-semi')
  assert.ok(warn.mock.calls.some(c => String(c.arguments[0]).includes('[struct-fix] card.key kr-sector → kr-semi')))
})

test('마지막 시도: 슬롯에 없는 key의 assetCards는 버린다', () => {
  const r = validReport()
  r.assetCards.push({ key: 'kr-sector', ifHolding: '섹터 순환 흐름을 지켜볼 때입니다.', ifConsidering: '섹터 쏠림이 이어지는지 먼저 볼 자리입니다.' })
  assert.equal(validateLast(r), '')
  assert.deepEqual(r.assetCards.map(c => c.key), ['kr-semi', 'kr-large', 'us-equity', 'commodities', 'bonds'])
})

test('assetCards key 중복: 1·2회차는 위반, 마지막 시도는 첫 카드만 남긴다', () => {
  const dup = () => {
    const r = validReport()
    r.assetCards.push({ key: 'kr-semi', ifHolding: '중복으로 붙은 두 번째 반도체 카드입니다.', ifConsidering: '중복 카드의 신규 관점 문장입니다.' })
    return r
  }
  assert.match(validate(dup()), /assetCards key 중복: kr-semi/)
  const r = dup()
  assert.equal(validateLast(r), '')
  const semi = r.assetCards.filter(c => c.key === 'kr-semi')
  assert.equal(semi.length, 1)
  assert.equal(semi[0].ifHolding, '개장 30분 동안 낙폭이 줄어드는지 지켜볼 때입니다.')
})

test('마지막 시도: card.line이 길거나 질문형이어도 경고만(값은 그대로)', () => {
  const long = validReport(); long.card.line = '반등인지 추가 하락인지 오전 흐름과 거래대금을 함께 지켜볼 때입니다'
  assert.equal(validateLast(long), '')
  assert.equal(long.card.line, '반등인지 추가 하락인지 오전 흐름과 거래대금을 함께 지켜볼 때입니다')
  const question = validReport(); question.card.line = '반등이 이어질까요?'
  assert.equal(validateLast(question), '')
  assert.equal(question.card.line, '반등이 이어질까요?')
})

test('중복 문장: 1·2회차는 위반, 마지막 시도는 경고', () => {
  const dup = () => {
    const r = validReport()
    r.assetCards[1].ifConsidering = r.assetCards[0].ifHolding
    return r
  }
  assert.match(validate(dup()), /중복 문장 감지/)
  assert.equal(validateLast(dup()), '')
})

test('중복 문장 검사는 짧은 구조 필드(baseline·time)를 보지 않는다', () => {
  const r = validReport()
  r.todayChecks[0].baseline = '전일 종가 대비 낙폭 축소 여부를 기준으로'
  r.todayChecks[1].baseline = '전일 종가 대비 낙폭 축소 여부를 기준으로'
  r.todayChecks[2].time = '09:00~09:30'
  assert.equal(validate(r), '')
})

test('마지막 시도에도 진짜 필수 필드 누락과 투자 권유는 막는다', () => {
  const missing = validReport(); missing.summary.overseas = ''
  assert.match(validateLast(missing), /필수 필드 누락: summary\.overseas/)
  const noContent = validReport(); noContent.assetCards[0].ifHolding = ''
  assert.match(validateLast(noContent), /필수 필드 누락: assetCards\[0\]\.ifHolding/)
  const advice = validReport(); advice.assetCards[0].ifConsidering = '반등이 나오면 매수하세요.'
  assert.match(validateLast(advice), /투자 권유성 표현/)
})

test('card.key가 슬롯에 있지만 주제 슬롯과 다르면 경고만', () => {
  const r = validReport(); r.card.key = 'kr-large'
  assert.equal(validate(r), '')
  assert.equal(r.card.key, 'kr-large')
})

test('card.line의 숫자는 경고만(숫자 자체가 뉴스일 때 카드에 쓸 수 있다)', () => {
  const r = validReport(); r.card.line = '낙폭 10%대 이후 첫 거래일입니다'
  assert.equal(validate(r), '')
})

test('비중 표현: 판단을 미루는 서술은 통과, 권유형 종결만 잡는다', () => {
  const ok = validReport(); ok.assetCards[2].ifConsidering = '환노출 비중을 줄이는 것이 좋을지는 환율을 본 뒤 판단할 일입니다'
  assert.equal(validate(ok), '')
  const ng = validReport(); ng.assetCards[2].ifConsidering = '환노출 비중을 줄이는 것이 좋겠습니다.'
  assert.match(validate(ng), /투자 권유성 표현/)
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

// ─── Ruling 15: 미리보기 카드 문구가 카드 규칙(cardTextFits) 안에 들어가는지 ─────────────
// 넘치면 1·2회차는 재생성 사유, 마지막 축소판은 console.warn만(카드 렌더러가 '…'로 줄여 그린다).
const LONG_HEADLINE = '국내 반도체 상품이 하루 만에 크게 밀리며 미국 반도체와의 격차가 눈에 띄게 벌어졌고 오늘 개장에도 부담으로 남았다'

test('카드 문구 게이트: 제목이 카드에 넘치면 1·2회차는 위반(이유 포함)', () => {
  const r = validReport(); r.cover.headline = LONG_HEADLINE
  const msg = validate(r)
  assert.match(msg, /미리보기 카드 문구가 카드에 들어가지 않음/)
  assert.match(msg, /headline이\(가\) 72px에서도 \d줄이라 최대 3줄을 넘습니다/)
})

test('카드 문구 게이트: 마지막 시도는 경고만(발송), 값은 그대로', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const r = validReport(); r.cover.headline = LONG_HEADLINE
  assert.equal(validateLast(r), '')
  assert.equal(r.cover.headline, LONG_HEADLINE)
  assert.ok(warn.mock.calls.some(c => /\[card-warn\][\s\S]*headline이\(가\) 72px/.test(String(c.arguments[0]))))
})

test('카드 문구 게이트: card.key가 슬롯 밖이면 주제 슬롯 라벨로 판정(라벨 비었다는 위반은 없다)', () => {
  const r = validReport(); r.card.key = 'kr-sector'
  const msg = validate(r)
  assert.match(msg, /card\.key가 자산군 슬롯에 없음/)
  assert.doesNotMatch(msg, /holdingLabel/)
})

test('카드 문구 게이트: 자산군 슬롯이 하나도 없는 날은 라벨 검사를 하지 않는다(데이터 문제는 재생성으로 못 고침)', () => {
  const r = validReport()
  const msg = validate(r, makeData([]))
  assert.doesNotMatch(msg, /holdingLabel|미리보기 카드 문구/)
})

// ─── M4 (Ruling 25): 마지막 축소판에서는 준법(매수·매도 권유)과 진짜 필수 필드 누락만 막고, 나머지는 경고로 ─────
// 1·2회차는 그대로 재생성 사유. 범주마다 "1회차 위반 / 마지막 시도 통과 + 경고"를 함께 본다.
const ORDINALS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째', '열한째', '열두째', '열셋째', '열넷째', '열다섯째', '열여섯째', '열일곱째', '열여덟째']
const newsData = (): CollectedData => ({
  ...makeData(),
  news: [{ title: '연준 위원 금리 발언', source: 'Reuters', publishedAt: '2026-10-18T22:00:00Z', url: 'https://example.com/a', publishedHoursAgo: 8 }],
})
const LAST_ATTEMPT_DOWNGRADES: Array<[string, RegExp, (r: MorningReport) => void, () => CollectedData]> = [
  ['시점(상대시제 불능)', /상대시제/, r => { r.todayChecks[2].invalidation = '오늘(10/23, 금) 발표가 예상보다 강하면 금리 안정 가설을 접습니다' }, makeData],
  ['"에 따르면" 8회 이상', /"에 따르면" 인용이 8회/, r => {
    const cite = (i: number) => `블룸버그에 따르면 ${ORDINALS[i]} 흐름은 서로 다른 신호를 보냈습니다.`
    r.summary.overseas = cite(0); r.summary.domestic = cite(1); r.summary.focus = cite(2)
    r.assetCards.forEach((c, i) => { c.reason = cite(3 + i) })
  }, makeData],
  ['자금 유입·유출 표현', /fund flow/, r => { r.assetCards[1].reason = '외국인 자금 유입이 대형주 하락을 일부 받쳤습니다.' }, makeData],
  ['뉴스 단정(시장에서는 ~ 예상)', /뉴스 제목 이상의 단정/, r => { r.assetCards[4].reason = '시장에서는 연내 금리 인하를 예상하는 분위기가 짙어졌습니다.' }, newsData],
  ['USD/KRW 쉼표 누락', /USD\/KRW 천 단위 쉼표/, r => { r.assetCards[2].reason = 'USD/KRW 1420 수준이 환노출 상품의 원화 환산 성과를 받쳤습니다.' }, makeData],
  ['원화 긴 숫자', /원화 금액은 억 원\/조 원/, r => { r.assetCards[1].reason = '대형주 ETF에 거래대금 1234567890원이 몰렸습니다.' }, makeData],
  ['확인/점검/봅니다 과다', /확인\/점검\/봅니다 문장이 과도/, r => { r.tacticalWarning = ORDINALS.map(o => `${o} 지점을 확인합니다.`).join(' ') }, makeData],
  ['.KS 코드 표기', /종목명 \(6자리 코드\)/, r => { r.assetCards[0].reason = '091160.KS 흐름이 메모리 가격 둔화 보도에 약했습니다.' }, makeData],
  // 유니버스 코드(091160 등)는 soft fix가 괄호로 감싸므로(Ruling 33) 위반 경로는 유니버스 밖 6자리 수로 본다.
  ['코드 괄호 누락', /괄호로 감싸야/, r => { r.assetCards[0].reason = 'KODEX 반도체 123456 흐름이 메모리 가격 둔화 보도에 약했습니다.' }, makeData],
  ['커버 애매어(시장 단독)', /커버\(헤드라인\/서브라인\)/, r => { r.cover.subline = '간밤 시장 분위기는 조용했지만 오늘 개장 흐름이 관건으로 남았습니다.' }, makeData],
]

for (const [label, pattern, set, data] of LAST_ATTEMPT_DOWNGRADES) {
  test(`M4 ${label}: 1회차는 위반, 마지막 시도는 경고만 남기고 통과`, (t) => {
    const first = validReport(); set(first)
    assert.match(validate(first, data()), pattern)
    const warn = t.mock.method(console, 'warn', () => {})
    const last = validReport(); set(last)
    assert.equal(validateLast(last, data()), '')
    assert.ok(warn.mock.calls.some(c => pattern.test(String(c.arguments[0]))), `${label} 경고 기록`)
  })
}

test('M4: 마지막 시도에도 투자 권유는 다른 경고 범주와 섞여도 그대로 막는다', (t) => {
  t.mock.method(console, 'warn', () => {})
  const r = validReport()
  r.assetCards[1].reason = '외국인 자금 유입이 대형주 하락을 일부 받쳤습니다.'
  r.assetCards[0].ifConsidering = '반등이 나오면 매수하세요.'
  const msg = validateLast(r)
  assert.match(msg, /투자 권유성 표현/)
  assert.doesNotMatch(msg, /fund flow/)
})

// ─── M5: 형식이 깨진 card — 문자열 card는 없는 것으로, 마지막 시도엔 주제 슬롯 key + 확인 항목 첫 줄로 만든다 ─────
test('M5: 문자열 card는 던지지 않고 필수 필드 누락으로(1·2회차 재생성 사유)', () => {
  const r = validReport() as unknown as Record<string, unknown>; r.card = '반도체 흐름을 지켜볼 때입니다'
  assert.match(validate(r as unknown as MorningReport), /필수 필드 누락: card\.key, card\.line/)
  const absent = validReport() as unknown as Record<string, unknown>; delete absent.card
  assert.match(validate(absent as unknown as MorningReport), /필수 필드 누락: card\.key, card\.line/)
})

test('M5: 마지막 시도에 card가 문자열·누락이면 주제 슬롯 key와 첫 확인 항목으로 만들고 경고', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  for (const broken of ['반도체 흐름을 지켜볼 때입니다', undefined, null, 42]) {
    const r = validReport() as unknown as Record<string, unknown>
    if (broken === undefined) delete r.card; else r.card = broken
    assert.equal(validateLast(r as unknown as MorningReport), '', String(broken))
    assert.deepEqual(r.card, { key: 'kr-semi', line: '국내 반도체 ETF 개장 흐름' })
  }
  assert.ok(warn.mock.calls.some(c => /\[struct-fix\] card 없음/.test(String(c.arguments[0]))))
})

test('M5: 마지막 시도에 card.line만 비어도 첫 확인 항목으로 채운다(key는 그대로)', (t) => {
  t.mock.method(console, 'warn', () => {})
  const r = validReport(); r.card = { key: 'kr-large', line: '  ' }
  assert.equal(validateLast(r), '')
  assert.deepEqual(r.card, { key: 'kr-large', line: '국내 반도체 ETF 개장 흐름' })
})

test('M5: 확인 항목이 없으면 오늘 핵심(summary.focus)으로 — 확인 항목 누락 자체는 그대로 막는다', (t) => {
  t.mock.method(console, 'warn', () => {})
  const r = validReport() as unknown as Record<string, unknown>
  delete r.card; delete r.todayChecks
  const msg = validateLast(r as unknown as MorningReport)
  assert.match(msg, /필수 필드 누락: todayChecks/)
  assert.doesNotMatch(msg, /card\./)
  assert.deepEqual(r.card, { key: 'kr-semi', line: '개장 직후 반도체 ETF가 낙폭을 줄이는지가 오늘의 핵심입니다.' })
})

// ─── Ruling 33 (2026-10-19): 괄호 없이 쓴 국내 ETF 코드 soft fix ─────────────────────────────
// 오늘 ETF 검증이 "국내 ETF 코드는 반드시 괄호로 감싸야 합니다 \"(6자리)\": 체 091160, 어 266420"로 재생성을 반복했다.
// 이름·단어 바로 뒤 공백 한 칸 + 유니버스 6자리 코드면 "이름 (코드)"(프롬프트·렌더러의 표기)로 감싼다.
const BARE_CODES_TODAY = 'KODEX 반도체 091160과 KODEX 헬스케어 266420의 개장 흐름'

test('Ruling 33 soft fix: 이름 뒤 공백 한 칸의 유니버스 코드를 괄호로 감싼다(모든 산문 필드)', () => {
  const r = validReport()
  r.assetCards[0].reason = 'KODEX 반도체 091160 흐름이 메모리 가격 둔화 보도에 약했습니다.'
  r.todayChecks[0].what = BARE_CODES_TODAY
  r.summary.domestic = '전일 KODEX 200 069500과 TIGER 미국S&P500 360750이 함께 밀렸습니다.'
  const fixes = applySoftFixesInPlace(r)
  assert.equal(r.assetCards[0].reason, 'KODEX 반도체 (091160) 흐름이 메모리 가격 둔화 보도에 약했습니다.')
  assert.equal(r.todayChecks[0].what, 'KODEX 반도체 (091160)과 KODEX 헬스케어 (266420)의 개장 흐름')
  assert.equal(r.summary.domestic, '전일 KODEX 200 (069500)과 TIGER 미국S&P500 (360750)이 함께 밀렸습니다.')
  assert.ok(fixes.includes('국내 ETF 코드 괄호'), fixes.join(', '))
})

test('Ruling 33 soft fix: 이미 괄호 안인 코드는 그대로', () => {
  for (const text of ['KODEX 반도체 (091160) 흐름', 'KODEX 반도체(091160) 흐름', '(KODEX 반도체 091160) 흐름']) {
    const r = validReport(); r.assetCards[0].reason = text
    assert.deepEqual(applySoftFixesInPlace(r), [], text)
    assert.equal(r.assetCards[0].reason, text)
  }
})

test('Ruling 33 soft fix: 유니버스 밖 6자리 수·쉼표/소수점이 이어지는 수·금액·.KS 접미사는 건드리지 않는다', () => {
  for (const text of [
    'KODEX 반도체 123456 흐름', // 유니버스 코드 아님
    '거래대금 1,091,160원이 몰렸습니다', // 쉼표가 낀 금액
    '종가 102,110원에서 출발합니다', // 쉼표 있는 가격
    '종가 091160,5 수준', // 쉼표가 이어지는 수
    '종가 102110.5 수준', // 소수점이 이어지는 수
    '종가 102110원에서 출발합니다', // 단위가 붙은 금액(코드와 같은 숫자라도)
    '평가액 102110 원', // 띄어 쓴 단위
    'KODEX 반도체 0911600 흐름', // 7자리
    'KODEX 반도체 091160.KS 흐름', // .KS 표기는 별도 검사가 본다
    'KODEX 반도체  091160 흐름', // 공백 두 칸(한 칸만 교정)
  ]) {
    const r = validReport(); r.assetCards[0].reason = text
    applySoftFixesInPlace(r)
    assert.equal(r.assetCards[0].reason, text, text)
  }
})

test('Ruling 33 soft fix: 교정 뒤에는 괄호 누락 위반이 나지 않는다(1회차 엄격 검증 통과)', () => {
  const r = validReport()
  r.assetCards[0].reason = 'KODEX 반도체 091160 흐름이 메모리 가격 둔화 보도에 약했습니다.'
  r.todayChecks[0].what = BARE_CODES_TODAY
  assert.equal(validate(r), '')
  // 유니버스 밖 수는 그대로 위반(재생성 사유) — 교정이 위반 경로를 가리지 않는다.
  const other = validReport(); other.assetCards[0].reason = 'KODEX 반도체 123456 흐름이 메모리 가격 둔화 보도에 약했습니다.'
  assert.match(validate(other), /괄호로 감싸야/)
})

// ─── Ruling 31 (2026-10-19): 제목·카드 한 줄의 확인할 수 없는 기간 비교·최상급 표현 ─────────────────
// 1·2회차는 재생성 사유(카드 문구 위반이 아니라 기준 위반), 마지막 축소판은 경고만(F02).
test('Ruling 31: cover.headline·card.line의 기간 비교·최상급은 1회차 위반, 마지막 시도는 경고만 남기고 통과', (t) => {
  const cases: Array<[string, (r: MorningReport) => void, RegExp]> = [
    ['cover.headline', r => { r.cover.headline = '국내 반도체 급락, 1년치 상승분 반납' }, /cover\.headline 기간 비교·최상급[^\n]*1년치/],
    ['card.line', r => { r.card.line = '반도체 사상 최고 뒤 숨 고르기를 지켜볼 때입니다' }, /card\.line 기간 비교·최상급[^\n]*사상 최고/],
  ]
  const warn = t.mock.method(console, 'warn', () => {})
  for (const [label, set, pattern] of cases) {
    const first = validReport(); set(first)
    const msg = validate(first)
    assert.match(msg, pattern, label)
    assert.doesNotMatch(msg, /미리보기 카드 문구|card\.line은/, `${label}: 카드 문구 위반이 아니라 기준 위반`)
    const last = validReport(); set(last)
    assert.equal(validateLast(last), '', label)
    assert.ok(warn.mock.calls.some(c => /\[comparative-warn\]/.test(String(c.arguments[0])) && pattern.test(String(c.arguments[0]))), `${label} 경고 기록`)
  }
})

test('Ruling 31: 평범한 제목·카드 문구와 본문(요약·카드 이유)의 비교 표현은 걸지 않는다', () => {
  for (const headline of ['미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다', '코스피 반등, 이번 주 금통위가 시험대', '금통위가 최대 변수']) {
    const r = validReport(); r.cover.headline = headline
    assert.doesNotMatch(validate(r), /기간 비교/, headline)
  }
  const body = validReport(); body.assetCards[0].reason = '메모리 가격이 3년 만에 최저로 내려갔다는 보도가 반도체 매물을 키웠습니다.'
  assert.doesNotMatch(validate(body), /기간 비교/, '짧은 노출 필드(제목·카드 한 줄)에만 적용')
})
