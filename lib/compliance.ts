// lib/compliance.ts
//
// 준법: 매수·매도 권유 표현 탐지 — Market·ETF 공용(Ruling 37, 2026-10-20).
// INVESTMENT_ADVICE_PATTERNS: ETF(lib/etf/report-quality.ts)에만 있던 목록을 그대로 옮겼다 — ETF 검사가 쓴다(37a에서 '지금 사'만 좁힘).
// Market(lib/claude-client.ts)은 두 단계(Ruling 37e) — 부정·유보를 정규식으로 판정하던 37c 방식은 양쪽으로 샜다
// ("매수해야 합니다 손실 걱정은 없습니다"는 통과, "매수 적기가 아닌 상황"은 막힘). 그래서 부정 판정을 아예 없앴다:
//  - HARD(HARD_ADVICE_PATTERNS): 독자에게 사라·팔라는 명령형만. 모든 시도에서 막고 마지막 시도에서도 발송 후보가 될 수 없다.
//  - SOFT(SOFT_ADVICE_PATTERNS): 단정·보장과 '지금 사야' 꼴. 일반 기준 위반 — 1~2회차는 재생성, 마지막 시도는 경고만(F02).
//    해설에 섞여 걸려도 재생성 한 번이 비용이다. 인용부호 안은 보지 않는다(남의 주장 전달).
// 모든 패턴은 g 플래그 없이 전체 글에 한 번씩만 돈다 — 글 길이에 선형.

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

/** Market HARD: 독자에게 사라·팔라는 명령형 — 인용 안이든 밖이든, 앞뒤에 무엇이 오든 막는다. */
export const HARD_ADVICE_PATTERNS: readonly RegExp[] = [
  /(?:매수|매도|처분|편입|교체)\s*하(?:세요|십시오|시기\s*바랍니다)/,
  /(?<![가-힣])(?:사|파|팔|담으)(?:세요|십시오)/,
  // 사두다·담아두다 명령형("지금 사두세요", "사 두세요", "담아두십시오")
  /(?<![가-힣])(?:사|담아)\s*두(?:세요|십시오)/,
  /(?:비중|노출)[^.!?\n]{0,8}(?:줄이|늘리|낮추|높이)(?:세요|십시오|시기\s*바랍니다|는\s*것이\s*좋(?:습니다|겠습니다))/,
]

/**
 * Market SOFT: 단정·보장과 '지금 사야' 꼴 — 일반 기준 위반(마지막 시도는 경고만). 인용부호 안은 보지 않는다.
 * 확실히/확실한은 ETF 목록과 달리 '상승·하락'을 뺐다("유럽 시장은 확실한 상승세를 보였습니다" — 지난 사실 서술).
 */
export const SOFT_ADVICE_PATTERNS: readonly RegExp[] = [
  /확실히\s*(?:매수|매도|수익|오를|떨어질|돈)/,
  /확실한\s*(?:매수|매도|수익|투자\s*기회|종목)/,
  /폭등\s*예상/,
  /강력\s*매수/,
  /매수\s*적기/,
  /지금이\s*(?:바로\s*)?매수\s*기회/,
  /지금\s*사야\s*(?:합니다|한다|할\s*때)/,
  /(?<![가-힣])사도\s*늦지\s*않(?:습니다|다)/,
  /(?:매수|매도)해야\s*(?:합니다|한다|할\s*때)/,
  /필수\s*(?:매수|매도|편입|진입)/,
  /(?:매수|매도|편입|진입)\s*(?:가|는)?\s*필수/,
]

// 짝이 맞는 인용 구간(작은·큰따옴표, 굽은 따옴표, 낫표). 짝이 없는 따옴표는 그대로 둔다.
const QUOTED_SPAN = /'[^'\n]*'|"[^"\n]*"|‘[^’\n]*’|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/g

/** Market HARD 권유의 실제 문구(패턴마다 첫 일치 하나). 없으면 빈 배열. */
export function findHardAdvice(text: string): string[] {
  return firstMatches(text, HARD_ADVICE_PATTERNS)
}

/** Market SOFT 권유의 실제 문구(인용 구간 밖, 패턴마다 첫 일치 하나). 없으면 빈 배열. */
export function findSoftAdvice(text: string): string[] {
  return firstMatches(text.replace(QUOTED_SPAN, ' '), SOFT_ADVICE_PATTERNS)
}

function firstMatches(text: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = []
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m) found.push(m[0])
  }
  return found
}
