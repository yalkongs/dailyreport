// lib/compliance.test.ts
// Ruling 37·37a (2026-10-20): ETF 목록(INVESTMENT_ADVICE_PATTERNS)은 그대로 두되 '지금 사'만 지시형으로 좁히고,
// Market은 독자에게 사라·팔라는 지시형·수익 보장만 보는 좁은 목록(DIRECTIVE_ADVICE_PATTERNS)을 쓴다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INVESTMENT_ADVICE_PATTERNS, findInvestmentAdvice, findDirectiveAdvice } from './compliance'

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
  assert.ok(INVESTMENT_ADVICE_PATTERNS.every(p => !p.global), 'g 플래그 없음 — exec/test가 상태를 갖지 않는다')
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

// Market 최근 60개 리포트 중 전체 목록에 걸렸던 문장(모두 해설·인용) — Market 목록은 통과해야 한다.
const MARKET_FALSE_POSITIVES = [
  '현지 생산 비중 확대',
  "'환율 강세라고 무조건 미국 주식이 좋은 것은 아니다'라는 경고(뉴시스 인용)",
  'VIX 30과 지금 사이에는',
  "월가는 SK하이닉스에 '매수·비중확대'를 내걸었고",
  '신규 진입 시 가격 수준 자체를 맥락으로 삼아야',
]

test('Market 목록: 해설·인용 다섯 문장은 통과한다', () => {
  for (const text of MARKET_FALSE_POSITIVES) assert.deepEqual(findDirectiveAdvice(text), [], text)
  for (const text of ['분할 접근이 유효하다는 분석', '선호 ETF군', '일반적인 매수 심리', '외국인 매수 검토 보도']) assert.deepEqual(findDirectiveAdvice(text), [], text)
  // 전체 138개 리포트 재점검에서 걸린 지난 사실 서술(2026-05-19) — 방향 서술의 '확실한 상승·하락'은 Market에서 보지 않는다
  for (const text of ['유럽 시장은 확실한 상승세를 보였습니다.', '확실히 하락 전환했습니다.']) assert.deepEqual(findDirectiveAdvice(text), [], text)
})

test('Market 목록: 독자에게 사라·팔라는 지시형과 수익 보장은 막는다', () => {
  for (const [text, hit] of [
    ['KODEX 200을 지금 매수하세요.', '매수하세요'],
    ['반도체 비중을 줄이세요.', '비중을 줄이세요'],
    ['반도체 ETF를 담으세요.', '담으세요'],
    ['지금 사세요', '사세요'],
    ['지금은 반도체를 편입하시기 바랍니다.', '편입하시기 바랍니다'],
    ['노출을 낮추는 것이 좋습니다.', '노출을 낮추는 것이 좋습니다'],
    ['강력 매수 신호', '강력 매수'],
    ['폭등 예상 구간', '폭등 예상'],
    ['확실한 수익 구간입니다.', '확실한 수익'],
    ['확실히 오를 종목', '확실히 오를'],
    ['필수 매수 종목', '필수 매수'],
    ['반도체 매수는 필수입니다', '매수는 필수'],
    ['반도체는 매수해야 할 때입니다', '매수해야 할 때'],
    ['지금은 매도해야 합니다.', '매도해야 합니다'],
  ] as const) {
    assert.ok(findDirectiveAdvice(text).includes(hit), `${text}: ${findDirectiveAdvice(text).join(', ')}`)
  }
})

// Ruling 37b: 명령형이 아니어도 독자에게 지금 사라는 뜻이 분명한 꼴 — 인용부호 밖에서만.
const BUY_NOW_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['지금 사야 합니다.', '지금 사야 합니다'],
  ['반도체는 지금 사야 한다', '지금 사야 한다'],
  ['지금 사야 할 때입니다', '지금 사야 할 때'],
  ['지금 사도 늦지 않습니다.', '사도 늦지 않습니다'],
  ['반도체 ETF는 사도 늦지 않다', '사도 늦지 않다'],
  ['지금이 매수 기회입니다.', '지금이 매수 기회'],
  ['반도체는 매수 적기입니다.', '매수 적기'],
]

test('Market 목록: "지금 사야 합니다·사도 늦지 않습니다·지금이 매수 기회·매수 적기"는 막는다(인용 밖)', () => {
  for (const [text, hit] of BUY_NOW_FORMS) {
    assert.ok(findDirectiveAdvice(text).includes(hit), `${text}: ${findDirectiveAdvice(text).join(', ')}`)
    assert.deepEqual(findDirectiveAdvice(`일부는 '${text}'라고 주장했습니다.`), [], `인용: ${text}`)
  }
  for (const text of ['2022년의 VIX 30과 지금 사이에는 아직 거리가 있습니다.', '지금 사상 최고치 부근입니다.', '조사도 늦지 않습니다', ...MARKET_FALSE_POSITIVES]) {
    assert.deepEqual(findDirectiveAdvice(text), [], text)
  }
})

// Ruling 37c ①: 같은 문장·절에서 일치 뒤에 부정·유보가 오면 권유가 아니라 해설이다(세 번 다 걸려 Market이 멈췄다 — Codex 재현).
test('Market 목록: 일치 뒤 같은 절의 부정·유보(아닙니다·이릅니다·없습니다 등)는 통과, 긍정형은 막는다', () => {
  for (const text of [
    '지금은 매수 적기가 아닙니다.',
    '매수 적기라는 판단은 아직 이릅니다.',
    '지금 사야 한다는 뜻은 아닙니다.',
    '확실한 수익을 보장하는 상품은 없습니다.',
    '지금이 매수 기회라고 보기는 어렵습니다.',
    '지금 사도 늦지 않다는 기대는 금물입니다.',
    '확실히 오를 것이라는 해석은 경계해야 합니다.',
    '매수해야 한다는 조급함은 주의할 필요가 있습니다.',
    '필수 매수 종목이라는 것은 없다',
    '반도체가 매수 적기인지는 아직 알 수 없습니다. 지금 사야 한다고 보지 않습니다.',
  ]) {
    assert.deepEqual(findDirectiveAdvice(text), [], text)
  }
  for (const [text, hit] of [
    ['지금이 매수 적기입니다.', '매수 적기'],
    ['지금 사야 합니다.', '지금 사야 합니다'],
    ['확실한 수익을 드립니다.', '확실한 수익'],
    ['KODEX 200을 지금 매수하세요.', '매수하세요'],
    // 부정은 다른 문장·다른 절에 있으면 효력이 없다
    ['지금이 매수 적기입니다. 손실 위험은 없습니다.', '매수 적기'],
    ['지금이 매수 적기입니다, 손실 걱정은 없습니다.', '매수 적기'],
    // 강조형 '틀림없다'·'뿐 아니라'는 부정이 아니다
    ['지금이 매수 적기임은 틀림없습니다.', '매수 적기'],
    ['지금 사야 할 때일 뿐 아니라 늦었습니다.', '지금 사야 할 때'],
    // 같은 문장에 부정된 일치와 긍정 일치가 함께 있으면 긍정 쪽으로 막는다
    ['매수 적기가 아니라던 말과 달리 이제는 매수 적기입니다.', '매수 적기'],
    // 명령형은 뒤에 부정이 와도 지시다
    ['지금 매수하세요 손해 볼 일은 없습니다.', '매수하세요'],
  ] as const) {
    assert.ok(findDirectiveAdvice(text).includes(hit), `${text}: ${findDirectiveAdvice(text).join(', ')}`)
  }
})

// Ruling 37c ②: '사두다·담아두다' 명령형.
test('Market 목록: "지금 사두세요·사 두세요·담아두세요"는 막고, "지금 사이·사상·사라지는·조사도 늦지 않다"는 통과', () => {
  for (const [text, hit] of [['지금 사두세요.', '사두세요'], ['지금 사 두세요', '사 두세요'], ['반도체 ETF를 담아두십시오.', '담아두십시오'], ['담아 두세요', '담아 두세요']] as const) {
    assert.ok(findDirectiveAdvice(text).includes(hit), `${text}: ${findDirectiveAdvice(text).join(', ')}`)
  }
  for (const text of ['2022년의 VIX 30과 지금 사이에는 거리가 있습니다.', '지금 사상 최고치 부근입니다.', '지금 사라지는 프리미엄', '조사도 늦지 않다', '검사 두세요', '기억해 두세요']) {
    assert.deepEqual(findDirectiveAdvice(text), [], text)
  }
})

test('Market 목록: "매수해야/매도해야"는 인용부호 안이면 두고(남의 주장 전달), 밖이면 막는다', () => {
  for (const text of ["일부 증권사는 '지금 매수해야 한다'는 의견을 냈습니다.", '“매도해야 할 때”라는 주장도 나왔습니다.', '「매수해야 한다」는 보고서']) {
    assert.deepEqual(findDirectiveAdvice(text), [], text)
  }
  assert.deepEqual(findDirectiveAdvice("일부는 '반등'을 말하지만 지금은 매수해야 합니다."), ['매수해야 합니다'])
  // 지시형 명령문은 인용 안이어도 막는다
  assert.ok(findDirectiveAdvice("전문가는 '지금 매수하세요'라고 말했습니다.").length > 0)
})
