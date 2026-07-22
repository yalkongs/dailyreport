// lib/quotable-sources.ts
//
// R3 (2026-07-22): 출처 인용 화이트리스트. market·ETF 공유.
// 발행본에서 "Crypto Briefing과 finance.biggo.com 등 외신에 따르면"이 그날 핵심 논거의
// 근거로 인용된 사례 실증. 이름 인용이 허용되는 매체를 화이트리스트로 두고, 그날 수집된
// 뉴스 source 중 화이트리스트에 없는 이름의 인용 프레임을 "외신"으로 치환한다.
//
// **오탐 없음 원칙**: 임의 정규식으로 매체명을 추측하지 않는다. 치환 대상은 오직 그날
// 실제 수집된 소스 목록(todaySources) 중 비승인 이름뿐이다.
// 치환 문자열은 상수("외신 …")라 JSON 메타문자(" \)를 포함하지 않는다.

export const QUOTABLE_SOURCES: string[] = [
  // 국내 통신·경제지
  '연합뉴스', '연합인포맥스', '한국경제', '매일경제', '서울경제', '머니투데이',
  '이데일리', '아시아경제', '헤럴드경제', '조선비즈', '파이낸셜뉴스', '블로터', '전자신문',
  // 해외 주요 매체
  '로이터', 'Reuters', '블룸버그', 'Bloomberg', '월스트리트저널', 'WSJ',
  '파이낸셜타임스', 'Financial Times', 'CNBC', '니혼게이자이', '닛케이',
]

export interface SourceFixResult {
  fixed: string
  softFixes: string[] // 치환된 프레임 설명(로깅용)
  warnings: string[] // 프레임 밖에 남은 비승인 이름(soft-warn 로깅용)
}

function isQuotable(source: string): boolean {
  return QUOTABLE_SOURCES.some(w => source.includes(w))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assertJsonSafe(s: string): void {
  if (/["\\]/.test(s)) {
    throw new Error(`[quotable-sources] 치환 문자열에 JSON 메타문자 포함: ${s}`)
  }
}

/**
 * 그날 수집된 뉴스 source 중 화이트리스트에 없는 이름의 인용 프레임을 "외신"으로 치환.
 * - `{name} 등 외신에 따르면` / `{n1}과 {n2} 등 외신에 따르면` → `외신에 따르면`
 * - `{name}에 따르면` / `{name} 보도에 따르면` → `외신 보도에 따르면`
 * - `{name}이|가 전한` → `외신이 전한`
 * 프레임 밖에 남은 비승인 이름은 warnings에 담아 반환(치환하지 않음 — 오탐 방지).
 */
export function softFixUnquotableSources(text: string, todaySources: string[]): SourceFixResult {
  const softFixes: string[] = []
  const warnings: string[] = []

  // 비승인 이름만 추림(중복 제거, 긴 이름 우선 매칭)
  const unapproved = [...new Set(todaySources)]
    .filter(s => s.trim().length > 0 && !isQuotable(s))
    .sort((a, b) => b.length - a.length)
  if (unapproved.length === 0) return { fixed: text, softFixes, warnings }

  const nameAlt = unapproved.map(escapeRegex).join('|')
  let fixed = text

  // 1) 복합 나열 정리: (비승인이름 [등/과/와/,·])+ 가 "외신" 바로 앞에 오면 통째로 제거.
  const compound = new RegExp(`(?:(?:${nameAlt})\\s*(?:등|[과와,·])\\s*)+(?=외신)`, 'g')
  fixed = fixed.replace(compound, m => {
    softFixes.push(`복합 출처 나열 → 외신: "${m.trim()}"`)
    return ''
  })

  // 2) 단일 프레임 치환
  const frames: Array<{ re: RegExp; to: string; label: string }> = [
    { re: new RegExp(`(?:${nameAlt})\\s*보도에\\s*따르면`, 'g'), to: '외신 보도에 따르면', label: '보도에 따르면' },
    { re: new RegExp(`(?:${nameAlt})에\\s*따르면`, 'g'), to: '외신 보도에 따르면', label: '에 따르면' },
    { re: new RegExp(`(?:${nameAlt})\\s*(?:이|가)\\s*전한`, 'g'), to: '외신이 전한', label: '전한' },
  ]
  for (const { re, to, label } of frames) {
    assertJsonSafe(to)
    fixed = fixed.replace(re, m => {
      softFixes.push(`비승인 출처 프레임(${label}) → ${to}: "${m.trim()}"`)
      return to
    })
  }

  // 3) 프레임 밖에 남은 비승인 이름은 soft-warn(치환하지 않음)
  const remaining = new RegExp(`(?:${nameAlt})`, 'g')
  const leftover = new Set(fixed.match(remaining) ?? [])
  for (const name of leftover) warnings.push(name)

  return { fixed, softFixes, warnings }
}

/** 리포트 전체에서 "에 따르면" 인용 프레임 빈도. 8회 이상 hard, 5회 이상 soft-warn 기준. */
export function countCitationPhrases(text: string): number {
  return (text.match(/에\s*따르면/g) ?? []).length
}
