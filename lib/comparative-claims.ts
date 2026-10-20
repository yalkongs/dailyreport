// lib/comparative-claims.ts
//
// Ruling 31 (2026-10-19): 제목·카드 한 줄의 "확인할 수 없는 기간 비교·최상급 표현" 탐지 — Market·ETF 공용.
//
// 10/19 Market 제목 "코스피, 6,625에서 5,668로…한 주 만에 1년치 수익을 되돌렸다"는 본문(1년 상승분의 "절반에 가까운"
// 957p)보다 과장됐고 og:title·텔레그램으로 고객에게 나갔다. 수치 대조는 있지만 기간 비교·최상급 같은 정성 주장은
// 검사하지 않았고, 파이프라인의 과거 기준점은 1년·3개월·1개월·1주뿐이라 "1년치", "사상 최고", "N년 만에 최저",
// "연중 최고" 같은 주장은 입력으로 확인할 수 없다.
//
// 가장 잘 보이는 짧은 필드(Market cover.headline·cardLine.text, ETF cover.headline·card.line)에만 적용한다.
// 1·2회차는 재생성 사유, 마지막 시도는 경고만(F02 "전송 > 침묵") — 판정은 각 파이프라인의 기존 기준 위반 경로가 한다.
//
// 범위는 좁게: "최대 변수", "최고 관심", "최대 수혜", "연중 최대 이벤트"처럼 평범한 표현은 잡지 않는다.
// 수식어 없는 "역대급"·"최고치"는 이번 규칙 밖이다(알려진 한계 — comparative-claims.test.ts).

// 수사: 한두 자리 숫자(앞에 숫자·쉼표·소수점이 붙지 않은 — "2026년"의 "26년"을 잡지 않게) 또는 한글 수사(앞이 한글이 아닐 때).
// '수'(수년·수개월)는 뒤에 '주'가 오면 빼서 '수주(受注)'를 '수 주(몇 주)'로 읽지 않는다(조선·방산 수주 제목).
const NUM = String.raw`(?:(?<![\d,.])\d{1,2}|(?<![가-힣])(?:한|두|세|석|네|넉|몇|반|수(?!\s*주)|일))`
// 기간 단위. "주일"을 "주"보다 먼저(1주일 만에).
const UNIT = String.raw`(?:개월|주일|년|해|달|주)`
// 최상급
const SUPERLATIVE = String.raw`(?:최대|최고|최저|최악|처음|최초|가장)`
// "치" 뒤: 끝·공백·구두점·조사만 — "2주 치솟은", "2026년 치열한", "1년 치고는"을 N년치로 보지 않게.
const CHI_END = String.raw`(?=$|[\s,.·…!?'"」』)\]]|[를을가이의에는은도만와과로])`

const PATTERNS: readonly string[] = [
  // 역대·사상 + 최상급: 역대 최대, 사상 최고, 사상 처음, 역대 가장 …
  String.raw`(?:역대|사상)\s*(?:최대|최고|최저|최악|최장|처음|최초|초유|가장)`,
  // YYYY년 이후·이래 + 최상급: 2002년 이후 최고
  String.raw`(?<!\d)(?:19|20)\d{2}\s*년\s*(?:이후|이래|래)\s*${SUPERLATIVE}`,
  // N년 만에·만의·래·이래·이후 + 최상급: 10년 만에 최저, 17년 만의 최고치, 석 달 만에 최고, 10년래 최저
  String.raw`${NUM}\s*${UNIT}\s*(?:만\s*(?:에|의)?|래|이래|이후)\s*${SUPERLATIVE}`,
  // N년치·N개월치: 1년치, 1년 치, 3개월치, 한 달치, 반년치
  String.raw`${NUM}\s*${UNIT}\s*치${CHI_END}`,
  // 연중 최고·최저
  String.raw`연중\s*(?:최고|최저)`,
  // 최대·최악(의/폭) + 낙폭·폭락·급락·하락·상승·급등: 최대 낙폭, 최악의 하락, 최대폭 상승
  String.raw`(?:최대|최악)(?:의|폭)?\s*(?:낙폭|폭락|급락|하락|상승|급등)`,
  // Ruling 36 (2026-10-20): 연속 표현 — 입력 등락률은 직전 거래일 하루치라 확인할 수 없다.
  // 이틀째·사흘째·N일째·N거래일 연속 ("이틀 앞두고"·"이틀 뒤"처럼 째·연속이 아니면 잡지 않음)
  String.raw`(?:(?<![가-힣])(?:이틀|사흘|나흘|닷새|엿새|이레|열흘)|(?<![\d,.])\d{1,2}\s*(?:거래일|일))\s*(?:째|연속)`,
  // 연속·연일 + 움직임 낱말: 연속 하락, 연일 급락 ("연속성"·"연일 관심"은 잡지 않음)
  String.raw`(?:연속|연일|연이틀|연사흘)\s*(?:상승|하락|급등|급락|순매수|순매도|강세|약세|반등|오름세|내림세)`,
  // 큰 규모 표현: 두·세 자릿수 (10/20 dry-run "두 자릿수 낙폭"은 실제 -9.45%였다)
  String.raw`(?:두|세)\s*자(?:릿|리)수`,
]

// 한 정규식으로 묶어 겹치는 일치를 한 번만 센다("역대 최대 낙폭" → "역대 최대" 하나).
const COMPARATIVE_CLAIM = new RegExp(PATTERNS.join('|'), 'g')

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

/** 확인할 수 없는 기간 비교·최상급 표현 목록(같은 표현은 한 번, 나온 순서). 문자열이 아니면 빈 배열. 강조 태그는 벗기고 본다. */
export function findUnverifiableComparisons(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const hits = [...stripTags(text).matchAll(COMPARATIVE_CLAIM)].map(m => m[0])
  return [...new Set(hits)]
}

/**
 * 필드별 위반 문구 — 걸린 필드만. fields: [필드 이름, 값] 목록(값이 문자열이 아니면 건너뛴다).
 * 호출자가 기준 위반(재생성 사유)으로 쓰고, 마지막 시도에서는 경고로만 남긴다(F02).
 */
export function comparativeClaimViolations(fields: ReadonlyArray<readonly [string, unknown]>): string[] {
  const violations: string[] = []
  for (const [label, value] of fields) {
    const hits = findUnverifiableComparisons(value)
    if (hits.length > 0) {
      violations.push(`${label} 기간 비교·최상급 표현(입력 데이터로 확인할 수 없음): ${hits.map(h => `"${h}"`).join(', ')}`)
    }
  }
  return violations
}
