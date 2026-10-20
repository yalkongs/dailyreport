import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyReturnsFromCloses } from './market-data'
import { validateMarketSummary, fillMarketSummaryDefaults, buildReportPrompt } from './claude-client'
import { summarySentence } from './market-summary'

test('코스피 일봉 → 일간 등락(휴장일 없음, 최근 n개)', () => {
  const q = [
    { date: new Date('2026-10-08T00:00:00Z'), close: 6625.5 },
    { date: new Date('2026-10-12T00:00:00Z'), close: 6384.24 },
    { date: new Date('2026-10-13T00:00:00Z'), close: null },
    { date: new Date('2026-10-14T00:00:00Z'), close: 6008.5 },
  ]
  const r = dailyReturnsFromCloses(q, 20)
  // Ruling 42: 10/13 종가 결측은 빈칸 — 10/14 등락을 10/12 대비(두 거래일치)로 계산하지 않는다.
  assert.deepEqual(r.map(x => x.date), ['2026-10-12'])
  assert.ok(Math.abs(r[0].pct - (6384.24 / 6625.5 - 1) * 100) < 1e-9)
})

// Ruling 42 (2026-10-20): 종가가 없는 일봉은 빈칸이다 — 그 날과 그 다음 날의 등락을 만들지 않는다(이틀치를 하루치로 보이지 않게).
// 휴장일(일봉 자체가 없음)은 그대로 이어서 계산한다.
test('코스피 일봉: 종가 결측 일봉 다음 날은 등락을 만들지 않는다(10/16=100, 10/19=결측, 10/20=110)', () => {
  const day = (d: string, close: number | null | undefined) => ({ date: new Date(`${d}T00:00:00Z`), close })
  const r = dailyReturnsFromCloses([day('2026-10-15', 95), day('2026-10-16', 100), day('2026-10-19', null), day('2026-10-20', 110), day('2026-10-21', 121)], 20)
  assert.deepEqual(r.map(x => x.date), ['2026-10-16', '2026-10-21'])
  assert.ok(Math.abs(r[1].pct - 10) < 1e-9)
  assert.ok(!r.some(x => x.date === '2026-10-20'), '10/20 +10%(두 거래일치)를 하루 등락으로 보이지 않는다')
  // NaN·0·음수·undefined 종가도 같은 빈칸
  for (const bad of [Number.NaN, 0, -1, undefined]) {
    assert.deepEqual(dailyReturnsFromCloses([day('2026-10-16', 100), day('2026-10-19', bad), day('2026-10-20', 110)], 20), [], String(bad))
  }
})

test('코스피 일봉: 휴장일(일봉 없음)은 그대로 이어서 계산한다 — 10/09 한글날 건너 10/08 → 10/12', () => {
  const day = (d: string, close: number) => ({ date: new Date(`${d}T00:00:00Z`), close })
  const r = dailyReturnsFromCloses([day('2026-10-07', 100), day('2026-10-08', 102), day('2026-10-12', 99.96)], 20)
  assert.deepEqual(r.map(x => x.date), ['2026-10-08', '2026-10-12'])
  assert.ok(Math.abs(r[1].pct - (99.96 / 102 - 1) * 100) < 1e-9)
})

test('코스피 일봉: 같은 거래일에 결측 일봉과 종가가 함께 오면 종가를 쓴다(순서 무관)', () => {
  const at = (iso: string, close: number | null) => ({ date: new Date(iso), close })
  for (const sameDay of [
    [at('2026-10-06T00:00:00Z', null), at('2026-10-06T06:30:00Z', 110)],
    [at('2026-10-06T00:00:00Z', 110), at('2026-10-06T06:30:00Z', null)],
  ]) {
    const r = dailyReturnsFromCloses([at('2026-10-05T00:00:00Z', 100), ...sameDay], 20)
    assert.equal(r.length, 1)
    assert.ok(Math.abs(r[0].pct - 10) < 1e-9)
  }
})

const OK = {
  cover: { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', subline: 's' },
  summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸고 미 증시는 숨을 골랐습니다.', today: '개장 30분 거래대금이 돌아오는지가 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서 볼 수 있습니다.' },
  cardLine: { kind: 'cause' as const, text: '해외 충격보다 국내 수급 부담이 더 컸습니다' },
}

test('요약·카드 한 줄 검증: 정상 통과', () => assert.deepEqual(validateMarketSummary(OK), []))

test('요약·카드 한 줄 검증: 누락·길이·질문형·숫자 나열', () => {
  assert.ok(validateMarketSummary({ ...OK, summary: { ...OK.summary, today: '' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '왜? 국내 수급' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '가'.repeat(41) } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, summary: { ...OK.summary, yesterday: '코스피 −7.57%, S&P500 +0.33%, 나스닥 +0.08%' } }).length > 0)
})

test('요약 문장: 어제+오늘, 90자 이내', () => {
  const s = summarySentence(OK.summary)
  assert.ok(s.length <= 90); assert.match(s, /^국내 증시는/)
})

// ── 일봉 → 일간 등락: 경계 ──────────────────────────────────────────────

test('코스피 일봉: 최근 n개만, n<=0 이면 빈 배열, 입력 순서·같은 거래일 중복은 정리', () => {
  const day = (d: string, close: number) => ({ date: new Date(`${d}T00:00:00Z`), close })
  const q = [day('2026-10-05', 100), day('2026-10-06', 110), day('2026-10-07', 99), day('2026-10-08', 99), day('2026-10-14', 108.9)]
  assert.deepEqual(dailyReturnsFromCloses(q, 2).map(x => x.date), ['2026-10-08', '2026-10-14'])
  assert.deepEqual(dailyReturnsFromCloses(q, 0), [])
  // 뒤섞인 입력도 날짜순으로 이어 붙인다
  const shuffled = [q[3], q[0], q[4], q[2], q[1]]
  assert.deepEqual(dailyReturnsFromCloses(shuffled, 20), dailyReturnsFromCloses(q, 20))
  // 같은 거래일(KST)에 두 번 오면 나중 값만 — 장중 값과 종가가 함께 올 때
  const dup = [day('2026-10-05', 100), { date: new Date('2026-10-06T00:00:00Z'), close: 105 }, { date: new Date('2026-10-06T06:30:00Z'), close: 110 }]
  const r = dailyReturnsFromCloses(dup, 20)
  assert.equal(r.length, 1)
  assert.ok(Math.abs(r[0].pct - 10) < 1e-9)
})

// ── 검증: 경계·견고성 ───────────────────────────────────────────────────

test('검증: summary·cardLine 통째로 빠져도 던지지 않고 위반으로 돌려준다', () => {
  const v = validateMarketSummary({ cover: OK.cover } as unknown as Parameters<typeof validateMarketSummary>[0])
  assert.ok(v.some(x => x.includes('summary.yesterday')))
  assert.ok(v.some(x => x.includes('summary.today')))
  assert.ok(v.some(x => x.includes('summary.myAssets')))
  assert.ok(v.some(x => x.includes('cardLine.text')))
})

test('검증: 태그는 길이에서 제외, % 한 개·오늘 줄 숫자는 허용, 물음표·라벨·잘못된 kind 는 위반', () => {
  const tagged = '<strong>' + '가'.repeat(60) + '</strong>'
  assert.deepEqual(validateMarketSummary({ ...OK, summary: { ...OK.summary, yesterday: tagged } }), [])
  assert.deepEqual(validateMarketSummary({ ...OK, summary: { ...OK.summary, yesterday: '코스피는 7.5% 밀렸지만 미 증시는 숨을 골랐습니다.' } }), [])
  assert.deepEqual(validateMarketSummary({ ...OK, summary: { ...OK.summary, today: '개장 30분 거래대금이 어제의 80%를 넘는지, 외국인이 40% 이상 사는지 봅니다.' } }).filter(x => x.includes('등락률')), [])
  assert.ok(validateMarketSummary({ ...OK, summary: { ...OK.summary, today: '가'.repeat(61) } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '국내 수급 부담이 더 컸을까요?' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '원인: 국내 수급 부담' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'x' as unknown as 'cause', text: OK.cardLine.text } }).length > 0)
  assert.deepEqual(validateMarketSummary({ ...OK, cardLine: { kind: 'watch', text: '가'.repeat(40) } }), []) // Ruling 32: 상한 40자
})

test('검증: 시각으로 시작하는 watch 한 줄은 라벨로 오인하지 않는다', () => {
  for (const text of ['10:30 수출 통계가 첫 확인점입니다', '09:00 개장 직후 거래대금을 봅니다', '9:30 환율 흐름이 첫 확인점입니다']) {
    assert.deepEqual(validateMarketSummary({ ...OK, cardLine: { kind: 'watch', text } }), [], text)
  }
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'watch', text: '확인점: 환율' } }).length > 0)
})

// ── 요약 문장 ──────────────────────────────────────────────────────────

test('요약 문장: 90자 초과면 문장 경계에서 자르고, 소수점은 문장 끝으로 보지 않는다', () => {
  const y = '국내 증시는 외국인 매도와 수급 부담에 크게 밀렸고 미 증시는 숨을 골랐습니다.'
  const t = '개장 30분 거래대금이 어제 같은 시각 대비 6.5배 이상 붙는지가 오늘의 첫 확인점입니다. 그다음은 환율입니다.'
  const s = summarySentence({ yesterday: y, today: t, myAssets: 'm' })
  assert.ok(s.length <= 90)
  assert.ok(s.endsWith('.') || s.endsWith('다'), s)
  assert.ok(s.startsWith(y))
  assert.ok(!/6\.$/.test(s), '소수점에서 잘리면 안 된다')
})

test('요약 문장: 경계가 없으면 말줄임표로 90자 이내, 태그는 벗긴다', () => {
  const long = '가'.repeat(120)
  const s = summarySentence({ yesterday: long, today: '', myAssets: '' })
  assert.ok(s.length <= 90 && s.endsWith('…'))
  assert.equal(summarySentence({ yesterday: '<strong>미 증시</strong>는 쉬었습니다.', today: '오늘은 환율입니다.', myAssets: '' }), '미 증시는 쉬었습니다. 오늘은 환율입니다.')
})

// ── 기본값 채우기 ──────────────────────────────────────────────────────

type Content = Parameters<typeof fillMarketSummaryDefaults>[0]
const baseContent = (over: Record<string, unknown> = {}): Content => ({
  cover: { headline: 'h', subline: '미 증시는 숨을 골랐고 국내 증시는 수급 부담에 밀렸습니다. 두 번째 문장입니다.' },
  summary: OK.summary, cardLine: OK.cardLine,
  bigStory: { content: [] }, watchPoints: [], soWhat: [], calendar: [], closingMessage: 'c',
  ...over,
}) as Content

test('기본값: 누락된 요약·카드는 subline·고정 안내로 채워 비지 않는다', () => {
  const c = fillMarketSummaryDefaults(baseContent({ summary: undefined, cardLine: undefined }))
  assert.equal(c.summary.yesterday, '미 증시는 숨을 골랐고 국내 증시는 수급 부담에 밀렸습니다. 두 번째 문장입니다.')
  assert.ok(c.summary.today.length > 0 && c.summary.myAssets.includes('ETF Today'))
  assert.equal(c.cardLine.kind, 'watch')
  assert.ok(c.cardLine.text.length > 0 && c.cardLine.text.length <= 40)
  assert.deepEqual(validateMarketSummary(c), [])
})

test('기본값: 있는 값은 유지(태그만 정리), 잘못된 kind 는 watch, 두 번 불러도 같다', () => {
  const c = fillMarketSummaryDefaults(baseContent({
    summary: { ...OK.summary, today: '<strong>개장 30분</strong> 거래대금을 봅니다.' },
    cardLine: { kind: 'bogus', text: OK.cardLine.text },
  }))
  assert.equal(c.summary.yesterday, OK.summary.yesterday)
  assert.equal(c.summary.today, '개장 30분 거래대금을 봅니다.')
  assert.equal(c.cardLine.kind, 'watch')
  assert.equal(c.cardLine.text, OK.cardLine.text)
  const once = JSON.stringify(c)
  assert.equal(JSON.stringify(fillMarketSummaryDefaults(c)), once)
  // 정상 cause 는 그대로
  assert.equal(fillMarketSummaryDefaults(baseContent()).cardLine.kind, 'cause')
})

// ── 프롬프트 ───────────────────────────────────────────────────────────

test('프롬프트: summary·cardLine 스키마와 규칙이 있고 compass 는 생성하지 않는다(모드 가이드 포함)', () => {
  const data = {
    collectedAt: '2026-10-19T06:40:00+09:00', date: '2026-10-19', dayOfWeek: '월',
    koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
  }
  const ctx = {
    angle: { id: 'a', name: '구조적 렌즈', description: '', promptGuide: 'g' },
    recentLog: [], sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null,
  }
  for (const mode of ['event', 'normal', 'quiet'] as const) {
    const prompt = buildReportPrompt(data as never, { ...ctx, marketMode: { mode, reason: 'r', metrics: {} } } as never, null)
    assert.match(prompt, /"summary": \{/)
    assert.match(prompt, /"yesterday": string/)
    assert.match(prompt, /"myAssets": string/)
    assert.match(prompt, /"cardLine": \{/)
    assert.match(prompt, /"kind": "cause" \| "watch"/)
    assert.doesNotMatch(prompt, /compass/)
    assert.doesNotMatch(prompt, /자산군별 온도계|iM 투자 나침반/)
    assert.doesNotMatch(prompt, /12개 이상|12블록|5~6개/)
    assert.match(prompt, /60자 이내/)
    assert.match(prompt, /40자 이내/)
    assert.doesNotMatch(prompt, /32자 이내/)
    assert.match(prompt, /장 마감 후 → 다음 거래일 반영/)
  }
})
