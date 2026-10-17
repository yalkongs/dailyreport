// 카드 글자 맞춤 관문(validateMarketCardText)과 generateReport 재시도 루프의 연결.
// 1~2번째 시도: 카드 글자 위반은 재생성 사유. 마지막 시도: 경고만 남기고 발송. 어떤 경우에도 이 관문 때문에 발송이 막히지 않는다.
// 네트워크 없이 SDK 의 Messages.stream 만 가짜로 바꿔 끼운다.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { cardTextFits } from './preview/data-card'
import { generateReport, validateMarketCardText } from './claude-client'

const FITTING_HEADLINE = '코스피 급락 다음 날, 미 증시는 숨 고르기'
const LONG_HEADLINE = '코스피 급락 다음 날 미 증시는 숨 고르기에 들어갔고 외국인 매도와 환율 부담이 한꺼번에 겹치며 투자자들의 관망이 길어졌습니다'
const LINE = '해외 충격보다 국내 수급 부담이 더 컸습니다'

const cover = (headline: string) => ({ headline, subline: '부제' })
const cardLine = (text: string) => ({ kind: 'cause' as const, text })

test('카드 관문: 맞는 제목·한 줄은 통과, 길면 어느 쪽이 넘는지 알려준다', () => {
  assert.deepEqual(validateMarketCardText({ cover: cover(FITTING_HEADLINE), cardLine: cardLine(LINE) }), [])

  const longHeadline = validateMarketCardText({ cover: cover(LONG_HEADLINE), cardLine: cardLine(LINE) })
  assert.equal(longHeadline.length, 1)
  assert.match(longHeadline[0], /^카드 headline/)

  const longLine = validateMarketCardText({ cover: cover(FITTING_HEADLINE), cardLine: cardLine('가'.repeat(60)) })
  assert.equal(longLine.length, 1)
  assert.match(longLine[0], /^카드 line/)
})

test('카드 관문: 카드는 평문이므로 강조 태그는 벗기고 잰다', () => {
  const plain = '코스피 급락 다음 날 미 증시는 숨 고르기 외국인 매도 확대 속 환율'
  const tagged = plain.replace(/\S+/g, (w) => `<strong>${w}</strong>`)
  // 태그째 재면 넘치지만(관문이 의미 있는 입력인지 확인) 평문은 들어간다
  assert.equal(cardTextFits('market', { headline: tagged, line: LINE }).ok, false)
  assert.deepEqual(validateMarketCardText({ cover: cover(tagged), cardLine: cardLine(LINE) }), [])
})

test('카드 관문: 필드가 빠져도 던지지 않는다', () => {
  assert.doesNotThrow(() => validateMarketCardText({} as never))
  assert.ok(validateMarketCardText({ cover: cover(FITTING_HEADLINE) } as never).length > 0) // 한 줄 없음
})

// ── generateReport 루프 ────────────────────────────────────────────────

const DATA = {
  collectedAt: '2026-10-16T07:00:00+09:00', date: '2026-10-16', dayOfWeek: '금',
  koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
} as never

function reportJson(headline: string): string {
  return JSON.stringify({
    cover: cover(headline),
    summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸습니다.', today: '개장 30분 거래대금이 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서.' },
    cardLine: cardLine(LINE),
    bigStory: { content: [{ type: 'paragraph', text: '본문입니다.' }] },
    watchPoints: [], soWhat: [], calendar: [], closingMessage: '마무리',
  })
}

/**
 * 호출 순서대로 응답 본문을 돌려주는 가짜 Messages.stream. advanceMs 만큼 가짜 시계를 앞으로 돌린다.
 * generateReport 의 진행 로그는 logs 로 모아 출력을 깨끗하게 둔다(오류 로그도 같이).
 */
function fakeStream(replies: Array<string | Error>, advanceMs = 0) {
  let clock = 1_000_000
  let calls = 0
  const logs: string[] = []
  const collect = (...args: unknown[]) => { logs.push(args.join(' ')) }
  mock.method(console, 'log', collect)
  mock.method(console, 'error', collect)
  mock.method(Date, 'now', () => clock)
  const stream = mock.method(Anthropic.Messages.prototype, 'stream', () => {
    const reply = replies[Math.min(calls++, replies.length - 1)]
    clock += advanceMs
    if (reply instanceof Error) throw reply // API 오류(529가 아닌 — 529는 실제 대기가 걸린다)
    return { finalMessage: async () => ({ content: [{ type: 'text', text: reply }] }) } as never
  })
  return { stream, logs }
}

test('generateReport: 첫 시도의 제목이 카드에 안 들어가면 다시 쓰게 하고, 맞는 결과를 쓴다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), reportJson(FITTING_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*카드 headline/.test(l)))
})

test('generateReport: 마지막 시도까지 안 맞아도 경고만 남기고 발송한다(막지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.match(html, /class="cover-headline"/)
  assert.ok(logs.some((l) => /정합성 위반 잔존\(발송 진행\).*카드 headline/.test(l)))
})

test('generateReport: 재생성이 JSON 파싱 실패로 이어져도 카드 글자만 어긋난 앞선 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), '깨진 응답', '깨진 응답'])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.ok(logs.some((l) => /앞선 결과로 발송 진행/.test(l) && /카드 headline/.test(l)), '남은 카드 위반을 로그에 밝힌다')
})

test('generateReport: 생성 예산이 모자라 재생성을 못 해도 카드 글자만 어긋난 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE)], 12 * 60_000) // 한 번에 12분 → 두 번째 호출은 14분 예산을 넘는다
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.ok(logs.some((l) => /앞선 결과로 발송 진행/.test(l) && /카드 headline/.test(l)), '남은 카드 위반을 로그에 밝힌다')
})

const OTHER_HEADLINE = '코스피 낙폭 만회, 외국인 매도는 이어져'
const missingSummary = (headline: string) =>
  JSON.stringify({ ...JSON.parse(reportJson(headline)), summary: { yesterday: '', today: '', myAssets: '' } })

test('generateReport: 마지막 시도에 다른 위반이 남으면 카드 글자만 어긋난 앞선 결과가 더 깨끗하므로 그쪽으로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  // 1회: 카드 글자만 위반 → 2·3회: 요약 누락(카드 외 위반)
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), missingSummary(OTHER_HEADLINE), missingSummary(OTHER_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.equal(content.summary.yesterday, '국내 증시는 수급 부담에 크게 밀렸습니다.') // 기본 문장이 아니라 앞선 결과의 요약
  const line = logs.find((l) => /마지막 시도에 정합성 위반 잔존/.test(l))
  assert.ok(line && /summary\.yesterday/.test(line) && /카드 headline/.test(line), '남은 두 종류의 위반을 모두 밝힌다')
})

test('generateReport: 앞선 결과가 없으면(카드 외 위반만 반복) 기존대로 마지막 시도 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream } = fakeStream([missingSummary(LONG_HEADLINE), missingSummary(LONG_HEADLINE), missingSummary(OTHER_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
})

// ── I2 (Ruling 23, F02 전송 > 침묵): 마지막 호출을 못 하거나 실패·파싱 실패해도 파싱된 앞선 결과가 있으면 보낸다 ──
// 앞선 결과 선택: 카드 글자만 어긋난 결과 > 카드 외 위반이 가장 적은 결과 > 가장 최근 결과.
const yesterdayOnlyMissing = (headline: string) =>
  JSON.stringify({ ...JSON.parse(reportJson(headline)), summary: { yesterday: '', today: '개장 30분 거래대금이 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서.' } })

test('generateReport: 카드 외 위반만 있던 결과도 예산이 끝나 재생성을 못 하면 경고와 함께 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([missingSummary(FITTING_HEADLINE)], 12 * 60_000)
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.match(html, /class="cover-headline"/)
  assert.equal(content.summary.yesterday, '부제') // 빈 칸은 기존 기본값 보정(부제)으로 채운다
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /생성 예산/.test(line) && /summary\.yesterday/.test(line), '멈춘 이유와 남은 위반을 로그에 밝힌다')
})

test('generateReport: 마지막 시도가 JSON 파싱에 실패하면 카드 외 위반이 가장 적은 앞선 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  // 1회: 요약 3칸 누락 → 2회: 어제 줄만 누락(위반 1건) → 3회: 깨진 응답
  const { stream, logs } = fakeStream([missingSummary(LONG_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE), '깨진 응답'])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.equal(content.summary.today, '개장 30분 거래대금이 첫 확인점입니다.')
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /2회차/.test(line) && /summary\.yesterday/.test(line), line)
})

test('generateReport: 위반 수가 같으면 더 최근 결과를 고른다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeStream([missingSummary(LONG_HEADLINE), missingSummary(OTHER_HEADLINE), '깨진 응답'])
  const { content } = await generateReport(DATA)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
})

test('generateReport: 마지막 시도가 API 오류여도 파싱된 앞선 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([missingSummary(LONG_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE), new Error('Internal server error')])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /Internal server error/.test(line) && /summary\.yesterday/.test(line), line)
})

test('generateReport: 파싱된 결과가 한 번도 없으면 기존대로 실패한다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeStream(['깨진 응답'])
  await assert.rejects(generateReport(DATA), /JSON 파싱 실패/)
})

test('generateReport: 첫 호출부터 API 오류면(파싱된 결과 없음) 기존대로 실패한다', async (t) => {
  t.after(() => mock.restoreAll())
  fakeStream([new Error('Internal server error')])
  await assert.rejects(generateReport(DATA), /Internal server error/)
})

// ── Ruling 28: 형식이 깨진 응답의 검증 중 예외는 파싱 실패처럼 — 함수 밖으로 새지 않고 다음 시도·앞선 결과로 ──
test('generateReport: 1회차 검증 중 예외가 나도 다음 시도로 넘어가 2회차 정상 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const replies = [reportJson(LONG_HEADLINE), reportJson(FITTING_HEADLINE)]
  const { stream, logs } = fakeStream(replies)
  // 검증 단계(파싱 직후 정합성 검사의 JSON.stringify(parsed))에서 첫 번째로만 예외를 낸다.
  // 프롬프트 조립의 JSON.stringify(data, null, 2)는 인자가 3개라 건드리지 않는다.
  const original = JSON.stringify
  let thrown = false
  mock.method(JSON, 'stringify', (...args: Parameters<typeof JSON.stringify>) => {
    if (!thrown && args.length === 1 && typeof args[0] === 'object' && args[0] !== null && 'cardLine' in args[0]) {
      thrown = true
      throw new TypeError('형식이 깨진 응답')
    }
    return original(...args)
  })
  const { content } = await generateReport(DATA)
  assert.ok(thrown, '검증 중 예외가 실제로 났다')
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.ok(logs.some((l) => /응답 검증 중 오류[\s\S]*형식이 깨진 응답/.test(l)))
})

test('generateReport: 응답 최상위가 객체가 아니면(문자열·배열·null) 파싱 실패처럼 — 다음 시도로 넘어간다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream(['"문자열 하나"', '[1, 2]', reportJson(FITTING_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.ok(logs.some((l) => /JSON 파싱 실패 \(시도 1\/3\)/.test(l)))
})

test('generateReport: 객체가 아닌 응답은 앞선 결과로 남기지 않는다 — 뒤 호출이 실패하면 TypeError가 아니라 원래 오류로 실패', async (t) => {
  t.after(() => mock.restoreAll())
  fakeStream(['null', new Error('Internal server error')])
  await assert.rejects(generateReport(DATA), (e: Error) => /Internal server error/.test(e.message) && !(e instanceof TypeError))
})
