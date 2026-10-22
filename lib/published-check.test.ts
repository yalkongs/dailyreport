// lib/published-check.test.ts
// 발행물 정확성 검사(2026-10-23) — 실제로 공개된 페이지를 원천 시세와 기계적으로 대조한다.
// 계기: 10/20~10/23 Market 카드 코스피 줄무늬의 맨 끝이 어제가 아니라 그저께였다(운영자가 먼저 발견, 0066b0a에서 수정).
// 페이지는 실제 렌더러(renderReport·renderMorningHtml)로 만들고, 가져오기·시세는 주입한다(네트워크 없음).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport } from './report-renderer'
import { renderMorningHtml } from './etf/renderer'
import { diverging, type StripeSession } from './preview/data-card'
import type { CollectedData, EtfQuote, MorningReport } from './etf/types'
import {
  runPublishedChecks, checkIndexClaims, colorSign, withRetry, parseCliArgs, formatLine, formatStepSummary, errorAnnotation,
  kstToday, type CheckResult, type PageResponse, type QuoteSnapshot, type QuoteEval,
} from './published-check'

const BASE = 'https://dailyreport-eta.vercel.app'
const DATE = '2026-10-23' // 금요일 — 직전 한국·미국 거래일은 10/22(목)
const KR_TIME = new Date('2026-10-22T11:05:40Z') // 10/22 20:05 KST
const KR_ETF_TIME = new Date('2026-10-22T06:30:07Z') // 10/22 15:30 KST
const US_TIME = new Date('2026-10-22T20:31:48Z') // 10/22 16:31 New York
const KR_LIVE = new Date('2026-10-23T01:30:00Z') // 10/23 10:30 KST — 오늘 장중

// ── Market 페이지 ────────────────────────────────────────────────────────
const marketContent = (headline: string, yesterday = '기술주 매도에 코스피가 3.52% 내렸습니다.') => ({
  cover: { headline, subline: '부제' },
  summary: { yesterday, today: '오늘은 미 국채 금리를 봅니다.', myAssets: '자산군별 흐름은 ETF Today에서.' },
  cardLine: { kind: 'cause', text: 'AI 지출 우려에 기술주 매도가 몰렸습니다.' },
  bigStory: { content: [{ type: 'paragraph', text: '본문' }] }, watchPoints: [{ badge: '09:00', title: '개장', description: 'd' }],
  compass: [], soWhat: [{ title: '확인되면', body: 'b' }], calendar: [], closingMessage: 'c',
}) as never

const marketData = {
  collectedAt: '2026-10-23T06:40:00+09:00', date: DATE, dayOfWeek: '금',
  koreaStocks: [{ symbol: '^KS11', name: 'KOSPI', nameKo: '코스피', price: 5533.77, change: -201.89, changePercent: -3.519911, previousClose: 5735.66 }],
  usStocks: [
    { symbol: '^GSPC', name: 'S&P 500', nameKo: 'S&P 500', price: 7663.43, change: -93.7, changePercent: -1.2084272, previousClose: 7757.17 },
    { symbol: '^IXIC', name: 'NASDAQ', nameKo: '나스닥', price: 26008.86, change: -694, changePercent: -2.5989654, previousClose: 26702.86 },
  ],
  europeStocks: [], japanStocks: [], chinaStocks: [],
  forex: [{ symbol: 'KRW=X', name: 'USD/KRW', nameKo: '원/달러', rate: 1325.4, change: -1.2, changePercent: -0.09 }],
  commodities: [], bonds: [{ symbol: '^TNX', nameKo: '미국 10년물', yield: 4.95, change: -0.19 }],
  crypto: [{ symbol: 'BTC-USD', name: 'Bitcoin', nameKo: '비트코인', price: 81373, changePercent: -4.02 }],
  collectionErrors: [],
} as never

const GOOD_SESSIONS: StripeSession[] = [{ date: '2026-10-20', pct: -1.2 }, { date: '2026-10-21', pct: 1.8 }, { date: '2026-10-22', pct: -3.519911 }]
// 10/20~10/23 실제 오류: 야후 일봉이 10/22를 비워 맨 끝이 10/21(빨강)로 남았다.
const BUGGY_SESSIONS: StripeSession[] = [{ date: '2026-10-19', pct: 1.6 }, { date: '2026-10-20', pct: -1.2 }, { date: '2026-10-21', pct: 1.8 }]

function marketPage(sessions = GOOD_SESSIONS, headline = '기술주 팔고 국채 산 밤, 코스피는 3.5% 밀렸다', yesterday?: string): string {
  return renderReport(marketContent(headline, yesterday), marketData, [], 'normal', [], sessions)
}
/** data-pct가 없던 옛 페이지(10/23 이전 발행분)와 같은 모양. */
const withoutPct = (html: string) => html.replace(/ data-pct="[^"]*"/g, '')

// ── ETF 페이지 ───────────────────────────────────────────────────────────
const eq = (ticker: string, name: string, pct: number) => ({
  ticker, name, market: /\.(KS|KQ)$/.test(ticker) ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1000,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
}) as EtfQuote
const ETF_QUOTES: EtfQuote[] = [
  eq('069500.KS', 'KODEX 200', -3.61), eq('278540.KS', 'KODEX MSCI Korea TR', -3.64),
  eq('091160.KS', 'KODEX 반도체', -5.24), eq('471760.KS', 'TIGER AI반도체핵심공정', -4.7),
  eq('0098F0.KS', 'KODEX 원자력SMR', -7.01), eq('305540.KS', 'TIGER 2차전지테마', -6.13),
  eq('QQQ', 'Invesco NASDAQ-100 ETF', -2.86), eq('SPY', 'SPDR S&P 500', -1.21),
]
const etfData = {
  reportType: 'morning', date: DATE, flows: [], investorFlows: [], news: [], analysisLens: '', quotes: ETF_QUOTES,
  macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
} as CollectedData
const etfReport = (headline = '나스닥 2.6% 급락, 반도체 ETF도 밀렸다'): MorningReport => ({
  cover: { headline, subline: '부제' },
  summary: { overseas: '미 반도체가 6%대로 밀리며 나스닥을 2.6% 끌어내렸습니다.', domestic: '전일 코스피가 3.5% 하락했습니다.', focus: '개장 30분 거래대금을 봅니다.' },
  assetCards: [{ key: 'kr-semi', ifHolding: 'a', ifConsidering: 'b' }],
  todayChecks: [{ time: '09:00', what: 'w', baseline: 'b', invalidation: 'i' }],
  card: { key: 'kr-semi', line: '반등인지 추가 하락인지 오전 흐름을 볼 때입니다' },
})
const etfPage = (report = etfReport()) => renderMorningHtml(report, etfData, { publicBaseUrl: BASE })

// ── 주입: 가져오기·시세 ─────────────────────────────────────────────────
interface FakeSite { pages: Record<string, string>; calls: string[]; fail?: (url: string) => Error | PageResponse | null }
function fakeFetch(site: FakeSite) {
  return async (url: string): Promise<PageResponse> => {
    site.calls.push(url)
    const failed = site.fail?.(url)
    if (failed instanceof Error) throw failed
    if (failed) return failed
    if (url.endsWith('-preview.png')) return { status: 200, contentType: 'image/png', body: '' }
    const html = site.pages[url]
    return html === undefined ? { status: 404, contentType: 'text/html', body: 'not found' } : { status: 200, contentType: 'text/html; charset=utf-8', body: html }
  }
}

function baseQuotes(): Record<string, QuoteSnapshot> {
  const q = (symbol: string, price: number, pct: number, time: Date): QuoteSnapshot => ({ symbol, price, changePercent: pct, marketTime: time })
  const out: Record<string, QuoteSnapshot> = {
    '^KS11': q('^KS11', 5533.77, -3.519911, KR_TIME), '^KQ11': q('^KQ11', 764.1, -2.2852533, KR_TIME),
    '^GSPC': q('^GSPC', 7663.43, -1.2084272, US_TIME), '^IXIC': q('^IXIC', 26008.86, -2.5989654, US_TIME),
    '^DJI': q('^DJI', 52867.98, 0.022496, US_TIME), '^SOX': q('^SOX', 10731.98, -6.7235184, US_TIME),
  }
  for (const e of ETF_QUOTES) out[e.ticker] = q(e.ticker, 100, e.changePercent as number, e.market === 'KR' ? KR_ETF_TIME : US_TIME)
  return out
}
function fakeQuotes(quotes: Record<string, QuoteSnapshot>, calls: string[][] = []) {
  return async (symbols: string[]) => {
    calls.push(symbols)
    return symbols.map((s) => quotes[s]).filter((x): x is QuoteSnapshot => x !== undefined)
  }
}

const noSleep = async () => {}
async function run(opts: { pages?: Record<string, string>; quotes?: Record<string, QuoteSnapshot>; date?: string; today?: string; kinds?: Array<'market' | 'etf'>; site?: FakeSite; fetchQuotes?: (s: string[]) => Promise<QuoteSnapshot[]>; marketCardLine?: string | null }) {
  const site = opts.site ?? { pages: opts.pages ?? {}, calls: [] }
  const results = await runPublishedChecks({
    date: opts.date ?? DATE, base: BASE, kinds: opts.kinds ?? ['market', 'etf'], today: opts.today ?? DATE,
    fetchPage: fakeFetch(site), fetchQuotes: opts.fetchQuotes ?? fakeQuotes(opts.quotes ?? baseQuotes()),
    marketCardLine: opts.marketCardLine, sleep: noSleep,
  })
  return { results, site }
}
const pick = (rs: CheckResult[], id: string, titleIncludes = '') => {
  const r = rs.find((x) => x.id === id && x.title.includes(titleIncludes))
  assert.ok(r, `${id} ${titleIncludes} 결과 없음: ${rs.map((x) => `${x.id}:${x.title}`).join(' | ')}`)
  return r
}
const MARKET_URL = `${BASE}/reports/${DATE}.html`
const ETF_URL = `${BASE}/etf-reports/${DATE}.html`

// ── 회귀: 10/23 실제 오류 ────────────────────────────────────────────────
test('회귀(10/23): 맨 끝 줄무늬가 10/21(빨강)인 페이지 — 직전 거래일 10/22 −3.52%와 대조하면 M1·M2 FAIL', async () => {
  for (const html of [marketPage(BUGGY_SESSIONS), withoutPct(marketPage(BUGGY_SESSIONS))]) {
    const { results } = await run({ pages: { [MARKET_URL]: html }, kinds: ['market'] })
    const m1 = pick(results, 'M1')
    assert.equal(m1.status, 'FAIL')
    assert.equal(m1.expected, '2026-10-22')
    assert.equal(m1.actual, '2026-10-21')
    const m2 = pick(results, 'M2')
    assert.equal(m2.status, 'FAIL', JSON.stringify(m2))
    assert.match(`${m2.expected} ${m2.actual}`, /-3\.52/)
  }
})

test('올바른 Market 페이지: M1~M5 통과, 24시간 지표·금리는 SKIP(사유 표기)', async () => {
  const { results } = await run({ pages: { [MARKET_URL]: marketPage() }, kinds: ['market'], marketCardLine: 'AI 지출 우려에 기술주 매도가 몰렸습니다.' })
  assert.deepEqual(results.filter((r) => r.status === 'FAIL'), [])
  for (const id of ['M1', 'M2', 'M4', 'M5']) assert.equal(pick(results, id).status, 'PASS', id)
  for (const label of ['코스피', 'S&P 500', '나스닥']) assert.equal(pick(results, 'M3', label).status, 'PASS', label)
  for (const label of ['원/달러', '미 10년물', '비트코인']) {
    const r = pick(results, 'M3', label)
    assert.equal(r.status, 'SKIP', label)
    assert.ok(r.note, `${label} SKIP 사유`)
  }
  assert.equal(pick(results, 'M2').actual, '-3.52%')
})

test('색 부호 대체: data-pct 없는 옛 페이지도 줄무늬 방향을 색으로 판정한다', async () => {
  const ok = await run({ pages: { [MARKET_URL]: withoutPct(marketPage()) }, kinds: ['market'] })
  const m2 = pick(ok.results, 'M2')
  assert.equal(m2.status, 'PASS')
  assert.match(m2.note ?? '', /색/)
  // 보합(|등락|<0.1)은 회색 — 시세가 보합이면 통과, 크게 움직였으면 실패
  const flatPage = withoutPct(marketPage([{ date: '2026-10-22', pct: 0.02 }]))
  const flatQuotes = baseQuotes(); flatQuotes['^KS11'] = { ...flatQuotes['^KS11'], changePercent: 0.04 }
  assert.equal(pick((await run({ pages: { [MARKET_URL]: flatPage }, kinds: ['market'], quotes: flatQuotes })).results, 'M2').status, 'PASS')
  assert.equal(pick((await run({ pages: { [MARKET_URL]: flatPage }, kinds: ['market'] })).results, 'M2').status, 'FAIL')
})

test('색 부호: diverging 팔레트 전 구간에서 빨강=상승, 파랑=하락, #E7EAEE=보합', () => {
  for (let p = 0.1; p <= 12; p += 0.01) {
    assert.equal(colorSign(diverging(p)), 'up', `+${p}`)
    assert.equal(colorSign(diverging(-p)), 'down', `-${p}`)
  }
  assert.equal(colorSign(diverging(0.05)), 'flat')
  assert.equal(colorSign('#cf453f'), 'up')
  assert.equal(colorSign('url(#x)'), null)
})

test('data-pct 대조: 0.05%p 넘게 다르면 같은 방향이어도 실패', async () => {
  const off = marketPage([{ date: '2026-10-21', pct: 1.8 }, { date: '2026-10-22', pct: -3.6 }])
  const m2 = pick((await run({ pages: { [MARKET_URL]: off }, kinds: ['market'] })).results, 'M2')
  assert.equal(m2.status, 'FAIL')
  assert.equal(pick((await run({ pages: { [MARKET_URL]: off }, kinds: ['market'] })).results, 'M1').status, 'PASS')
})

test('M3: 핵심 지표 가격 ±0.1%·등락 ±0.05%p — 펼쳐 보기(시장 체온)의 같은 카드는 보지 않는다', async () => {
  const q = baseQuotes()
  q['^GSPC'] = { ...q['^GSPC'], price: 7663.43 * 1.002 } // 가격 0.2% 차이
  q['^IXIC'] = { ...q['^IXIC'], changePercent: -2.68 } // 등락 0.08%p 차이
  const { results } = await run({ pages: { [MARKET_URL]: marketPage() }, kinds: ['market'], quotes: q })
  assert.equal(pick(results, 'M3', 'S&P 500').status, 'FAIL')
  assert.equal(pick(results, 'M3', '나스닥').status, 'FAIL')
  assert.equal(pick(results, 'M3', '코스피').status, 'PASS')
  assert.equal(results.filter((r) => r.id === 'M3' && r.title.includes('코스피')).length, 1)
})

// ── M4: 제목·카드·요약 수치 ───────────────────────────────────────────────
const ok = (symbol: string, pct: number): QuoteEval => ({ state: 'ok', symbol, session: '2026-10-22', price: null, changePercent: pct })
const EVALS: Record<string, QuoteEval> = {
  코스피: ok('^KS11', -3.519911), 코스닥: ok('^KQ11', -2.2852533), 'S&P500': ok('^GSPC', -1.2084272),
  나스닥: ok('^IXIC', -2.14), 다우: ok('^DJI', 0.022496), '필라델피아 반도체지수': ok('^SOX', -6.7235184),
}
const claim = (text: string, evals = EVALS) => checkIndexClaims('M4', 'market', [{ source: 'h1', text }], evals)

test('M4 반올림: 소수 한 자리 ±0.06, 두 자리 ±0.02(야후 사후 보정 여유), 정수+대·넘게·이상은 내림·하한', () => {
  const pass = ['코스피는 3.5% 밀렸다', '나스닥이 2.14% 밀렸다', '코스피 3.52% 하락', '코스피 3.53% 하락', '나스닥이 2.15% 밀렸다', '코스피가 3% 넘게 빠졌다', '코스피 3%대 급락', '코스피 3% 이상 하락했다', 'S&P 500이 1.2% 내렸다']
  const fail = ['코스피는 3.6% 밀렸다', '코스피 3.55% 하락', '나스닥이 2.17% 밀렸다', '코스피가 4% 넘게 빠졌다', '코스피 2%대 하락', '코스피 2.52% 하락']
  for (const t of pass) assert.equal(claim(t).status, 'PASS', `${t}: ${JSON.stringify(claim(t))}`)
  for (const t of fail) assert.equal(claim(t).status, 'FAIL', `${t}: ${JSON.stringify(claim(t))}`)
})

test('M4 방향: 수치 바로 뒤 방향어가 반대면 실패, 방향어가 없으면 크기만 본다', () => {
  assert.equal(claim('코스피 3.5% 반등').status, 'FAIL')
  assert.equal(claim('코스피 3.5% 상승 마감').status, 'FAIL')
  assert.equal(claim('다우는 0.02% 올랐다').status, 'PASS')
  assert.equal(claim('코스피 3.5%, 숨 고르기').status, 'PASS')
  assert.equal(claim('코스피 +3.5%').status, 'FAIL') // 부호도 방향
})

test('M4: 주장이 없으면 SKIP, 장중 KR 지수 주장은 SKIP(미국은 판정), 시세가 없으면 FAIL', () => {
  assert.equal(claim('기술주 팔고 국채 산 밤').status, 'SKIP')
  const live = { ...EVALS, 코스피: { state: 'skip', symbol: '^KS11', note: '장중 — 직전 거래일 시세 아님' } as QuoteEval }
  const both = checkIndexClaims('M4', 'market', [{ source: 'h1', text: '코스피 3.5% 하락, 나스닥 2.14% 하락' }], live)
  assert.equal(both.status, 'PASS')
  assert.match(both.note ?? '', /장중/)
  assert.equal(checkIndexClaims('M4', 'market', [{ source: 'h1', text: '코스피 3.5% 하락' }], live).status, 'SKIP')
  const missing = { ...EVALS, 나스닥: { state: 'fail', symbol: '^IXIC', note: '시세 없음' } as QuoteEval }
  assert.equal(checkIndexClaims('M4', 'market', [{ source: 'h1', text: '나스닥 2.14% 하락' }], missing).status, 'FAIL')
})

test('코스닥 수치는 대조하지 않는다 — 야후 ^KQ11 시세가 틀린 날 맞는 페이지에 실패 메일이 가지 않게(10/23 실측)', () => {
  // 10/22 코스닥 실제 -3.62%(764.10 ÷ 10/21 792.76). 07:52 야후 시세는 이전 종가를 10/20 종가 781.97로 들고 -2.29%였다.
  const kq: QuoteEval = { state: 'ok', symbol: '^KQ11', session: '2026-10-22', price: 764.1, changePercent: -2.2852533, previousClose: 781.97 }
  const r = checkIndexClaims('E3', 'etf', [{ source: '요약', text: '코스닥이 3.62% 하락했습니다.' }], { ...EVALS, 코스닥: kq })
  assert.equal(r.status, 'SKIP')
  assert.match(r.note ?? '', /\^KQ11 시세 신뢰 낮음/)
  const mixed = checkIndexClaims('E3', 'etf', [{ source: '요약', text: '코스피 3.5% 하락, 코스닥 3.62% 하락' }], { ...EVALS, 코스닥: kq })
  assert.equal(mixed.status, 'PASS') // 코스피는 그대로 대조
})

test('불일치 메모에 시세의 이전 종가를 적는다 — 야후 시세 쪽이 틀린 날을 메일만 보고 가려내게', () => {
  const ks: QuoteEval = { state: 'ok', symbol: '^KS11', session: '2026-10-22', price: 5533.77, changePercent: -3.519911, previousClose: 5735.66 }
  const r = checkIndexClaims('M4', 'market', [{ source: 'h1', text: '코스피가 1.2% 하락했다' }], { ...EVALS, 코스피: ks })
  assert.equal(r.status, 'FAIL')
  assert.match(r.actual ?? '', /이전 종가 5,735\.66/)
  assert.doesNotMatch(claim('코스피 3.5% 하락').actual ?? '', /이전 종가/) // 일치하면 적지 않는다
})

test('M4: 제목뿐 아니라 요약·카드 한 줄의 틀린 수치도 잡는다', async () => {
  const page = marketPage(GOOD_SESSIONS, '기술주 팔고 국채 산 밤', '코스피가 4.1% 하락했습니다.')
  const m4 = pick((await run({ pages: { [MARKET_URL]: page }, kinds: ['market'] })).results, 'M4')
  assert.equal(m4.status, 'FAIL')
  assert.match(m4.actual ?? '', /요약/)
  const card = pick((await run({ pages: { [MARKET_URL]: marketPage(GOOD_SESSIONS, '기술주 팔고 국채 산 밤', '기술주가 밀렸습니다.') }, kinds: ['market'], marketCardLine: '나스닥 2.9% 급락에 코스피도 밀렸다' })).results, 'M4')
  assert.equal(card.status, 'FAIL')
  assert.match(card.actual ?? '', /카드/)
})

test('M5: og:image가 그날 미리보기 PNG이고 200 image/png, og:title = h1', async () => {
  const good = pick((await run({ pages: { [MARKET_URL]: marketPage() }, kinds: ['market'] })).results, 'M5')
  assert.equal(good.status, 'PASS')
  const wrongImage = marketPage().replace(/2026-10-23-preview\.png/g, '2026-10-22-preview.png')
  assert.equal(pick((await run({ pages: { [MARKET_URL]: wrongImage }, kinds: ['market'] })).results, 'M5').status, 'FAIL')
  const wrongTitle = marketPage().replace('<meta property="og:title" content="기술주', '<meta property="og:title" content="어제 기술주')
  assert.equal(pick((await run({ pages: { [MARKET_URL]: wrongTitle }, kinds: ['market'] })).results, 'M5').status, 'FAIL')
  const site: FakeSite = { pages: { [MARKET_URL]: marketPage() }, calls: [], fail: (u) => (u.endsWith('.png') ? { status: 200, contentType: 'text/html', body: '' } : null) }
  assert.equal(pick((await run({ site, kinds: ['market'] })).results, 'M5').status, 'FAIL')
})

// ── ETF ──────────────────────────────────────────────────────────────────
test('올바른 ETF 페이지: 예시 ETF(영숫자 코드 포함)·모자이크·제목 수치·메타 모두 통과', async () => {
  const { results } = await run({ pages: { [ETF_URL]: etfPage() }, kinds: ['etf'] })
  assert.deepEqual(results.filter((r) => r.status === 'FAIL'), [])
  const e1 = results.filter((r) => r.id === 'E1')
  assert.ok(e1.length >= 5, e1.map((r) => r.title).join(' | '))
  assert.ok(e1.every((r) => r.status === 'PASS'))
  assert.ok(e1.some((r) => r.title.includes('0098F0')), '영숫자 국내 코드')
  assert.ok(e1.some((r) => r.title.includes('QQQ')))
  assert.equal(pick(results, 'E2').status, 'PASS')
  assert.equal(pick(results, 'E3').status, 'PASS')
  assert.equal(pick(results, 'E4').status, 'PASS')
})

test('ETF: 예시 ETF 등락이 시세와 0.05%p 넘게 다르면 그 예시만 FAIL', async () => {
  const q = baseQuotes(); q['091160.KS'] = { ...q['091160.KS'], changePercent: -4.24 }
  const { results } = await run({ pages: { [ETF_URL]: etfPage() }, kinds: ['etf'], quotes: q })
  const bad = results.filter((r) => r.id === 'E1' && r.status === 'FAIL')
  assert.equal(bad.length, 1)
  assert.match(bad[0].title, /KODEX 반도체.*091160/)
  assert.match(`${bad[0].expected} ${bad[0].actual}`, /-4\.24%.*-5\.24%|-5\.24%.*-4\.24%/)
  const e2 = pick(results, 'E2')
  assert.equal(e2.status, 'FAIL')
  assert.match(e2.actual ?? '', /1개/)
  assert.match(e2.actual ?? '', /091160/)
})

test('E2: data-ticker 없는 옛 모자이크는 강조 타일만 색으로 보고 나머지는 대조 불가로 센다', async () => {
  const old = withoutPct(etfPage()).replace(/<rect data-ticker="[^"]*" /g, '<rect ')
  const e2 = pick((await run({ pages: { [ETF_URL]: old }, kinds: ['etf'] })).results, 'E2')
  assert.equal(e2.status, 'PASS', JSON.stringify(e2))
  assert.match(e2.note ?? '', /data-ticker 없는 타일 \d+개/)
  const q = baseQuotes(); q['091160.KS'] = { ...q['091160.KS'], changePercent: 1.5 } // 강조 타일(반도체 슬롯)의 방향 반대
  assert.equal(pick((await run({ pages: { [ETF_URL]: old }, kinds: ['etf'], quotes: q })).results, 'E2').status, 'FAIL')
})

test('E3·E4: ETF 제목 칩(코드 표기)을 벗겨 og:title과 비교하고, 틀린 지수 수치는 잡는다', async () => {
  const chip = etfPage(etfReport('KODEX 반도체 5% 넘게 밀린 날, 나스닥 2.6% 급락'))
  assert.match(chip, /etf-chip-code/)
  const r = (await run({ pages: { [ETF_URL]: chip }, kinds: ['etf'] })).results
  assert.equal(pick(r, 'E4').status, 'PASS', JSON.stringify(pick(r, 'E4')))
  assert.equal(pick(r, 'E3').status, 'PASS')
  const wrong = (await run({ pages: { [ETF_URL]: etfPage(etfReport('나스닥 3.6% 급락, 반도체 ETF도 밀렸다')) }, kinds: ['etf'] })).results
  assert.equal(pick(wrong, 'E3').status, 'FAIL')
})

// ── 시점 ─────────────────────────────────────────────────────────────────
test('장중(09:50 감시): 한국 시세가 오늘 세션이면 KR 대조는 SKIP("장중 — 직전 거래일 시세 아님"), 미국 대조는 그대로', async () => {
  const q = baseQuotes()
  for (const s of Object.keys(q)) if (s.startsWith('^K') || s.endsWith('.KS')) q[s] = { ...q[s], marketTime: KR_LIVE, changePercent: 0.5 }
  const { results } = await run({ pages: { [MARKET_URL]: marketPage(), [ETF_URL]: etfPage() }, quotes: q })
  assert.deepEqual(results.filter((r) => r.status === 'FAIL'), [])
  const m2 = pick(results, 'M2')
  assert.equal(m2.status, 'SKIP')
  assert.match(m2.note ?? '', /장중 — 직전 거래일 시세 아님/)
  assert.equal(pick(results, 'M3', '코스피').status, 'SKIP')
  assert.equal(pick(results, 'M3', 'S&P 500').status, 'PASS')
  assert.equal(pick(results, 'M1').status, 'PASS') // 시세와 무관
  const e1 = results.filter((r) => r.id === 'E1')
  assert.ok(e1.filter((r) => r.title.match(/\d{6}|0098F0/)).every((r) => r.status === 'SKIP'))
  assert.ok(e1.filter((r) => r.title.includes('QQQ')).every((r) => r.status === 'PASS'))
  assert.equal(pick(results, 'E3').status, 'PASS') // 나스닥은 판정, 코스피는 SKIP
})

test('과거 날짜: 현재 시세는 그날의 직전 거래일이 아니므로 시세 대조는 SKIP, M1·M5는 판정', async () => {
  const date = '2026-10-19'
  const page = renderReport(marketContent('코스피 1.6% 반등'), { ...(marketData as object), date, dayOfWeek: '월' } as never, [], 'normal', [], [{ date: '2026-10-15', pct: -7.57 }, { date: '2026-10-16', pct: 1.6 }])
  const { results } = await run({ pages: { [`${BASE}/reports/${date}.html`]: page }, kinds: ['market'], date, today: DATE })
  assert.equal(pick(results, 'M1').status, 'PASS')
  assert.equal(pick(results, 'M1').expected, '2026-10-16')
  assert.equal(pick(results, 'M5').status, 'PASS')
  const m2 = pick(results, 'M2')
  assert.equal(m2.status, 'SKIP')
  assert.match(m2.note ?? '', /과거 날짜/)
  assert.equal(pick(results, 'M3', 'S&P 500').status, 'SKIP')
})

test('오래된 시세(직전 거래일보다 이전)는 비교할 수 없으니 FAIL — 침묵은 통과가 아니다', async () => {
  const q = baseQuotes(); q['^KS11'] = { ...q['^KS11'], marketTime: new Date('2026-10-21T11:00:00Z') }
  const m2 = pick((await run({ pages: { [MARKET_URL]: marketPage() }, kinds: ['market'], quotes: q })).results, 'M2')
  assert.equal(m2.status, 'FAIL')
  assert.match(m2.note ?? '', /오래된 시세/)
})

test('한국 휴장일(한글날)은 리포트가 없는 날 — 모두 SKIP, 페이지를 가져오지 않는다', async () => {
  const { results, site } = await run({ date: '2026-10-09', today: '2026-10-09' })
  assert.ok(results.length >= 1)
  assert.ok(results.every((r) => r.status === 'SKIP'))
  assert.match(results[0].note ?? '', /휴장/)
  assert.deepEqual(site.calls, [])
})

// ── 견고성 ───────────────────────────────────────────────────────────────
test('네트워크 실패: 3번 다시 시도한 뒤에도 실패하면 그 페이지에 기대는 검사는 모두 FAIL(사유 표기)', async () => {
  const site: FakeSite = { pages: { [ETF_URL]: etfPage() }, calls: [], fail: (u) => (u === MARKET_URL ? new Error('ECONNRESET') : null) }
  const { results } = await run({ site })
  assert.equal(site.calls.filter((u) => u === MARKET_URL).length, 3)
  const market = results.filter((r) => r.kind === 'market')
  assert.ok(market.length >= 5)
  assert.ok(market.every((r) => r.status === 'FAIL'), JSON.stringify(market))
  assert.match(market[0].note ?? '', /ECONNRESET/)
  assert.deepEqual(results.filter((r) => r.kind === 'etf' && r.status === 'FAIL'), [])
  const notFound = (await run({ pages: {}, kinds: ['etf'] })).results
  assert.ok(notFound.every((r) => r.status === 'FAIL'))
  assert.match(notFound[0].note ?? '', /HTTP 404/)
})

test('시세 실패: 다시 시도해도 실패하면 시세 대조는 FAIL, 시세와 무관한 M1·M5·E4는 판정', async () => {
  let attempts = 0
  const fetchQuotes = async () => { attempts++; throw new Error('Yahoo 503') }
  const { results } = await run({ pages: { [MARKET_URL]: marketPage(), [ETF_URL]: etfPage() }, fetchQuotes })
  assert.ok(attempts >= 3)
  for (const id of ['M2', 'M4', 'E2', 'E3']) {
    assert.equal(pick(results, id).status, 'FAIL', id)
    assert.match(pick(results, id).note ?? '', /Yahoo 503/, id)
  }
  assert.equal(pick(results, 'M3', '코스피').status, 'FAIL')
  assert.ok(results.filter((r) => r.id === 'E1').every((r) => r.status === 'FAIL'))
  for (const id of ['M1', 'M5', 'E4']) assert.equal(pick(results, id).status, 'PASS', id)
})

test('시세 없는 종목(야후 배치가 조용히 빠뜨림)은 FAIL "시세 없음"', async () => {
  const q = baseQuotes(); delete q['^KS11']
  const m2 = pick((await run({ pages: { [MARKET_URL]: marketPage() }, kinds: ['market'], quotes: q })).results, 'M2')
  assert.equal(m2.status, 'FAIL')
  assert.match(m2.note ?? '', /시세 없음/)
})

test('withRetry: 지수 백오프로 최대 3번, 성공하면 바로 돌려준다', async () => {
  const waits: number[] = []
  let n = 0
  const v = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok' }, { attempts: 3, baseMs: 100, sleep: async (ms) => { waits.push(ms) } })
  assert.equal(v, 'ok'); assert.deepEqual(waits, [100, 200])
  await assert.rejects(withRetry(async () => { throw new Error('down') }, { attempts: 3, baseMs: 1, sleep: noSleep }), /down/)
})

// ── CLI 출력 ─────────────────────────────────────────────────────────────
test('CLI 인자: 기본값(오늘 KST·운영 주소·all), --date·--base·--kind, 잘못된 값은 거부', () => {
  assert.deepEqual(parseCliArgs([], '2026-10-23'), { date: '2026-10-23', base: BASE, kinds: ['market', 'etf'] })
  assert.deepEqual(parseCliArgs(['--date', '2026-10-19', '--base', 'https://x.vercel.app/', '--kind', 'etf'], '2026-10-23'), { date: '2026-10-19', base: 'https://x.vercel.app', kinds: ['etf'] })
  assert.throws(() => parseCliArgs(['--date', '10/19'], '2026-10-23'))
  assert.throws(() => parseCliArgs(['--kind', 'both'], '2026-10-23'))
  assert.equal(kstToday(new Date('2026-10-22T22:45:00Z')), '2026-10-23')
})

test('출력: 한 줄에 상태·기대·실제, ::error:: 주석은 %·줄바꿈을 이스케이프, 요약은 표', () => {
  const r: CheckResult = { id: 'M1', kind: 'market', status: 'FAIL', title: '줄무늬 맨 끝 = 직전 한국 거래일', expected: '2026-10-22', actual: '2026-10-21', note: '-3.52%\n두 줄' }
  const line = formatLine(r)
  assert.match(line, /^FAIL\s+M1 \[market\] 줄무늬 맨 끝/)
  assert.match(line, /expected 2026-10-22/); assert.match(line, /actual 2026-10-21/)
  const ann = errorAnnotation(r)
  assert.match(ann, /^::error title=발행물 검사 M1 \(market\)::/)
  assert.match(ann, /-3\.52%25%0A두 줄/)
  assert.doesNotMatch(ann, /\n/)
  const md = formatStepSummary([r, { ...r, id: 'M5', status: 'PASS', note: undefined }], { date: DATE, base: BASE })
  assert.match(md, /\| FAIL \| M1 \|/)
  assert.match(md, /\| PASS \| M5 \|/)
  assert.match(md, /2026-10-23/)
})
