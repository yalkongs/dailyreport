// lib/compliance.test.ts
// Ruling 37·37a (2026-10-20): ETF 목록(INVESTMENT_ADVICE_PATTERNS)은 그대로 두되 '지금 사'만 지시형으로 좁힌다.
// Ruling 37e: Market은 두 단계 — HARD(독자에게 사라·팔라는 명령형, 마지막 시도에도 막음)와 SOFT(단정·보장·'지금 사야' 꼴,
// 일반 기준 위반 — 마지막 시도는 경고만). 부정·유보 판정은 없다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INVESTMENT_ADVICE_PATTERNS, HARD_ADVICE_PATTERNS, SOFT_ADVICE_PATTERNS, findInvestmentAdvice, findHardAdvice, findSoftAdvice, stripQuotedSpans } from './compliance'

// Ruling 37 이전 ETF 목록(lib/etf/report-quality.ts) — '지금 사' 한 줄만 바뀌었는지 본다.
const ETF_BEFORE = [
  String.raw`강력\s*매수`, '무조건', String.raw`지금\s*사`, '매수해야', '매도해야', String.raw`매수\s*검토`, String.raw`신규\s*진입`,
  String.raw`분할\s*접근`, String.raw`비중\s*확대`, String.raw`선호\s*ETF군`, String.raw`일반적인\s*매수`,
  String.raw`확실히\s*(매수|매도|상승|하락|수익|오를|떨어질|돈)`, String.raw`확실한\s*(매수|매도|수익|투자\s*기회|종목|상승|하락)`,
  String.raw`폭등\s*예상`, String.raw`필수\s*(매수|매도|종목|전략|포지션|편입|진입)`, String.raw`(매수|매도|편입|진입|투자)\s*(가|는)?\s*필수`,
  String.raw`(?:매수|매도|처분|편입|교체)\s*하(?:세요|십시오|시기\s*바랍니다)`, String.raw`(?<![가-힣])(?:사|파|팔|담으)(?:세요|십시오)`,
  String.raw`(?:비중|노출)[^.!?\n]{0,8}(?:줄이|늘리|낮추|높이)(?:세요|십시오|시기\s*바랍니다|는\s*것이\s*좋(?:습니다|겠습니다))`,
]

test('ETF 목록: "지금 사" 한 줄만 지시형으로 좁혔고 나머지는 그대로다', () => {
  const now = INVESTMENT_ADVICE_PATTERNS.map(p => p.source)
  assert.equal(now.length, ETF_BEFORE.length)
  const changed = now.flatMap((s, i) => (s === ETF_BEFORE[i] ? [] : [i]))
  assert.deepEqual(changed, [2])
  for (const list of [INVESTMENT_ADVICE_PATTERNS, HARD_ADVICE_PATTERNS, SOFT_ADVICE_PATTERNS]) {
    assert.ok(list.every(p => !p.global), 'g 플래그 없음 — exec/test가 상태를 갖지 않는다')
  }
})

test('ETF 목록: "지금 사이·사상·사실상·사라지는"은 더 이상 걸리지 않고, 지시형 "지금 사…"는 걸린다', () => {
  for (const text of ['2022년의 VIX 30과 지금 사이에는 아직 거리가 있습니다.', '지금 사상 최고치 부근입니다.', '지금 사실상 보합입니다.', '지금 사라지는 프리미엄', '지금 사라져 버린 기대']) {
    assert.deepEqual(findInvestmentAdvice(text), [], text)
  }
  for (const [text, hit] of [['지금 사세요.', '지금 사세요'], ['지금 사야 할 때입니다.', '지금 사야'], ['지금 사라는 신호', '지금 사라'], ['지금 사두세요', '지금 사두세요'], ['지금 사둘 때입니다', '지금 사둘 때']]) {
    assert.ok(findInvestmentAdvice(text).includes(hit), `${text}: ${findInvestmentAdvice(text).join(', ')}`)
  }
  // 나머지 ETF 판정은 그대로 — 해설형 낱말도 ETF에서는 계속 걸린다
  for (const text of ['현지 생산 비중 확대', '무조건 좋은 것은 아니다', '신규 진입 시 가격 수준', '매수 검토', '분할 접근']) {
    assert.ok(findInvestmentAdvice(text).length > 0, text)
  }
})

// Market 최근 60개 리포트 중 ETF 전체 목록에 걸렸던 문장(모두 해설·인용) — Market은 어느 단계에도 걸리지 않는다.
const MARKET_FALSE_POSITIVES = [
  '현지 생산 비중 확대',
  "'환율 강세라고 무조건 미국 주식이 좋은 것은 아니다'라는 경고(뉴시스 인용)",
  'VIX 30과 지금 사이에는',
  "월가는 SK하이닉스에 '매수·비중확대'를 내걸었고",
  '신규 진입 시 가격 수준 자체를 맥락으로 삼아야',
]

const none = (text: string) => {
  assert.deepEqual(findHardAdvice(text), [], `HARD: ${text}`)
  assert.deepEqual(findSoftAdvice(text), [], `SOFT: ${text}`)
}

test('Market: 해설·인용 다섯 문장과 비슷한 말들은 HARD·SOFT 모두 통과', () => {
  for (const text of MARKET_FALSE_POSITIVES) none(text)
  for (const text of ['분할 접근이 유효하다는 분석', '선호 ETF군', '일반적인 매수 심리', '외국인 매수 검토 보도', '유럽 시장은 확실한 상승세를 보였습니다.', '확실히 하락 전환했습니다.',
    '2022년의 VIX 30과 지금 사이에는 거리가 있습니다.', '지금 사상 최고치 부근입니다.', '지금 사라지는 프리미엄', '조사도 늦지 않다', '검사 두세요', '기억해 두세요']) {
    none(text)
  }
})

test('Market HARD: 독자에게 사라·팔라는 명령형 — 앞뒤에 무엇이 오든 막는다(인용 밖)', () => {
  for (const [text, hit] of [
    ['KODEX 200을 지금 매수하세요.', '매수하세요'],
    ['반도체 비중을 줄이세요.', '비중을 줄이세요'],
    ['반도체 ETF를 담으세요.', '담으세요'],
    ['지금 사세요', '사세요'],
    ['지금 사두세요.', '사두세요'],
    ['지금 사 두세요', '사 두세요'],
    ['반도체 ETF를 담아두십시오.', '담아두십시오'],
    ['담아 두세요', '담아 두세요'],
    ['지금은 반도체를 편입하시기 바랍니다.', '편입하시기 바랍니다'],
    ['노출을 낮추는 것이 좋습니다.', '노출을 낮추는 것이 좋습니다'],
    ['지금 매수하세요 손해 볼 일은 없습니다.', '매수하세요'],
  ] as const) {
    assert.ok(findHardAdvice(text).includes(hit), `${text}: ${findHardAdvice(text).join(', ')}`)
  }
  // 단정·보장은 HARD가 아니다(SOFT)
  for (const text of ['지금이 매수 적기입니다.', '확실한 수익을 드립니다.', '지금 매수해야 합니다.', '강력 매수 신호']) assert.deepEqual(findHardAdvice(text), [], text)
})

test('Market SOFT: 단정·보장·"지금 사야" 꼴 — 부정·유보를 판정하지 않으므로 해설에 섞여도 걸린다(재생성 한 번이 비용)', () => {
  for (const [text, hit] of [
    ['지금 매수해야 합니다 손실 걱정은 없습니다.', '매수해야 합니다'],
    ['확실한 수익을 보장합니다 손실은 없습니다.', '확실한 수익'],
    ['지금이 매수 적기입니다.', '매수 적기'],
    ['지금은 매수 적기가 아닌 상황입니다.', '매수 적기'],
    ['매수 적기라는 판단은 아직 이르며 추이를 봐야 합니다.', '매수 적기'],
    ['확실한 수익을 보장하는 상품은 없습니다.', '확실한 수익'],
    ['지금이 바로 매수 기회입니다.', '지금이 바로 매수 기회'],
    ['지금 사야 합니다.', '지금 사야 합니다'],
    ['반도체는 지금 사야 한다', '지금 사야 한다'],
    ['지금 사도 늦지 않습니다.', '사도 늦지 않습니다'],
    ['반도체는 매수해야 할 때입니다', '매수해야 할 때'],
    ['강력 매수 신호', '강력 매수'],
    ['폭등 예상 구간', '폭등 예상'],
    ['확실히 오를 종목', '확실히 오를'],
    ['필수 매수 종목', '필수 매수'],
    ['반도체 매수는 필수입니다', '매수는 필수'],
  ] as const) {
    assert.ok(findSoftAdvice(text).includes(hit), `${text}: ${findSoftAdvice(text).join(', ')}`)
  }
})

test('Market SOFT: 인용부호 안은 보지 않는다(남의 주장 전달)', () => {
  for (const text of ["일부 증권사는 '지금 매수해야 한다'는 의견을 냈습니다.", '“매도해야 할 때”라는 주장도 나왔습니다.', '「매수 적기」라는 보고서', "'확실한 수익'이라는 광고"]) {
    assert.deepEqual(findSoftAdvice(text), [], text)
  }
  assert.deepEqual(findSoftAdvice("일부는 '반등'을 말하지만 지금은 매수해야 합니다."), ['매수해야 합니다'])
})

// Ruling 37f ①: '…해 주세요'·'사 주세요' 명령형, 같은 절 안에서 더 떨어진 '비중 … 줄이세요'.
test('Market HARD: "매수해 주세요·사 주세요"와 같은 절의 "비중을 지금보다 조금 더 줄이세요"도 막는다', () => {
  for (const [text, hit] of [
    ['반도체 ETF를 매수해 주세요.', '매수해 주세요'],
    ['반도체 ETF를 매수해주세요.', '매수해주세요'],
    ['지금은 매도해 주십시오.', '매도해 주십시오'],
    ['교체해 주세요', '교체해 주세요'],
    ['반도체 ETF를 사 주세요.', '사 주세요'],
    ['삼성전자 비중을 지금보다 조금 더 줄이세요.', '비중을 지금보다 조금 더 줄이세요'],
    ['해외 주식 노출을 이번 주 안에 조금씩 낮추는 것이 좋습니다.', '노출을 이번 주 안에 조금씩 낮추는 것이 좋습니다'],
  ] as const) {
    assert.ok(findHardAdvice(text).includes(hit), `${text}: ${findHardAdvice(text).join(', ')}`)
  }
  // 창은 같은 절 안만 — 문장 끝·쉼표를 넘지 않는다(앞 절의 '비중'과 뒤 절의 '늘리세요'를 잇지 않음)
  for (const text of ['외국인 비중이 늘었습니다. 현금을 늘리세요', '외국인 비중이 늘었고, 현금은 줄이세요', '반도체 비중은 그대로 두고 현금 흐름을 꼼꼼히 들여다본 뒤 줄이세요', '검사 주세요']) {
    assert.deepEqual(findHardAdvice(text), [], text)
  }
})

// Ruling 37f ②: 인용 안의 명령형은 남의 말(경고·광고 전달)이다 — HARD도 인용 구간을 보지 않는다.
test('Market HARD: 인용부호 안의 명령형은 보지 않고, 인용 밖은 막는다', () => {
  for (const text of ["금융당국은 '지금 매수하세요'라는 광고를 경계하라고 당부했습니다.", '“반도체를 담으세요”라는 문자에 주의하라는 당부', '「매도하십시오」라는 보고서 제목', '『지금 사두세요』 같은 권유']) {
    assert.deepEqual(findHardAdvice(text), [], text)
  }
  assert.deepEqual(findHardAdvice("금융당국의 '경고'와 달리 지금 매수하세요."), ['매수하세요'])
  assert.deepEqual(findHardAdvice("'따옴표가 닫히지 않은 채 매수하세요."), ['매수하세요']) // 닫히지 않은 따옴표는 인용이 아니다
})

test('stripQuotedSpans: 예전 정규식과 같은 결과(짝 맞는 구간만 공백 하나로, 줄을 넘지 않음, 닫히지 않으면 그대로)', () => {
  const OLD = /'[^'\n]*'|"[^"\n]*"|‘[^’\n]*’|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/g
  const samples = [
    "a'b'c'd'e", '"x" 그리고 “y” 「z」 『w』', "‘열림만 있고 닫힘 없음", "'줄을\n넘는' 따옴표", "'a'b'c'", '“중첩 ‘안’ 바깥”', "끝에 '", '', '따옴표 없음',
    "'‘섞임’' “'두 겹'” 「“낫표 안”」", "‘a’’b‘c", '""', "''",
  ]
  for (const s of samples) assert.equal(stripQuotedSpans(s), s.replace(OLD, ' '), JSON.stringify(s))
})

// Ruling 37f ④: 닫히지 않은 따옴표가 많아도 인용 구간 찾기가 선형이다(정규식은 따옴표마다 끝까지 다시 훑어 O(n²)였다).
test('Market: 닫히지 않은 따옴표 4만 8천 자도 100ms 안에 검사한다', () => {
  for (const unit of ['‘가', "'가", '"가', '“가', '「가', '『가']) {
    const text = unit.repeat(24_000)
    const start = performance.now()
    findHardAdvice(text)
    findSoftAdvice(text)
    const ms = performance.now() - start
    assert.ok(ms < 100, `${unit}: ${ms.toFixed(1)}ms`)
  }
})

test('Market: 10만 자 글도 선형으로 빠르게 검사한다', () => {
  const chunk = '코스피는 외국인 매도에 밀렸고 지금 사이에는 변수가 많습니다, 매수 적기라는 판단은 이릅니다. '
  const text = chunk.repeat(Math.ceil(100_000 / chunk.length)).slice(0, 100_000)
  const start = performance.now()
  findHardAdvice(text)
  findSoftAdvice(text)
  findHardAdvice(text + '매수하세요')
  const ms = performance.now() - start
  assert.ok(ms < 200, `${ms.toFixed(1)}ms`)
})
