// Ruling 31 (2026-10-19): 제목·카드 한 줄의 확인할 수 없는 기간 비교·최상급 표현 탐지.
// 파이프라인의 과거 기준점은 1년·3개월·1개월·1주뿐이라 "1년치", "사상 최고", "N년 만에 최저" 같은 주장은 검증할 수 없다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparativeClaimViolations, findUnverifiableComparisons } from './comparative-claims'

const TODAY_MARKET_HEADLINE = '코스피, 6,625에서 5,668로…한 주 만에 1년치 수익을 되돌렸다'

test('오늘(10/19) Market 제목은 걸린다', () => {
  assert.deepEqual(findUnverifiableComparisons(TODAY_MARKET_HEADLINE), ['1년치'])
})

test('기간 비교·최상급 표현을 잡는다', () => {
  const cases: Array<[string, string]> = [
    // N년치·N개월치 (붙여 쓰기·띄어 쓰기·한글 수사)
    ['3개월치 상승분을 하루에 반납', '3개월치'],
    ['코스피, 1년 치 수익을 되돌렸다', '1년 치'],
    ['한 달치 낙폭을 사흘 만에 회복', '한 달치'],
    ['반년치 상승분 반납', '반년치'],
    ['두 주치를 하루에', '두 주치'],
    ['1년치를 지웠다', '1년치'],
    // 역대·사상 + 최상급
    ['나스닥 사상 최고, 국채는 강세', '사상 최고'],
    ['환율 역대 최대 낙폭', '역대 최대'],
    ['코스피 사상 처음 7,000 돌파', '사상 처음'],
    ['역대 최초 금리 동결 3연속', '역대 최초'],
    ['역대 가장 큰 하루 낙폭', '역대 가장'],
    // N년 만에·N년래·YYYY년 이후 + 최상급
    ['원화 10년 만에 최저', '10년 만에 최저'],
    ['국채 금리 17년 만의 최고치', '17년 만의 최고'],
    ['석 달 만에 최고로 오른 금값', '석 달 만에 최고'],
    ['1주일 만에 최대 반등', '1주일 만에 최대'],
    ['엔화 10년래 최저', '10년래 최저'],
    ['국채는 2002년 이후 최고 금리', '2002년 이후 최고'],
    ['3년 만에 처음 마이너스', '3년 만에 처음'],
    ['수년 만에 최고 수준', '수년 만에 최고'],
    ['수개월치 상승분 반납', '수개월치'],
    ['조선 수주 이후 최대 급등', '최대 급등'], // 최상급은 잡되 '수주(受注)'를 '수 주'로 읽지는 않는다
    // 연중 최고·최저
    ['환율 연중 최고', '연중 최고'],
    ['코스닥 연중최저치 근접', '연중최저'],
    // 최대·최악 + 낙폭·하락·상승 등
    ['코스피 최대 낙폭, 외국인은 매도', '최대 낙폭'],
    ['최악의 하락 뒤 반등', '최악의 하락'],
    ['반도체 최대 급락', '최대 급락'],
    ['미 국채 최대폭 상승', '최대폭 상승'],
  ]
  for (const [text, hit] of cases) {
    assert.deepEqual(findUnverifiableComparisons(text), [hit], text)
  }
})

test('10/20 dry-run ETF 제목: 연속·규모 표현을 잡는다(Ruling 36)', () => {
  assert.deepEqual(findUnverifiableComparisons('방산, 이틀째 두 자릿수 낙폭…미 반도체가 반등을 받쳤다'), ['이틀째', '두 자릿수'])
})

test('연속(N일째·N거래일 연속·연일)·규모(두·세 자릿수) 표현을 잡는다(Ruling 36)', () => {
  const cases: Array<[string, string]> = [
    ['코스피 3거래일 연속 상승', '3거래일 연속'],
    ['외국인 5일째 순매도', '5일째'],
    ['사흘째 밀린 반도체', '사흘째'],
    ['2차전지 연일 급락', '연일 급락'],
    ['연속 하락 끝에 반등한 코스피', '연속 하락'],
    ['반도체 ETF 두 자릿수 급등', '두 자릿수'],
    ['세 자리수 낙폭', '세 자리수'],
  ]
  for (const [text, hit] of cases) assert.ok(findUnverifiableComparisons(text).includes(hit), `${text} → ${hit}`)
})

test('평범한 제목·카드 문구는 잡지 않는다', () => {
  for (const text of [
    '코스피 반등, 이번 주 금통위가 시험대',
    '미 반도체 4% 급락, 코스피는 반대로 올랐다',
    '금통위가 최대 변수',
    '이번 주 최대 관심사는 금통위입니다',
    '최고 관심은 개장 30분 거래대금입니다',
    '최대 수혜는 조선, 반도체는 숨 고르기',
    '최악은 피했다, 코스피 낙폭 축소',
    '외국인이 최대한 버텼다',
    '연중 최대 이벤트인 금통위가 목요일입니다',
    '3분기 최대 실적에도 주가는 제자리',
    '삼성 배당 마지막 날, 주가는 3개월 전 고점에서 얼마나 멀리 있나',
    '코스피 7.5%, 한 주를 통째로 반납했다',
    '원화, 하루 만에 20원 되찾다',
    '한 주 만에 반등, 코스피 6,000선 회복',
    '1년 전보다 높은 금리가 부담입니다',
    '2026년 치열한 반도체 경쟁', // 연도 뒤 '치열' — N년치가 아니다
    '2주 치솟은 금값, 오늘은 숨 고르기', // '치솟' — N주치가 아니다
    '1년 치고는 조용한 출발', // '치고' — N년치가 아니다
    '방산 수주 이후 최고가 경신', // '수주(受注)'는 '수 주(몇 주)'가 아니다
    '조선 대형 수주 만에 최고 실적', // 같은 이유
    '금통위 금리 결정이 이번 주 시장의 방향을 가릅니다.',
    '미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다',
    '금통위 이틀 앞두고 채권이 먼저 움직였다', // 이틀 뒤가 '째·연속'이 아니다
    '이틀 뒤 금통위, 반도체는 숨 고르기',
    '연속성 있는 반등인지 오늘 확인합니다', // '연속' 뒤가 움직임 낱말이 아니다
    '10월 21일 금통위를 앞둔 코스피',
    '연일 관심이 쏠린 2차전지', // '연일' 뒤가 움직임 낱말이 아니다
    '한 자릿수 반등에 그친 코스피', // 작은 규모 표현은 과장 위험이 낮아 범위 밖
  ]) {
    assert.deepEqual(findUnverifiableComparisons(text), [], text)
  }
})

test('알려진 한계: 수식어 없는 최상급("역대급", "최고치")은 이번 규칙으로 잡지 않는다', () => {
  // 범위를 좁게 유지한 결정(Ruling 31 최소 패턴 + 같은 꼴 변형) — 넓히려면 이 테스트를 함께 고친다.
  assert.deepEqual(findUnverifiableComparisons('삼성 역대급 실적에도 코스피 혼자 밀렸다'), [])
  assert.deepEqual(findUnverifiableComparisons('SK하이닉스 6% 빠진 날, S&P500은 최고치 썼다'), [])
})

test('강조 태그는 벗기고 보고, 문자열이 아니면 빈 배열', () => {
  assert.deepEqual(findUnverifiableComparisons('<strong>1년</strong>치 수익'), ['1년치'])
  for (const value of [undefined, null, 42, {}, ['1년치']]) {
    assert.deepEqual(findUnverifiableComparisons(value), [], String(value))
  }
})

test('같은 표현은 한 번만, 여러 표현은 나온 순서대로', () => {
  assert.deepEqual(findUnverifiableComparisons('1년치 반납, 다시 1년치'), ['1년치'])
  assert.deepEqual(findUnverifiableComparisons('사상 최고 뒤 1년치 반납'), ['사상 최고', '1년치'])
})

test('필드별 위반 문구: 걸린 필드만, 필드 이름과 표현을 밝힌다', () => {
  const v = comparativeClaimViolations([
    ['cover.headline', TODAY_MARKET_HEADLINE],
    ['cardLine.text', '금통위 금리 결정이 이번 주 방향을 가릅니다'],
  ])
  assert.equal(v.length, 1)
  assert.match(v[0], /^cover\.headline /)
  assert.match(v[0], /기간 비교·최상급/)
  assert.match(v[0], /1년치/)
  assert.deepEqual(comparativeClaimViolations([['card.line', undefined], ['cover.headline', '코스피 반등']]), [])
})
