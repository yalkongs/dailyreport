// lib/etf/morning-fallback.test.ts
// I2 (Ruling 23, F02 "전송 > 침묵"): ETF 생성 루프 — 파싱된 결과를 버리지 않는다.
// 1·2회차 엄격 검증 → Tier 1 재생성 + 축소판 검증. 마지막 호출을 못 하거나(예산) 실패·파싱 실패하거나 축소판 검증에
// 걸리면, 앞선 결과 중 가장 나은 것(카드 문구만 어긋난 결과 > 위반이 가장 적은 결과 > 가장 최근 결과)을 축소판으로
// 다시 검증해 발송한다. 준법(매수·매도 권유)·진짜 필수 필드 누락은 그래도 막고, 파싱된 결과가 없으면 실패한다.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { generateMorningReportWithFallback } from './claude-client'
import { assessMorningReportQuality } from './report-quality'
import { buildMorningStrategyInput } from './morning-strategy'
import { makeDeadline } from '../claude-budget'
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
]
const DATA: CollectedData = {
  reportType: 'morning', date: '2026-10-19', quotes: QUOTES, flows: [], investorFlows: [], news: [], analysisLens: '',
  macro: { usdKrw: 1420, dxy: null, vix: 18, moveIndex: null, us10y: 4.1, fearGreed: null, wti: null, gold: null },
  indices: INDICES,
}

function validReport(headline = '국내 반도체 급락, 미 증시는 버텼다'): MorningReport {
  return {
    cover: { headline, subline: '간밤 미 증시는 소폭 올랐지만 국내 반도체의 낙폭이 오늘 개장의 부담으로 남았습니다.' },
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

// 사실 위반(1·2회차 재생성 사유, 축소판은 경고): 실제 코스피 -5.46%
function factReport(headline: string): MorningReport {
  const r = validReport(headline); r.summary.domestic = '전일 코스피가 6.21% 밀렸습니다.'; return r
}
// 카드 문구만 어긋난 결과(제목이 카드에 넘침)
const LONG_HEADLINE = '국내 반도체 상품이 하루 만에 크게 밀리며 미국 반도체와의 격차가 눈에 띄게 벌어졌고 오늘 개장에도 부담으로 남았다'
// 준법 위반 — 축소판에서도 막힌다
function adviceReport(headline: string): MorningReport {
  const r = validReport(headline); r.assetCards[0].ifConsidering = '반등이 나오면 매수하세요.'; return r
}

/**
 * 호출 순서대로 응답(리포트 또는 오류)을 돌려주는 가짜 생성기. 매번 새 객체(structuredClone)로 준다.
 * 함수 응답은 그대로 호출한 결과를 준다(형식이 깨진 응답·검증 중 예외를 만드는 객체용).
 */
function fakeGenerator(replies: Array<MorningReport | Error | (() => unknown)>) {
  let calls = 0
  const generateRaw = async () => {
    const reply = replies[Math.min(calls++, replies.length - 1)]
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply() as MorningReport
    return structuredClone(reply)
  }
  return { generateRaw, calls: () => calls }
}

/** 호출마다 callMs만큼 흐르는 가짜 시계의 예산(ETF 10분, 새 호출 추정 3분). */
function fakeDeadline(callMs: number, gen: { calls: () => number }) {
  return makeDeadline(10 * 60_000, () => gen.calls() * callMs)
}

function quiet(t: TestContext) {
  const logs: string[] = []
  const collect = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  t.mock.method(console, 'log', collect)
  t.mock.method(console, 'warn', collect)
  t.mock.method(console, 'error', collect)
  return logs
}

test('픽스처 전제: 사실 위반은 카드 외 위반, 긴 제목은 카드 문구 위반만', () => {
  const fact = assessMorningReportQuality(factReport('국내 반도체 급락, 미 증시는 버텼다'), DATA, buildMorningStrategyInput(DATA))
  assert.equal(fact.cardViolations.length, 0)
  assert.ok(fact.violations.some(v => /수치가 입력 데이터와 다름/.test(v)))
  const card = assessMorningReportQuality(validReport(LONG_HEADLINE), DATA, buildMorningStrategyInput(DATA))
  assert.ok(card.cardViolations.length > 0)
  assert.equal(card.violations.length, card.cardViolations.length)
})

test('1회차가 통과하면 그 결과로, 더 부르지 않는다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([validReport('첫 결과')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '첫 결과')
  assert.equal(gen.calls(), 1)
})

test('예산이 모자라 2회차·Tier 1을 못 부르면 1회차 결과를 축소판으로 검증해 발송한다', async (t) => {
  const logs = quiet(t)
  const gen = fakeGenerator([factReport('예산 전 결과')])
  // 한 호출에 8분 → 두 번째 호출(추정 3분)은 10분 예산을 넘는다
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(8 * 60_000, gen) })
  assert.equal(gen.calls(), 1)
  assert.equal(report.cover.headline, '예산 전 결과')
  assert.ok(logs.some(l => /\[fact-warn\][\s\S]*수치가 입력 데이터와 다름/.test(l)), '사실 위반은 경고로 남는다')
  assert.ok(logs.some(l => /앞선 1회차 결과로 발송/.test(l)))
})

test('Tier 1 호출이 실패하면 앞선 결과 중 카드 문구만 어긋난 결과를 우선해 발송한다', async (t) => {
  const logs = quiet(t)
  const gen = fakeGenerator([validReport(LONG_HEADLINE), factReport('사실 위반 2회차'), new Error('Internal server error')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(gen.calls(), 3)
  assert.equal(report.cover.headline, LONG_HEADLINE)
  assert.ok(logs.some(l => /Tier 1 fallback 호출 실패[\s\S]*Internal server error/.test(l)))
  assert.ok(logs.some(l => /앞선 1회차 결과로 발송/.test(l)))
})

test('Tier 1 응답이 파싱되지 않으면, 위반 수가 같은 앞선 결과 중 더 최근 것을 발송한다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([factReport('사실 위반 1회차'), factReport('사실 위반 2회차'), new Error('[claude-client] morning 리포트 JSON 파싱 실패')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '사실 위반 2회차')
})

test('Tier 1 결과가 준법 위반으로 막히면 축소판을 통과하는 앞선 결과로 발송한다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([factReport('사실 위반 1회차'), adviceReport('권유 2회차'), adviceReport('권유 Tier1')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '사실 위반 1회차')
})

test('준법(매수 권유) 위반뿐인 결과는 어느 경로로도 발송하지 않는다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([adviceReport('권유 1'), adviceReport('권유 2'), adviceReport('권유 3')])
  await assert.rejects(
    generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) }),
    /투자 권유성 표현/,
  )
  assert.equal(gen.calls(), 3)
})

test('준법 위반 결과뿐인데 예산이 끝나 Tier 1을 못 불러도 발송하지 않는다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([adviceReport('권유 1')])
  await assert.rejects(
    generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(8 * 60_000, gen) }),
    /투자 권유성 표현/,
  )
})

test('파싱된 결과가 한 번도 없으면 실패한다(원인 포함)', async (t) => {
  quiet(t)
  const gen = fakeGenerator([new Error('overloaded')])
  await assert.rejects(
    generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) }),
    /overloaded/,
  )
  assert.equal(gen.calls(), 3)
})

test('1·2회차가 모두 실패해도 Tier 1이 축소판을 통과하면 발송한다(기존 경로)', async (t) => {
  quiet(t)
  const gen = fakeGenerator([new Error('overloaded'), new Error('overloaded'), factReport('Tier1 결과')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, 'Tier1 결과')
})

// ─── Ruling 28: 형식이 깨진 응답의 검증 중 예외가 함수 밖으로 새지 않는다(파싱 실패처럼 다음 시도로) ─────
const broken = (patch: Record<string, unknown>) => () => ({ ...structuredClone(validReport()), ...patch })

test('1회차 cover가 문자열이어도 던지지 않고 2회차 정상 결과로 발송한다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([broken({ cover: '국내 반도체 급락' }), validReport('정상 2회차')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '정상 2회차')
  assert.equal(gen.calls(), 2)
})

test('summary가 매번 문자열이면 TypeError가 아니라 필수 필드 누락으로 실패한다', async (t) => {
  quiet(t)
  const gen = fakeGenerator([broken({ summary: '요약 한 줄' })])
  await assert.rejects(
    generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) }),
    (e: Error) => /필수 필드 누락: summary\.overseas/.test(e.message) && !/Cannot create property|TypeError/.test(e.message),
  )
  assert.equal(gen.calls(), 3) // 1·2회차·Tier 1 모두 돌았다
})

test('검증 중 예외가 나도(형식 깨짐) 파싱 실패처럼 다음 시도로 넘어간다', async (t) => {
  const logs = quiet(t)
  const throwing = () => {
    const r = structuredClone(validReport()) as unknown as Record<string, unknown>
    Object.defineProperty(r, 'summary', { enumerable: true, get() { throw new Error('형식이 깨진 응답') } })
    return r
  }
  const gen = fakeGenerator([throwing, validReport('정상 2회차')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '정상 2회차')
  assert.ok(logs.some(l => /응답 검증 중 오류[\s\S]*형식이 깨진 응답/.test(l)))
})

test('응답이 객체가 아니면(null·배열·문자열) 파싱 실패처럼 다음 시도로, 앞선 정상 결과는 그대로 쓴다', async (t) => {
  quiet(t)
  for (const bad of [null, [], '문자열']) {
    const gen = fakeGenerator([() => bad, validReport('정상 2회차')])
    const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
    assert.equal(report.cover.headline, '정상 2회차', JSON.stringify(bad))
  }
  // 객체가 아닌 응답은 앞선 결과 후보에 들지 않는다 — 사실 위반 1회차가 Tier 1 실패 뒤 발송된다.
  const gen = fakeGenerator([factReport('사실 위반 1회차'), () => null, new Error('Internal server error')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(report.cover.headline, '사실 위반 1회차')
})

// ── Ruling 31: 제목의 확인할 수 없는 기간 비교·최상급 — 1회차는 재생성, 마지막 축소판(Tier 1)은 경고만 남기고 발송 ──
const COMPARATIVE_HEADLINE = '국내 반도체 급락, 1년치 상승분 반납'

test('Ruling 31: 1회차 제목에 기간 비교·최상급이 있으면 2회차로 다시 쓰고, 고친 결과로 발송한다', async (t) => {
  const logs = quiet(t)
  const gen = fakeGenerator([validReport(COMPARATIVE_HEADLINE), validReport('국내 반도체 급락, 미 증시는 버텼다')])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(gen.calls(), 2)
  assert.equal(report.cover.headline, '국내 반도체 급락, 미 증시는 버텼다')
  assert.ok(logs.some(l => /1\/2회 품질 검증 실패[\s\S]*그중 카드 문구 0건[\s\S]*cover\.headline 기간 비교·최상급[\s\S]*1년치/.test(l)))
})

test('Ruling 31: 마지막 축소판까지 기간 비교·최상급이 남아도 경고만 남기고 발송한다(F02)', async (t) => {
  const logs = quiet(t)
  const gen = fakeGenerator([validReport(COMPARATIVE_HEADLINE)])
  const report = await generateMorningReportWithFallback(DATA, { generateRaw: gen.generateRaw, deadline: fakeDeadline(60_000, gen) })
  assert.equal(gen.calls(), 3)
  assert.equal(report.cover.headline, COMPARATIVE_HEADLINE)
  assert.ok(logs.some(l => /Tier 1 fallback 성공/.test(l)))
  assert.ok(logs.some(l => /\[comparative-warn\][\s\S]*1년치/.test(l)))
})
