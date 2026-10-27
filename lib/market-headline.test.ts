// 2026-10-27 제목 편집 기준 — Market: 후보 셋 → 제목 단위 검사로 거르기 → 임시 제목 → 발송 직전 편집자 한 번.
// 네트워크 없이 SDK 의 Messages.stream(생성)·Messages.create(편집자)만 가짜로 바꿔 끼운다.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { generateReport, buildReportPrompt, marketHeadlineProblems, marketHeadlineBlocking } from './claude-client'

const DATA = {
  collectedAt: '2026-10-16T07:00:00+09:00', date: '2026-10-16', dayOfWeek: '금',
  koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
} as never
const LINE = '해외 충격보다 국내 수급 부담이 더 컸습니다'
const BAD = '코스피 사상 최고 경신, 반도체 강세' // 기간 비교·최상급(Ruling 31) — 후보에서 빠진다
const GOOD_A = '코스피 2% 상승에 반도체 강세'
const GOOD_B = 'S&P500 오르고 코스피 내려'

function body(cover: Record<string, unknown>): string {
  return JSON.stringify({
    cover,
    summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸습니다.', today: '개장 30분 거래대금이 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서.' },
    cardLine: { kind: 'cause', text: LINE },
    bigStory: { content: [{ type: 'paragraph', text: '본문입니다.' }] },
    watchPoints: [], soWhat: [], calendar: [], closingMessage: '마무리',
  })
}
const reply = (cands: Array<[string, string]>) => body({ headlineCandidates: cands.map(([headline, subline]) => ({ headline, subline })), imageKeywords: [] })

/** 생성(stream)은 replies 를 차례로, 편집자(create)는 verdict 를 pick 도구 결과로 돌려준다. 시계는 멈춰 둔다(예산 충분). */
function fakeApis(replies: string[], verdict: unknown) {
  let calls = 0
  const systems: string[] = []
  mock.method(console, 'log', () => {})
  mock.method(console, 'error', () => {})
  mock.method(Date, 'now', () => 1_000_000)
  const stream = mock.method(Anthropic.Messages.prototype, 'stream', (...args: unknown[]) => {
    systems.push((args[0] as { system: string }).system)
    const r = replies[Math.min(calls++, replies.length - 1)]
    return { finalMessage: async () => ({ content: [{ type: 'text', text: r }] }) } as never
  })
  const create = mock.method(Anthropic.Messages.prototype, 'create', async () => ({ content: [{ type: 'tool_use', id: 't1', name: 'pick', input: verdict }] }) as never)
  return { stream, create, systems }
}

test('Market 제목: 검사에 걸린 후보는 빼고, 편집자가 고른 생존 후보로 제목·부제를 쓴다(후보 필드는 남기지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, create, systems } = fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 1, scores: [{ natural: 3, clear: 3 }, { natural: 4, clear: 5 }], reason: '대비가 분명' })
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.equal(create.mock.callCount(), 1)
  assert.equal(content.cover.headline, GOOD_B)
  assert.equal(content.cover.subline, '부제B')
  assert.equal(content.cover.headlineCandidates, undefined)
  const sent = JSON.stringify((create.mock.calls[0].arguments[0] as { messages: unknown }).messages)
  assert.ok(!sent.includes('사상 최고'), '검사에 걸린 후보는 편집자에게 보내지 않는다')
  assert.ok(!systems[0].includes('(제목·본문 모두)'), '은유 권장은 본문에만')
  assert.ok(!systems[0].includes('### 지향할 헤드라인 결'), '제목 예시는 사용자 프롬프트로 옮겼다')
})

test('Market 제목: 편집자 응답이 틀리면(번호 범위 밖) 임시 제목(코드 점수 1위·앞 순서)으로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 7, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(content.cover.headline, GOOD_A)
  assert.equal(content.cover.subline, '부제A')
})

test('Market 제목: HEADLINE_SELECTION=OFF 면 편집자를 부르지 않고 첫 생존 후보로', async (t) => {
  process.env.HEADLINE_SELECTION = ' OFF '
  t.after(() => { delete process.env.HEADLINE_SELECTION; mock.restoreAll() })
  const { create } = fakeApis([reply([[BAD, '부제0'], [GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 1, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(create.mock.callCount(), 0)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목: 1회차 후보가 모두 검사에 걸리면 재생성하고, 2회차 생존 후보로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const allBad = reply([[BAD, 's'], ['코스피 역대 최대 낙폭, 반도체 급락', 's'], ['반도체 사상 최저, 코스피 급락', 's']])
  const { stream } = fakeApis([allBad, reply([[GOOD_A, '부제A'], [GOOD_B, '부제B']])], { pick: 0, scores: [], reason: 'r' })
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목(F1): 생존 후보가 없고 0번이 HARD 권유여도, 권유 없는 후보로 3회차에 경고와 함께 발송한다(막지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const every = reply([['반도체 지금 매수하세요', '부제'], [BAD, '부제']])
  const { stream, create } = fakeApis([every], { pick: 0, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3) // 1~2회차는 후보의 기간 비교·최상급 위반으로 재생성, 마지막 회차는 경고 후 발송
  assert.equal(create.mock.callCount(), 0) // 생존 후보가 없으니 편집자를 부르지 않는다
  assert.equal(content.cover.headline, BAD)
  assert.equal(content.cover.headlineCandidates, undefined)
})

test('Market 제목: 옛 응답(cover.headline 만)은 후보 하나 — 편집자를 부르지 않는다', async (t) => {
  t.after(() => mock.restoreAll())
  const { create } = fakeApis([body({ headline: GOOD_A, subline: '부제A' })], { pick: 0, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(create.mock.callCount(), 0)
  assert.equal(content.cover.headline, GOOD_A)
})

test('Market 제목: cover.headline 과 후보를 함께 쓰면 후보가 이긴다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeApis([body({ headline: '옛 제목 필드', subline: 'x', headlineCandidates: [{ headline: GOOD_A, subline: '부제A' }, { headline: GOOD_B, subline: '부제B' }] })], { pick: 0, scores: [], reason: '' })
  const { content } = await generateReport(DATA)
  assert.equal(content.cover.headline, GOOD_A)
})

test('marketHeadlineProblems: 부제의 HARD 권유·제목 최상급·빈 부제·카드 제목 넘침을 후보별로 잡는다', () => {
  const ok = { cardLine: { kind: 'cause' as const, text: LINE } }
  assert.deepEqual(marketHeadlineProblems({ headline: GOOD_A, subline: '부제' }, ok), [])
  assert.ok(marketHeadlineProblems({ headline: GOOD_A, subline: '지금 매수하세요' }, ok).some((p) => /투자 권유성 표현/.test(p)))
  assert.ok(marketHeadlineProblems({ headline: BAD, subline: '부제' }, ok).length > 0)
  assert.ok(marketHeadlineProblems({ headline: GOOD_A, subline: '' }, ok).includes('subline 누락'))
  const long = '코스피 급락 다음 날 미 증시는 숨 고르기에 들어갔고 외국인 매도와 환율 부담이 한꺼번에 겹치며 투자자들의 관망이 길어졌습니다'
  assert.ok(marketHeadlineProblems({ headline: long, subline: '부제' }, ok).some((p) => /^카드 headline/.test(p)))
  // 카드 한 줄 자체의 문제는 후보 탓이 아니다(모든 후보에 같다)
  assert.deepEqual(marketHeadlineProblems({ headline: GOOD_A, subline: '부제' }, { cardLine: { kind: 'cause', text: '' } }), [])
})

test('marketHeadlineBlocking: 제목·부제의 HARD 권유만 차단 — 기간 비교·빈 부제·SOFT 단정은 경고로 발송할 수 있다', () => {
  assert.equal(marketHeadlineBlocking({ headline: '반도체 지금 매수하세요', subline: '부제' }), true)
  assert.equal(marketHeadlineBlocking({ headline: GOOD_A, subline: '지금 매수하세요' }), true)
  assert.equal(marketHeadlineBlocking({ headline: BAD, subline: '부제' }), false)
  assert.equal(marketHeadlineBlocking({ headline: GOOD_A, subline: '' }), false)
  assert.equal(marketHeadlineBlocking({ headline: GOOD_A, subline: '부제' }), false)
})

test('프롬프트: 공통 기준·순환 예시·후보 스키마·최근 제목 형태(오늘 항목 제외), 옛 은유 지시 없음', () => {
  const entry = (date: string, headline: string) => ({ date, headline, bigStoryTopic: 't', narrativeAngle: 'a', walletTopics: [], metaphors: [], lookingAhead: '' })
  const ctx = {
    angle: { id: 'a', name: '구조적 렌즈', description: '', promptGuide: 'g' },
    recentLog: [entry('2026-10-16', '오늘 다시 만든 제목'), entry('2026-10-15', 'CPI 예상 상회, 나스닥 1.9% 밀렸다'), entry('2026-10-14', '코스피, 349포인트 무너지며 6,035선 후퇴')],
    sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null,
  }
  const p = buildReportPrompt(DATA, ctx as never, null)
  assert.match(p, /\[제목 편집 기준 — Market·ETF 공통\]/)
  assert.match(p, /\[오늘 참고할 제목 예시/)
  assert.match(p, /"headlineCandidates": \[/)
  assert.match(p, /- CPI 예상 상회, 나스닥 1\.9% 밀렸다 〔쉼표 두 토막〕/)
  assert.match(p, /- 헤드라인\(최신순, 〔형태〕\):\n {2}- CPI 예상 상회, 나스닥 1\.9% 밀렸다 〔쉼표 두 토막〕\n {2}- 코스피, 349포인트/) // F9: 최근 제목 줄은 항목 아래에 두 칸 들여써 중첩한다
  assert.match(p, /\n {2}오늘 제목은 이 형태를 피하십시오: 쉼표 두 토막/)
  assert.match(p, /오늘 제목은 이 형태를 피하십시오: 쉼표 두 토막/)
  assert.ok(!p.includes('오늘 다시 만든 제목'), '오늘 날짜 항목은 최근 제목에서 뺀다')
  for (const gone of ['호기심의 방아쇠', '본문이 갚으십시오', '은유가 전면', '신선한 은유·관점을 적극 허용', '오늘 본문을 관통하는 호기심 유발 한 줄', '"…가 그린 …"']) {
    assert.ok(!p.includes(gone), gone)
  }
  // 유지되는 규칙
  assert.match(p, /표제어체로 쓰십시오/)
  assert.match(p, /\*\*수치 앵커\*\*/)
  assert.match(p, /\*\*hollow\*\* 면 \*\*사실 모드\*\*/)
})
