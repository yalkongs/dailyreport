// 카드 글자 맞춤 관문(validateMarketCardText)과 generateReport 재시도 루프의 연결.
// 1~2번째 시도: 카드 글자 위반은 재생성 사유. 마지막 시도: 경고만 남기고 발송. 어떤 경우에도 이 관문 때문에 발송이 막히지 않는다.
// 네트워크 없이 SDK 의 Messages.stream 만 가짜로 바꿔 끼운다.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { cardTextFits } from './preview/data-card'
import { renderReport } from './report-renderer'
import { generateReport, validateMarketCardText, validateMarketRequired, normalizeMarketOptionalParts, validateMarketComparativeClaims, validateMarketAdvice, validateMarketSoftAdvice, marketAdviceText, buildReportPrompt } from './claude-client'

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

// ── Ruling 29: 필수 항목(cover.headline·bigStory.content)은 기준 위반, 선택 항목은 비어도 렌더가 돈다 ──
// 필수 항목이 빠진 결과는 렌더러가 던지므로 발송 후보가 될 수 없다 — 다시 쓰게 하고, 앞선 결과 선택에서도 밀린다.
// 없는 항목만 지워 만든 응답(나머지는 정상)으로 "그 항목 하나 때문에" 갈리는지 본다.
const without = (headline: string, ...keys: string[]) => {
  const o = JSON.parse(reportJson(headline)) as Record<string, unknown>
  for (const k of keys) delete o[k]
  return JSON.stringify(o)
}

test('필수 항목 관문: 정상은 통과, cover·headline·bigStory.content 가 없거나 비면 위반으로 돌려준다(던지지 않는다)', () => {
  const ok = JSON.parse(reportJson(FITTING_HEADLINE))
  assert.deepEqual(validateMarketRequired(ok), [])
  assert.deepEqual(validateMarketRequired({ ...ok, cover: { headline: FITTING_HEADLINE } }), []) // 부제는 선택

  for (const cover of [undefined, null, '문자열', ['배열']]) {
    const v = validateMarketRequired({ ...ok, cover })
    assert.equal(v.length, 1, JSON.stringify(cover))
    assert.match(v[0], /^cover /)
  }
  for (const headline of [undefined, '', '   ', '<strong></strong>', 42]) {
    const v = validateMarketRequired({ ...ok, cover: { headline, subline: '부제' } })
    assert.deepEqual(v, ['cover.headline 누락'], String(headline))
  }
  for (const bigStory of [undefined, null, '문자열', {}, { content: null }, { content: '본문' }, { content: {} }, { content: [] }]) {
    assert.deepEqual(validateMarketRequired({ ...ok, bigStory }), ['bigStory.content 누락'], JSON.stringify(bigStory))
  }
  assert.deepEqual(validateMarketRequired({}), ['cover 누락', 'bigStory.content 누락'])
  assert.doesNotThrow(() => validateMarketRequired(null))
  assert.doesNotThrow(() => validateMarketRequired(undefined))
})

test('선택 항목 보정: 없거나 배열이 아니면 빈 값으로 채우고, 있는 값은 건드리지 않는다', () => {
  const c = JSON.parse(reportJson(FITTING_HEADLINE))
  delete c.watchPoints; delete c.cover.subline
  c.soWhat = '배열 아님'; c.calendar = null; c.closingMessage = 42
  const out = normalizeMarketOptionalParts(c)
  assert.equal(out, c, '같은 객체를 고쳐 돌려준다')
  assert.deepEqual([c.watchPoints, c.soWhat, c.calendar, c.compass], [[], [], [], []])
  assert.equal(c.closingMessage, '')
  assert.equal(c.cover.subline, '')

  const kept = JSON.parse(reportJson(FITTING_HEADLINE))
  kept.watchPoints = [{ badge: '오전', title: 't', description: 'd' }]
  kept.compass = [{ label: 'l', title: 't', items: [] }]
  normalizeMarketOptionalParts(kept)
  assert.equal(kept.watchPoints.length, 1)
  assert.equal(kept.compass.length, 1)
  assert.equal(kept.closingMessage, '마무리')
  assert.equal(kept.cover.subline, '부제')
})

test('generateReport: 1회차에 bigStory 가 없으면 다시 쓰게 하고, 갖춘 2회차 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([without(OTHER_HEADLINE, 'bigStory'), reportJson(FITTING_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.match(html, /data-section="story"/)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*bigStory\.content 누락/.test(l)))
})

test('generateReport: 1회차에 cover 가 없어도 같다 — 2회차 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([without(OTHER_HEADLINE, 'cover'), reportJson(FITTING_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*cover 누락/.test(l)))
})

test('generateReport: 1회차는 갖췄지만 카드 글자 위반, 2·3회차는 cover 가 없으면 1회차 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), without(OTHER_HEADLINE, 'cover'), without(OTHER_HEADLINE, 'cover')])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.match(html, /class="cover-headline"/)
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /1회차/.test(line) && /카드 headline/.test(line), '앞선 결과로 보낸다는 것과 남은 위반을 밝힌다')
})

test('generateReport: 필수 항목이 빠진 결과는 위반 수가 같아도 앞선 결과 선택에서 밀린다(마지막 시도가 깨져도)', async (t) => {
  t.after(() => mock.restoreAll())
  // 1회: 어제 줄만 누락(위반 1건, 필수 항목은 갖춤) → 2회: bigStory 만 누락(위반 1건) → 3회: 깨진 응답
  const { stream } = fakeStream([yesterdayOnlyMissing(LONG_HEADLINE), without(OTHER_HEADLINE, 'bigStory'), '깨진 응답'])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.match(html, /data-section="story"/)
})

test('generateReport: 마지막 시도에 필수 항목이 빠지면 갖춘 앞선 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([without(OTHER_HEADLINE, 'bigStory'), yesterdayOnlyMissing(LONG_HEADLINE), without(OTHER_HEADLINE, 'bigStory')])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.match(html, /data-section="story"/)
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /2회차/.test(line) && /필수 항목 누락/.test(line), line)
})

test('generateReport: watchPoints·soWhat·calendar·closingMessage·부제가 없어도 던지지 않고 렌더한다', async (t) => {
  t.after(() => mock.restoreAll())
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  delete o.watchPoints; delete o.soWhat; delete o.calendar; delete o.closingMessage
  o.cover = { headline: FITTING_HEADLINE }
  const { stream } = fakeStream([JSON.stringify(o)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1, '선택 항목 누락은 재생성 사유가 아니다')
  assert.deepEqual([content.watchPoints, content.soWhat, content.calendar, content.compass], [[], [], [], []])
  assert.equal(content.closingMessage, '')
  assert.equal(content.cover.subline, '')
  assert.match(html, /class="cover-headline"/)
  assert.match(html, /data-section="story"/)
  assert.doesNotMatch(html, /data-section="today"|data-section="meaning"/, '빈 섹션은 그리지 않는다')
  assert.match(html, /data-section="footer"/)
})

test('generateReport: 모든 시도에서 bigStory 가 없으면 원인을 밝히며 실패한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream } = fakeStream([without(FITTING_HEADLINE, 'bigStory')])
  await assert.rejects(generateReport(DATA), (e: Error) => /필수 항목 누락/.test(e.message) && /bigStory\.content/.test(e.message) && !(e instanceof TypeError))
  assert.equal(stream.mock.callCount(), 3)
})

test('generateReport: 필수 항목이 빠진 응답만 있고 뒤 호출이 실패하면 원래 오류로 실패한다(발송 후보 아님)', async (t) => {
  t.after(() => mock.restoreAll())
  fakeStream([without(FITTING_HEADLINE, 'cover'), new Error('Internal server error')])
  await assert.rejects(generateReport(DATA), (e: Error) => /Internal server error/.test(e.message) && !(e instanceof TypeError))
})

// ── Ruling 38: 렌더할 수 없는 결과는 발송 후보가 아니다 — 필수 항목은 '렌더할 수 있는 블록 하나 이상', 선택 항목은 깨진 원소를 걸러 내고,
// 고른 결과의 렌더가 던지면 다음 후보로 넘어간다 ──────────────────────────────────────────────
const withBlocks = (headline: string, blocks: unknown[]) =>
  JSON.stringify({ ...JSON.parse(reportJson(headline)), bigStory: { content: blocks } })

test('필수 항목 관문: bigStory.content 에 렌더할 수 있는 블록이 하나도 없으면 누락', () => {
  const ok = JSON.parse(reportJson(FITTING_HEADLINE))
  for (const blocks of [[null], [3], ['문자열'], [{}], [[]], [{ type: 1, text: '본문' }], [{ type: 'paragraph' }], [{ type: 'paragraph', text: '' }],
    [{ type: 'paragraph', text: '<strong></strong>' }], [{ type: 'paragraph', text: 42 }], [{ type: 'heading', text: '본문' }],
    [{ type: 'dataCard', title: '표', rows: '행' }], [{ type: 'dataCard', title: '표', rows: [{ label: 'a', value: 1 }] }], [{ type: 'dataCard', title: 5, rows: [{ label: 'a', value: 'b' }] }]]) {
    assert.deepEqual(validateMarketRequired({ ...ok, bigStory: { content: blocks } }), ['bigStory.content 누락'], JSON.stringify(blocks))
  }
  for (const blocks of [[null, { type: 'paragraph', text: '본문' }], [{ type: 'pullQuote', text: '인용' }], [{ type: 'dataCard', title: '표', rows: [null, { label: 'a', value: 'b' }] }], [{ type: 'dataCard', rows: [{ label: 'a', value: 'b' }] }]]) {
    assert.deepEqual(validateMarketRequired({ ...ok, bigStory: { content: blocks } }), [], JSON.stringify(blocks))
  }
})

test('선택 항목 보정: 배열 안의 깨진 원소는 걸러 내고, 렌더러가 읽는 칸은 문자열·범위 안 숫자로 맞춘다', () => {
  const c = JSON.parse(reportJson(FITTING_HEADLINE))
  c.bigStory.content = [null, 3, '문자열', {}, { type: 'heading', text: 'x' }, { type: 'paragraph', text: '본문' }, { type: 'dataCard', title: 5, rows: [{ label: 'a', value: 'b' }] },
    { type: 'dataCard', title: null, rows: [null, { label: 'a', value: 1 }, { label: 'a', value: 'b' }] }]
  c.watchPoints = [null, '문자열', { badge: 1, title: '개장', description: null }, {}, { badge: '10:00', title: 7, description: '설명' }]
  c.soWhat = [null, { title: '확인되면', body: 3 }, { title: 5 }]
  c.calendar = [null, { date: 1, country: null, event: 'CPI', importance: -3 }, { event: '' }, { date: '10/22', country: '미국', event: 'FOMC', importance: 'x' }, { date: '10/23', country: '한국', event: '금통위', importance: 9 }]
  c.compass = [null, { title: 'c', items: 5 }, { title: 'd', items: [null, { gaugeType: 'strong' }] }]
  c.cover.imageKeywords = ['은유', 3]
  normalizeMarketOptionalParts(c)
  assert.deepEqual(c.bigStory.content, [{ type: 'paragraph', text: '본문' }, { type: 'dataCard', title: '', rows: [{ label: 'a', value: 'b' }] }])
  assert.deepEqual(c.watchPoints, [{ badge: '', title: '개장', description: '' }, { badge: '10:00', title: '', description: '설명' }])
  assert.deepEqual(c.soWhat, [{ title: '확인되면', body: '' }])
  assert.deepEqual(c.calendar, [
    { date: '', country: '', event: 'CPI', importance: 0 },
    { date: '10/22', country: '미국', event: 'FOMC', importance: 0 },
    { date: '10/23', country: '한국', event: '금통위', importance: 5 },
  ])
  assert.deepEqual(c.compass, [{ title: 'c', items: [] }, { title: 'd', items: [{ gaugeType: 'strong' }] }])
  assert.deepEqual(c.cover.imageKeywords, ['은유'])
  // 보정한 결과는 렌더가 던지지 않는다
  assert.doesNotThrow(() => renderReport(c, DATA, []))
})

test('generateReport: 1회차(카드 글자만 위반)의 bigStory.content 가 [null]이면 후보가 아니다 — 렌더할 수 있는 뒤 결과로 발송(던지지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  // 예전에는 [null]이 필수 항목을 통과해 1회차가 앞선 결과로 뽑혔고, 루프 밖 렌더에서 "Cannot read properties of null (reading 'type')"로 죽었다(Codex 재현).
  const { stream, logs } = fakeStream([withBlocks(LONG_HEADLINE, [null]), yesterdayOnlyMissing(OTHER_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.match(html, /<p>본문입니다\.<\/p>/)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*bigStory\.content 누락/.test(l)))
})

test('generateReport: 선택 항목 배열의 깨진 원소는 재생성 사유가 아니고, 걸러 낸 채 던지지 않고 렌더한다', async (t) => {
  t.after(() => mock.restoreAll())
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  o.bigStory.content = [null, { type: 'paragraph', text: '본문입니다.' }, 7]
  o.watchPoints = [null, { badge: 1, title: '개장', description: null }]
  o.soWhat = ['문자열', { title: '확인되면', body: 3 }]
  o.calendar = [null, { date: '10/21', country: '미국', event: 'CPI', importance: -3 }]
  o.compass = [null, { title: 'c', items: 5 }]
  const { stream } = fakeStream([JSON.stringify(o)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.equal(content.bigStory.content.length, 1)
  assert.match(html, /<div class="watch-title">개장<\/div>/)
  assert.match(html, /<div class="sowhat-title">확인되면<\/div>/)
  assert.match(html, /<td>CPI<\/td>/)
})

test('generateReport: 고른 결과의 마무리·렌더가 던지면 다음 후보로 발송한다(모두 실패할 때만 실패)', async (t) => {
  t.after(() => mock.restoreAll())
  // 1회: 카드 글자만 위반(맨 앞 후보) → 2·3회: 요약 한 칸 누락. 1회차 결과의 마무리 단계(금지 표현 검사의 JSON.stringify)에서만 던지게 한다.
  // 검증 단계가 시도마다 한 번, 마무리 단계가 후보마다 한 번 같은 객체를 문자열로 만든다 — 1회차 객체의 두 번째 호출이 마무리 단계다.
  const replies = [reportJson(LONG_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE)]
  const { stream, logs } = fakeStream(replies)
  const original = JSON.stringify
  let longCalls = 0
  mock.method(JSON, 'stringify', (...args: Parameters<typeof JSON.stringify>) => {
    const v = args[0] as { cover?: { headline?: unknown } } | null
    if (args.length === 1 && v && typeof v === 'object' && v.cover?.headline === LONG_HEADLINE && ++longCalls === 2) throw new TypeError('렌더 직전 오류')
    return original(...args)
  })
  const { content } = await generateReport(DATA)
  assert.equal(longCalls, 2, '1회차 결과를 먼저 마무리하려 했다')
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.ok(logs.some((l) => /1회차 결과 마무리·렌더 실패[\s\S]*다음 후보로[\s\S]*렌더 직전 오류/.test(l)), logs.join('\n'))
})

test('generateReport: 후보를 모두 렌더하지 못하면 원인을 밝히며 실패한다', async (t) => {
  t.after(() => mock.restoreAll())
  const replies = [reportJson(LONG_HEADLINE)]
  fakeStream(replies)
  const original = JSON.stringify
  let calls = 0
  mock.method(JSON, 'stringify', (...args: Parameters<typeof JSON.stringify>) => {
    const v = args[0] as { cover?: { headline?: unknown } } | null
    if (args.length === 1 && v && typeof v === 'object' && v.cover?.headline === LONG_HEADLINE && ++calls > 3) throw new TypeError('렌더 직전 오류')
    return original(...args)
  })
  await assert.rejects(generateReport(DATA), (e: Error) => /Market 리포트 렌더 실패/.test(e.message) && /렌더 직전 오류/.test(e.message))
})

// ── Ruling 31: 제목·카드 한 줄의 확인할 수 없는 기간 비교·최상급 표현 ────────────────────────────
// 10/19 제목 "…한 주 만에 1년치 수익을 되돌렸다"가 본문(1년 상승분의 절반에 가까운 낙폭)보다 과장된 채 발송됐다.
// 1·2번째 시도: 기준 위반(재생성 사유). 마지막 시도: 경고만 남기고 발송(F02). 앞선 결과 선택은 일반 기준 위반과 같다.
const TODAY_HEADLINE = '코스피, 6,625에서 5,668로…한 주 만에 1년치 수익을 되돌렸다'

test('기간 비교 관문: 오늘 제목·카드 한 줄의 최상급은 걸리고, 평범한 제목은 통과한다', () => {
  const v = validateMarketComparativeClaims({ cover: cover(TODAY_HEADLINE), cardLine: cardLine(LINE) })
  assert.equal(v.length, 1)
  assert.match(v[0], /^cover\.headline 기간 비교·최상급/)
  assert.match(v[0], /1년치/)
  const line = validateMarketComparativeClaims({ cover: cover(FITTING_HEADLINE), cardLine: cardLine('코스피 사상 최고, 외국인 매수가 이끌었습니다') })
  assert.equal(line.length, 1)
  assert.match(line[0], /^cardLine\.text .*사상 최고/)
  for (const headline of ['코스피 반등, 이번 주 금통위가 시험대', '미 반도체 4% 급락, 코스피는 반대로 올랐다', '금통위가 최대 변수', FITTING_HEADLINE]) {
    assert.deepEqual(validateMarketComparativeClaims({ cover: cover(headline), cardLine: cardLine(LINE) }), [], headline)
  }
  assert.doesNotThrow(() => validateMarketComparativeClaims({} as never))
  assert.deepEqual(validateMarketComparativeClaims({ cover: '문자열', cardLine: null } as never), [])
})

test('generateReport: 1회차 제목에 기간 비교·최상급이 있으면 다시 쓰게 하고, 고친 2회차 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  assert.deepEqual(validateMarketCardText({ cover: cover(TODAY_HEADLINE), cardLine: cardLine(LINE) }), [], '전제: 카드 글자는 맞는다')
  const { stream, logs } = fakeStream([reportJson(TODAY_HEADLINE), reportJson(FITTING_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, FITTING_HEADLINE)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*cover\.headline 기간 비교·최상급.*1년치/.test(l)))
})

test('generateReport: 마지막 시도까지 기간 비교·최상급이 남아도 경고만 남기고 발송한다(F02)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(TODAY_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, TODAY_HEADLINE)
  assert.match(html, /class="cover-headline"/)
  assert.ok(logs.some((l) => /정합성 위반 잔존\(발송 진행\).*기간 비교·최상급.*1년치/.test(l)))
})

test('generateReport: 기간 비교 위반은 일반 기준 위반이다 — 카드 글자만 어긋난 앞선 결과가 마지막 시도보다 깨끗하면 그쪽으로', async (t) => {
  t.after(() => mock.restoreAll())
  // 1회: 카드 글자만 위반(기준 위반 0) → 2·3회: 기간 비교 위반(기준 위반 1)
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), reportJson(TODAY_HEADLINE), reportJson(TODAY_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.ok(logs.some((l) => /마지막 시도에 정합성 위반 잔존.*1년치.*위반이 더 적은 앞선 결과로 발송 진행\(1회차/.test(l)))
})

// ── Ruling 37: 매수·매도 권유 표현(ETF와 같은 목록, lib/compliance.ts)은 마지막 시도에도 막는다 ─────────────
// 1~2번째 시도: 재생성 사유. 권유 표현이 남은 결과는 앞선 결과 후보가 되지 않고, 마지막 시도에 남으면 발송할 수 없다(필수 항목 누락과 같다).
// 권유 표현 없는 파싱 결과가 하나도 없으면 원인을 밝히며 실패한다.
const ADVICE = 'KODEX 200을 지금 매수하세요.'
const withAdvice = (headline: string) =>
  JSON.stringify({ ...JSON.parse(reportJson(headline)), summary: { ...JSON.parse(reportJson(headline)).summary, myAssets: ADVICE } })

// Ruling 37e: Market 권유 검사는 두 단계 — HARD(validateMarketAdvice, 명령형, 마지막 시도에도 막음)·SOFT(validateMarketSoftAdvice,
// 단정·보장·'지금 사야' 꼴, 일반 기준 위반). 검사 글은 화면 글자(marketAdviceText). 부정·유보 판정은 없다.
test('권유 관문: 칸마다 HARD·SOFT를 칸 이름과 함께 찾고, 평범한 글·깨진 모양은 통과(던지지 않는다)', () => {
  const ok = JSON.parse(reportJson(FITTING_HEADLINE))
  assert.deepEqual(validateMarketAdvice(ok), [])
  assert.deepEqual(validateMarketSoftAdvice(ok), [])
  type Editable = {
    cover: { headline: string; subline: string }; summary: { yesterday: string; today: string; myAssets: string }; cardLine: { text: string }
    bigStory: { content: Array<{ type: string; text: string }> }; watchPoints: unknown; soWhat: unknown; calendar: unknown; closingMessage: string
  }
  const cases: Array<['HARD' | 'SOFT', string, (o: Editable) => void]> = [
    ['HARD', 'cover.headline', (o) => { o.cover.headline = '반도체 <strong>지금 사세요</strong>' }],
    ['HARD', 'cover.headline', (o) => { o.cover.headline = '반도체 매수<em></em>하세요' }], // 제목은 강조 태그를 벗겨 넣는다
    ['HARD', 'cover.subline', (o) => { o.cover.subline = '반도체 비중을 높이는 것이 좋습니다' }],
    ['HARD', 'summary.myAssets', (o) => { o.summary.myAssets = ADVICE }],
    ['HARD', 'bigStory.content[0].text', (o) => { o.bigStory.content[0].text = '이제 <strong>매도하십시오</strong>.' }],
    ['HARD', 'watchPoints[0].description', (o) => { o.watchPoints = [{ badge: '09:00', title: '개장', description: '반도체 ETF를 담으세요.' }] }],
    ['HARD', 'soWhat[0].body', (o) => { o.soWhat = [{ title: '확인되면', body: '확인되면 비중을 늘리세요.' }] }],
    ['HARD', 'closingMessage', (o) => { o.closingMessage = '지금은 반도체를 편입하시기 바랍니다.' }],
    ['SOFT', 'summary.yesterday', (o) => { o.summary.yesterday = '확실한 수익 구간이었습니다.' }],
    ['SOFT', 'summary.today', (o) => { o.summary.today = '개장 뒤 필수 매수 종목을 봅니다.' }],
    ['SOFT', 'cardLine.text', (o) => { o.cardLine.text = '반도체는 매수해야 할 때입니다' }],
    ['SOFT', 'bigStory.content[1].text', (o) => { o.bigStory.content.push({ type: 'pullQuote', text: '폭등 예상 구간입니다.' }) }],
    ['SOFT', 'calendar[0].event', (o) => { o.calendar = [{ date: '10/21', country: '한국', event: '강력 매수 신호', importance: 3 }] }],
  ]
  for (const [tier, path, edit] of cases) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    edit(o)
    const hard = validateMarketAdvice(o)
    const soft = validateMarketSoftAdvice(o)
    const [hit, miss, label] = tier === 'HARD' ? [hard, soft, '투자 권유성 표현'] : [soft, hard, '권유성 단정 표현']
    assert.equal(hit.length, 1, `${tier} ${path}: ${hit.join(' / ')}`)
    assert.ok(hit[0].startsWith(`${label}(${path}):`), hit[0])
    assert.deepEqual(miss, [], `${tier} ${path}`)
  }
  for (const bad of [null, undefined, '문자열', [], { cover: null, bigStory: { content: [null, 3] }, watchPoints: [null], soWhat: 'x', calendar: [null] }]) {
    assert.doesNotThrow(() => validateMarketAdvice(bad), JSON.stringify(bad))
    assert.deepEqual(validateMarketAdvice(bad), [])
    assert.deepEqual(validateMarketSoftAdvice(bad), [])
  }
})

test('권유 관문: 해설·인용 다섯 문장과 "지금 사이에는·지금 사상 최고·조사도 늦지 않다"는 어느 칸에 있어도 HARD·SOFT 모두 통과', () => {
  for (const s of [
    '현지 생산 비중 확대',
    "'환율 강세라고 무조건 미국 주식이 좋은 것은 아니다'라는 경고(뉴시스 인용)",
    'VIX 30과 지금 사이에는',
    "월가는 SK하이닉스에 '매수·비중확대'를 내걸었고",
    '신규 진입 시 가격 수준 자체를 맥락으로 삼아야',
    '2022년의 VIX 30과 지금 사이에는 거리가 있습니다.',
    '지금 사상 최고치 부근입니다.',
    '조사도 늦지 않다',
  ]) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    o.bigStory.content.push({ type: 'paragraph', text: s })
    o.soWhat = [{ title: '확인되면', body: s }]
    o.summary.today = s
    assert.deepEqual(validateMarketAdvice(o), [], s)
    assert.deepEqual(validateMarketSoftAdvice(o), [], s)
  }
  // "확실한 수익을 보장하는 상품은 없습니다."는 SOFT 패턴(확실한 수익)에 걸린다 — 부정 판정이 없으므로. 재생성 한 번이 비용(HARD 아님).
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  o.soWhat = [{ title: '확인되면', body: '확실한 수익을 보장하는 상품은 없습니다.' }]
  assert.deepEqual(validateMarketAdvice(o), [])
  assert.deepEqual(validateMarketSoftAdvice(o), ['권유성 단정 표현(soWhat[0].body): "확실한 수익"'])
})

test('marketAdviceText: 화면 글자 그대로 — 참조 한 번 풀기·<strong>만 태그·서식 문자 지우기·NBSP는 공백', () => {
  assert.equal(marketAdviceText('<매수하세요>'), '<매수하세요>') // 화면에 글자로 보인다
  assert.equal(marketAdviceText('매수&#8294;하세요'), '매수하세요') // U+2066(서식 문자)
  assert.equal(marketAdviceText('매수\u200b하세요\ufeff'), '매수하세요')
  assert.equal(marketAdviceText('매수&nbsp;하세요'), '매수 하세요')
  assert.equal(marketAdviceText('매수&lt;strong&gt;하세요'), '매수하세요') // 렌더러가 굵게로 되살린다
  assert.equal(marketAdviceText('<strong>굵게</strong> S&amp;P &lt;script&gt;'), '굵게 S&P <script>')
  assert.equal(marketAdviceText('<strong onclick="x">a</strong>'), '<strong onclick="x">a') // 속성 붙은 태그는 글자로 보인다
  assert.equal(marketAdviceText(42), '')
})

test('권유 관문 HARD: 화면에 명령형으로 보이는 글은 문자 참조·서식 문자·태그 모양과 상관없이 막는다', () => {
  for (const text of ['KODEX 200을 지금 매수하세요.', '지금 사두세요.', '반도체 비중을 줄이세요.', '매수&nbsp;하세요', '매수&#8294;하세요', '<매수하세요>',
    '매수&lt;strong&gt;하세요', '매수&#32;하세요.', '매수&#x20;하세요.', '매수&#8203;하세요.', '매수\u200b하세요.', '매수\u2066하세요', '금리 &lt; 5%면 매수하세요 &gt;']) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    o.bigStory.content[0].text = text
    const v = validateMarketAdvice(o)
    assert.equal(v.length, 1, `${JSON.stringify(text)}: ${v.join(' / ')}`)
    assert.match(v[0], /^투자 권유성 표현\(bigStory\.content\[0\]\.text\)/)
  }
})

test('권유 관문 SOFT: 단정·보장은 부정·유보가 뒤따라도 SOFT(HARD 아님)', () => {
  for (const text of ['지금 매수해야 합니다 손실 걱정은 없습니다.', '확실한 수익을 보장합니다 손실은 없습니다.', '지금이 매수 적기입니다.', '지금은 매수 적기가 아닌 상황입니다.', '지금이 매수&nbsp;적기입니다.']) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    o.soWhat = [{ title: '확인되면', body: text }]
    assert.deepEqual(validateMarketAdvice(o), [], text)
    assert.equal(validateMarketSoftAdvice(o).length, 1, text)
  }
})

// Ruling 37f ③: 검사 글은 칸마다 그 칸의 실제 렌더 경로를 따른다 — 본문(문단·인용·오늘 볼 것 설명·의미 본문)은 sanitizeInlineHtml,
// escape해 넣는 칸(오늘 볼 것 제목·의미 제목·일정·마무리·dataCard)은 글자 그대로, 제목·부제는 강조 태그를 벗긴 뒤 글자 그대로,
// 세 줄 요약·카드 한 줄은 발송 전에 plainText(태그 제거)를 거친 뒤 escape된다.
test('marketAdviceText: 칸 종류마다 렌더 경로를 따른다(inline·escaped·title·plain)', () => {
  const v = '매수<strong></strong>하세요'
  assert.equal(marketAdviceText(v), '매수하세요') // 기본 inline: <strong>은 태그라 화면에 안 보인다
  assert.equal(marketAdviceText(v, 'inline'), '매수하세요')
  assert.equal(marketAdviceText(v, 'escaped'), '매수<strong></strong>하세요') // 태그가 글자로 보인다
  assert.equal(marketAdviceText('매수<em></em>하세요', 'title'), '매수하세요') // 제목은 강조 태그를 벗긴다
  assert.equal(marketAdviceText('매수<strong></strong>하세요', 'plain'), '매수하세요') // 요약은 plainText로 태그를 지운다
  assert.equal(marketAdviceText('매수&nbsp;하세요', 'escaped'), '매수&nbsp;하세요') // 참조도 글자로 보인다
  assert.equal(marketAdviceText('매수&nbsp;하세요', 'inline'), '매수 하세요')
  assert.equal(marketAdviceText('매수\u2066하세요\u00a0끝', 'escaped'), '매수하세요 끝') // 서식 문자는 어느 칸이든 안 보인다
})

type ReportEdit = {
  cover: { headline: string; subline: string }; summary: { today: string }; cardLine: { text: string }
  bigStory: { content: Array<{ type: string; text: string }> }; watchPoints: unknown; soWhat: unknown; calendar: unknown; closingMessage: string
}

test('권유 관문: "매수<strong></strong>하세요"는 태그가 글자로 보이는 칸에선 통과, 화면에 "매수하세요"로 보이는 칸에선 HARD', () => {
  const v = '매수<strong></strong>하세요'
  const at = (edit: (o: ReportEdit) => void) => { const o = JSON.parse(reportJson(FITTING_HEADLINE)); edit(o); return validateMarketAdvice(o) }
  assert.deepEqual(at((o) => { o.closingMessage = v }), [])
  assert.deepEqual(at((o) => { o.watchPoints = [{ badge: '09:00', title: v, description: 'd' }] }), [])
  assert.deepEqual(at((o) => { o.soWhat = [{ title: v, body: 'b' }] }), [])
  assert.deepEqual(at((o) => { o.closingMessage = '매수&nbsp;하세요' }), []) // 마무리는 참조를 글자로 보인다
  assert.equal(at((o) => { o.bigStory.content[0].text = v }).length, 1)
  assert.equal(at((o) => { o.watchPoints = [{ badge: '09:00', title: '개장', description: v }] }).length, 1)
  assert.equal(at((o) => { o.summary.today = v }).length, 1) // 요약은 발송 전에 태그가 지워져 화면에 "매수하세요"
  assert.equal(at((o) => { o.cover.headline = '반도체 매수<strong></strong>하세요' }).length, 1)
  // "매수하세요"는 어느 칸에서든 HARD
  for (const edit of [
    (o: ReportEdit) => { o.closingMessage = '매수하세요' },
    (o: ReportEdit) => { o.watchPoints = [{ badge: '매수하세요', title: 't', description: 'd' }] },
    (o: ReportEdit) => { o.calendar = [{ date: '1/1', country: '한국', event: '<매수하세요>', importance: 3 }] },
    (o: ReportEdit) => { o.cardLine.text = '매수하세요' },
    (o: ReportEdit) => { o.cover.subline = '매수하세요' },
  ]) {
    assert.equal(at(edit).length, 1)
  }
})

test('권유 관문 HARD: "매수해 주세요"·"주식 비중, 줄이세요"는 막고, 인용된 경고는 통과(Ruling 37f·37g)', () => {
  for (const text of ['반도체 ETF를 매수해 주세요.', '반도체 ETF를 사 주세요.', '주식 비중, 줄이세요.', '반도체 비중을 낮추십시오', '주식 비중도 줄이세요.', '주식 비중만 줄이세요.']) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    o.bigStory.content[0].text = text
    assert.equal(validateMarketAdvice(o).length, 1, text)
  }
  // Ruling 37g: 떨어진 비중·노출 지시는 SOFT(HARD 아님)
  for (const text of ['삼성전자 비중을 지금보다 조금 더 줄이세요.', '주식 비중과 관계없이 불필요한 지출을 줄이세요.']) {
    const o = JSON.parse(reportJson(FITTING_HEADLINE))
    o.bigStory.content[0].text = text
    assert.deepEqual(validateMarketAdvice(o), [], text)
    assert.equal(validateMarketSoftAdvice(o).length, 1, text)
  }
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  o.soWhat = [{ title: '확인되면', body: "금융당국은 '지금 매수하세요'라는 광고를 경계하라고 당부했습니다." }]
  assert.deepEqual(validateMarketAdvice(o), [])
  assert.deepEqual(validateMarketSoftAdvice(o), [])
})

test('generateReport: 세 번 다 인용된 경고("\'지금 매수하세요\'라는 광고를 경계")여도 1회차로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const reply = JSON.stringify({ ...JSON.parse(reportJson(FITTING_HEADLINE)), soWhat: [{ title: '확인되면', body: "금융당국은 '지금 매수하세요'라는 광고를 경계하라고 당부했습니다." }] })
  const { stream } = fakeStream([reply])
  const { html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.match(html, /광고를 경계하라고/)
})

test('generateReport: 세 번 다 "주식 비중과 관계없이 불필요한 지출을 줄이세요."여도(SOFT) 실패하지 않고 경고와 함께 발송한다(Ruling 37g)', async (t) => {
  t.after(() => mock.restoreAll())
  const reply = JSON.stringify({ ...JSON.parse(reportJson(FITTING_HEADLINE)), soWhat: [{ title: '확인되면', body: '주식 비중과 관계없이 불필요한 지출을 줄이세요.' }] })
  const { stream, logs } = fakeStream([reply])
  const { html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.match(html, /불필요한 지출을 줄이세요/)
  assert.ok(logs.some((l) => /정합성 위반 잔존\(발송 진행\).*권유성 단정 표현\(soWhat\[0\]\.body\)/.test(l)))
})

const withSoWhat = (headline: string, body: string) =>
  JSON.stringify({ ...JSON.parse(reportJson(headline)), soWhat: [{ title: '확인되면', body }] })

test('generateReport: 1회차에 SOFT("지금이 매수 적기입니다.")가 있으면 다시 쓰게 하고, 깨끗한 2회차로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([withSoWhat(FITTING_HEADLINE, '지금이 매수 적기입니다.'), reportJson(OTHER_HEADLINE)])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*권유성 단정 표현\(soWhat\[0\]\.body\): "매수 적기"/.test(l)))
})

test('generateReport: 세 번 다 SOFT뿐이면("지금은 매수 적기가 아닌 상황입니다.") 실패하지 않고 경고와 함께 발송한다(F02)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([withSoWhat(FITTING_HEADLINE, '지금은 매수 적기가 아닌 상황입니다.')])
  const { html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.match(html, /지금은 매수 적기가 아닌 상황입니다\./)
  assert.ok(logs.some((l) => /정합성 위반 잔존\(발송 진행\).*권유성 단정 표현/.test(l)))
})

test('generateReport: SOFT가 남은 결과는 후보지만 더 깨끗한 결과에 밀린다 — 카드 글자만 어긋난 1회차가 이긴다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([reportJson(LONG_HEADLINE), withSoWhat(OTHER_HEADLINE, '확실한 수익을 보장합니다 손실은 없습니다.'), withSoWhat(OTHER_HEADLINE, '확실한 수익을 보장합니다 손실은 없습니다.')])
  const { content } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, LONG_HEADLINE)
  assert.ok(logs.some((l) => /마지막 시도에 정합성 위반 잔존.*권유성 단정 표현.*위반이 더 적은 앞선 결과로 발송 진행\(1회차/.test(l)))
})

test('권유 관문: 10만 자 본문도 선형으로 빠르게 검사한다(HARD·SOFT, 화면 글자 변환 포함)', () => {
  const chunk = '코스피는 외국인 매도에 밀렸고 <strong>지금 사이에는</strong> 변수가 많습니다&nbsp;— S&amp;P도 흔들렸습니다. '
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  o.bigStory.content[0].text = chunk.repeat(Math.ceil(100_000 / chunk.length)).slice(0, 100_000)
  const start = performance.now()
  validateMarketAdvice(o)
  validateMarketSoftAdvice(o)
  const ms = performance.now() - start
  assert.ok(ms < 200, `${ms.toFixed(1)}ms`)
})


test('generateReport: 해설·인용 문장(예전 전체 목록에 걸리던)은 재생성 사유가 아니다 — 1회차로 발송', async (t) => {
  t.after(() => mock.restoreAll())
  const o = JSON.parse(reportJson(FITTING_HEADLINE))
  o.bigStory.content.push({ type: 'paragraph', text: "월가는 SK하이닉스에 '매수·비중확대'를 내걸었고, 2022년의 VIX 30과 지금 사이에는 아직 거리가 있습니다." })
  const { stream } = fakeStream([JSON.stringify(o)])
  const { html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 1)
  assert.match(html, /매수·비중확대/)
})

test('generateReport: 1회차에 매수 권유가 있으면 다시 쓰게 하고, 권유 없는 2회차 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([withAdvice(FITTING_HEADLINE), reportJson(OTHER_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 2)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.doesNotMatch(html, /매수하세요/)
  assert.ok(logs.some((l) => /재생성 \(2\/3\).*투자 권유성 표현\(summary\.myAssets\)/.test(l)))
})

test('generateReport: 권유가 있는 결과는 앞선 결과 후보가 되지 않는다 — 1회차(긴 제목+권유) 대신 2·3회차(요약 한 칸 누락)로 발송', async (t) => {
  t.after(() => mock.restoreAll())
  // 예전에는 1회차가 카드 외 위반 0이라 앞선 결과로 뽑혀 권유 문장이 그대로 발송됐다(Codex 재현).
  const { stream, logs } = fakeStream([withAdvice(LONG_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.doesNotMatch(JSON.stringify(content), /매수하세요/)
  assert.doesNotMatch(html, /매수하세요/)
  assert.ok(!logs.some((l) => /앞선 결과로 발송 진행\(1회차/.test(l)), '1회차로 되돌아가지 않는다')
})

test('generateReport: 마지막 시도에 권유가 남으면 발송할 수 없다 — 권유 없는 앞선 결과로 발송한다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream, logs } = fakeStream([withAdvice(LONG_HEADLINE), yesterdayOnlyMissing(OTHER_HEADLINE), withAdvice(FITTING_HEADLINE)])
  const { content, html } = await generateReport(DATA)
  assert.equal(stream.mock.callCount(), 3)
  assert.equal(content.cover.headline, OTHER_HEADLINE)
  assert.doesNotMatch(html, /매수하세요/)
  assert.ok(logs.some((l) => /마지막 시도\(3\/3\)에 투자 권유성 표현/.test(l)))
  const line = logs.find((l) => /앞선 결과로 발송 진행/.test(l))
  assert.ok(line && /2회차/.test(line) && /투자 권유성 표현/.test(line), line)
})

test('generateReport: 모든 시도에 권유가 있으면 원인을 밝히며 실패한다(발송하지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream } = fakeStream([withAdvice(FITTING_HEADLINE)])
  await assert.rejects(generateReport(DATA), (e: Error) => /투자 권유성 표현/.test(e.message) && /summary\.myAssets/.test(e.message) && !(e instanceof TypeError))
  assert.equal(stream.mock.callCount(), 3)
})

test('generateReport: 권유가 있는 결과뿐인데 예산이 끝나 재생성을 못 하면 실패한다(권유 결과를 발송하지 않는다)', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream } = fakeStream([withAdvice(FITTING_HEADLINE)], 12 * 60_000)
  await assert.rejects(generateReport(DATA), (e: Error) => /투자 권유성 표현/.test(e.message) && !(e instanceof TypeError))
  assert.equal(stream.mock.callCount(), 1)
})

test('프롬프트: 시스템 프롬프트가 검사가 막는 권유형 표현을 미리 알려 준다', async (t) => {
  t.after(() => mock.restoreAll())
  const { stream } = fakeStream([reportJson(FITTING_HEADLINE)])
  await generateReport(DATA)
  const system = String((stream.mock.calls[0].arguments[0] as { system?: unknown }).system)
  assert.match(system, /독자에게 사라·팔라는 지시형\("~하세요·~하십시오", "비중을 줄이세요"\)과 "강력 매수"·"폭등 예상"·"확실한 수익"·"필수 매수"/)
  // Ruling 37a: 해설에 흔한 낱말(비중 확대·신규 진입 등)은 검사가 막지 않으므로 금지어로 적지 않는다
  assert.doesNotMatch(system, /"비중 확대"·"신규 진입"/)
})

test('프롬프트: 제목 작성 규칙에 기간 비교·최상급 금지(제목·카드 문구)가 있다', () => {
  const ctx = {
    angle: { id: 'a', name: '구조적 렌즈', description: '', promptGuide: 'g' },
    recentLog: [], sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null,
  }
  const prompt = buildReportPrompt(DATA, ctx as never, null)
  const rules = prompt.slice(prompt.indexOf('### 제목 작성 규칙'))
  assert.match(rules, /제목·카드 문구에는 'N년치·N개월치', '역대·사상 최대\/최고\/최저', 'N년 만에 최고\/최저', '연중 최고\/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않는다 — 입력 데이터로 확인되는 수치와 사실만/)
})
