// lib/compliance.ts
//
// 준법: 매수·매도 권유 표현 탐지 — Market·ETF 공용(Ruling 37, 2026-10-20).
// INVESTMENT_ADVICE_PATTERNS: ETF(lib/etf/report-quality.ts)에만 있던 목록을 그대로 옮겼다 — ETF 검사가 쓴다.
// DIRECTIVE_ADVICE_PATTERNS: Market(lib/claude-client.ts) 검사용 좁은 목록 — 독자에게 사라·팔라는 지시형과 수익 보장만(Ruling 37a).
// 두 파이프라인 모두 권유 표현은 마지막 시도에서도 막는다(F02의 예외 — 준법은 발송보다 앞선다). 그래서 Market 목록은
// 뉴스 해설에 흔한 낱말("현지 생산 비중 확대", 증권사 '비중확대' 의견, "무조건 좋은 것은 아니다"라는 인용, "신규 진입 시")을 잡지 않는다 —
// 최근 60개 Market 리포트 중 5개가 전체 목록에 걸렸고 모두 해설·인용이었다(세 번 다 걸리면 Market이 멈춘다).

export const INVESTMENT_ADVICE_PATTERNS: readonly RegExp[] = [
  /강력\s*매수/,
  /무조건/,
  // Ruling 37a: 지시형만 — "VIX 30과 지금 사이에는"·"지금 사상"·"지금 사실상"·"지금 사라지는"을 잡지 않는다.
  /지금\s*사(?:세요|십시오|야|라(?![지져졌])|두세요|둘\s*때)/,
  /매수해야/,
  /매도해야/,
  /매수\s*검토/,
  /신규\s*진입/,
  /분할\s*접근/,
  /비중\s*확대/,
  /선호\s*ETF군/,
  /일반적인\s*매수/,
  /확실히\s*(매수|매도|상승|하락|수익|오를|떨어질|돈)/,
  /확실한\s*(매수|매도|수익|투자\s*기회|종목|상승|하락)/,
  /폭등\s*예상/,
  /필수\s*(매수|매도|종목|전략|포지션|편입|진입)/,
  /(매수|매도|편입|진입|투자)\s*(가|는)?\s*필수/,
  // 2026-10-17: "갖고 있다면 / 새로 본다면"은 조건·관찰형만 — 지시형 매매 표현을 잡는다.
  /(?:매수|매도|처분|편입|교체)\s*하(?:세요|십시오|시기\s*바랍니다)/,
  /(?<![가-힣])(?:사|파|팔|담으)(?:세요|십시오)/,
  /(?:비중|노출)[^.!?\n]{0,8}(?:줄이|늘리|낮추|높이)(?:세요|십시오|시기\s*바랍니다|는\s*것이\s*좋(?:습니다|겠습니다))/,
]

/** 글에서 찾은 권유 표현의 실제 문구(패턴마다 첫 일치 하나). 없으면 빈 배열. ETF 목록. */
export function findInvestmentAdvice(text: string): string[] {
  return firstMatches(text, INVESTMENT_ADVICE_PATTERNS)
}

/*
 * Market 검사용(Ruling 37a·37b·37c): 독자에게 사라·팔라는 지시형과 수익 보장만. 세 목록으로 나눈다.
 * 빼 둔 것(해설·인용에 흔함): 무조건, 신규 진입, 분할 접근, 비중 확대, 매수 검토, 선호 ETF군, 일반적인 매수, 방향 서술의 확실한 상승·하락.
 */

/** 명령형 지시 — 인용 안이든 밖이든, 뒤에 부정이 와도 지시다("지금 매수하세요 손해 볼 일은 없습니다"). */
export const DIRECTIVE_ADVICE_PATTERNS: readonly RegExp[] = [
  /(?:매수|매도|처분|편입|교체)\s*하(?:세요|십시오|시기\s*바랍니다)/,
  /(?<![가-힣])(?:사|파|팔|담으)(?:세요|십시오)/,
  // Ruling 37c: 사두다·담아두다 명령형("지금 사두세요", "사 두세요", "담아두십시오").
  /(?<![가-힣])(?:사|담아)\s*두(?:세요|십시오)/,
  /(?:비중|노출)[^.!?\n]{0,8}(?:줄이|늘리|낮추|높이)(?:세요|십시오|시기\s*바랍니다|는\s*것이\s*좋(?:습니다|겠습니다))/,
]

/**
 * 단정·보장 — 인용 안이든 밖이든 보지만, 같은 절에서 뒤에 부정·유보가 오면 세지 않는다
 * ("확실한 수익을 보장하는 상품은 없습니다").
 */
export const CLAIM_ADVICE_PATTERNS: readonly RegExp[] = [
  /강력\s*매수/,
  /폭등\s*예상/,
  // 수익·방향 보장. ETF 목록과 달리 '상승·하락'은 뺐다 — "유럽 시장은 확실한 상승세를 보였습니다"(지난 사실 서술)가 걸렸다.
  // 앞으로의 보장은 '오를·떨어질·수익'으로 잡는다.
  /확실히\s*(?:매수|매도|수익|오를|떨어질|돈)/,
  /확실한\s*(?:매수|매도|수익|투자\s*기회|종목)/,
  /필수\s*(?:매수|매도|편입|진입)/,
  /(?:매수|매도|편입|진입)\s*(?:가|는)?\s*필수/,
]

/**
 * 인용부호 밖에서만 보는 권유 — "매수해야 합니다"는 막고, 남의 주장을 옮긴 "'매수해야 한다'는 의견"은 두지 않는다.
 * 같은 절에서 뒤에 부정·유보가 오면 세지 않는다("지금은 매수 적기가 아닙니다", "지금 사야 한다는 뜻은 아닙니다").
 */
export const UNQUOTED_DIRECTIVE_ADVICE_PATTERNS: readonly RegExp[] = [
  /(?:매수|매도)해야\s*(?:합니다|한다|할\s*때)/,
  // Ruling 37b: 명령형이 아니어도 지금 사라는 뜻이 분명한 꼴만("지금 사이·사상"은 잡지 않는다).
  /지금\s*사야\s*(?:합니다|한다|할\s*때)/,
  /(?<![가-힣])사도\s*늦지\s*않(?:습니다|다)/,
  /지금이\s*(?:바로\s*)?매수\s*기회/,
  /매수\s*적기/,
]

// 짝이 맞는 인용 구간(작은·큰따옴표, 굽은 따옴표, 낫표). 짝이 없는 따옴표는 그대로 둔다.
const QUOTED_SPAN = /'[^'\n]*'|"[^"\n]*"|‘[^’\n]*’|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/g

// Ruling 37c: 일치 뒤 같은 절(쉼표·세미콜론 전까지, 같은 문장 안)에 오는 부정·유보 — 있으면 그 일치는 해설이다.
// 보수적으로: 부정(아니다·아닙니다·아니라·않다·않습니다·않는다·없다·없습니다)과 유보(이르다·이릅니다·어렵다·어렵습니다·금물·주의·경계)만.
// 강조형은 부정이 아니다 — '뿐 아니라', '틀림없다·다름없다·어김없다·변함없다·손색없다'.
const NEGATION_OR_HEDGE =
  /(?<!뿐\s?)아니(?:다|라)|아닙니다|않(?:다|습니다|는다)|(?<!틀림|다름|어김|변함|손색)없(?:다|습니다)|이르다|이릅니다|어렵(?:다|습니다)|금물|주의|경계/
const SENTENCE_BREAK = /(?<=[.!?。])\s+|\n+/
const CLAUSE_BREAK = /[,，;]/

/** Market 검사용 권유 표현의 실제 문구(패턴마다 첫 일치 하나). 없으면 빈 배열. */
export function findDirectiveAdvice(text: string): string[] {
  const unquoted = text.replace(QUOTED_SPAN, ' ')
  return [
    ...firstMatches(text, DIRECTIVE_ADVICE_PATTERNS),
    ...firstAffirmedMatches(text, CLAIM_ADVICE_PATTERNS),
    ...firstAffirmedMatches(unquoted, UNQUOTED_DIRECTIVE_ADVICE_PATTERNS),
  ]
}

function firstMatches(text: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = []
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m) found.push(m[0])
  }
  return found
}

/** 패턴마다 같은 절 뒤에 부정·유보가 따르지 않는 첫 일치 하나. 한 문장에 부정된 일치와 긍정 일치가 함께 있으면 긍정 쪽을 센다. */
function firstAffirmedMatches(text: string, patterns: readonly RegExp[]): string[] {
  const sentences = text.split(SENTENCE_BREAK)
  const found: string[] = []
  for (const pattern of patterns) {
    const all = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
    search: for (const sentence of sentences) {
      for (const m of sentence.matchAll(all)) {
        const rest = sentence.slice((m.index ?? 0) + m[0].length).split(CLAUSE_BREAK)[0]
        if (NEGATION_OR_HEDGE.test(rest)) continue
        found.push(m[0])
        break search
      }
    }
  }
  return found
}
