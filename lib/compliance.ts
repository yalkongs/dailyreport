// lib/compliance.ts
//
// 준법: 매수·매도 권유 표현 탐지 — Market·ETF 공용(Ruling 37, 2026-10-20).
// ETF(lib/etf/report-quality.ts)에만 있던 목록을 그대로 옮겼다(ETF 동작은 같다). Market(lib/claude-client.ts)도 같은 목록으로
// 모든 본문 칸을 검사한다. 두 파이프라인 모두 권유 표현은 마지막 시도에서도 막는다(F02의 예외 — 준법은 발송보다 앞선다).

export const INVESTMENT_ADVICE_PATTERNS: readonly RegExp[] = [
  /강력\s*매수/,
  /무조건/,
  /지금\s*사/,
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

/** 글에서 찾은 권유 표현의 실제 문구(패턴마다 첫 일치 하나). 없으면 빈 배열. */
export function findInvestmentAdvice(text: string): string[] {
  const found: string[] = []
  for (const pattern of INVESTMENT_ADVICE_PATTERNS) {
    const m = pattern.exec(text)
    if (m) found.push(m[0])
  }
  return found
}
