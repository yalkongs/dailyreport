// lib/temporal-consistency.ts
//
// R2 (2026-07-22): 날짜-요일-상대시제 정합 검사·교정. market·ETF 공유.
// 발행본에서 "내일(07/23, 목)"(발행일 07/21 화 기준 07/23은 모레) 같은 모순이 실증됨.
//
// 원칙: **날짜를 앵커로 신뢰**한다(Claude는 날짜를 캘린더 데이터에서 복사하므로 가장
// 신뢰도 높음). 날짜로부터 요일·상대어(오늘/내일/모레 = +0/+1/+2 캘린더일)를 재계산해
// 불일치 토큰을 soft fix로 교정한다. 창(발행일 −3~+14일) 밖 날짜(비상식)나 상대어가
// +0/+1/+2 어디에도 안 맞는 조합(예: "내일(07/28)")은 교정 불가 → hard violation.
//
// 적용은 JSON 문자열 레벨에서 이뤄지므로(호출부에서 JSON.stringify(report) 전달),
// 교정 문자열이 JSON 메타문자(" \)를 포함하지 않음을 assertJsonSafe로 보장한다.
// 교정 대상은 한글·숫자·/·(),·요일 문자뿐이라 원리적으로 안전하나 안전망을 둔다.

import { koreanWeekday } from './market-calendar'

export interface TemporalCheckResult {
  fixed: string
  softFixes: string[]
  violations: string[]
}

const OFFSET_TO_REL: Record<number, string> = { 0: '오늘', 1: '내일', 2: '모레' }

// 발행일 기준 신뢰 창(캘린더일). 상대어가 이 밖을 가리키면 비상식으로 본다.
const WINDOW_MIN = -3
const WINDOW_MAX = 14

function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

// (월,일) + 발행일 → 발행일에 가장 가까운 실제 날짜. 연도 경계(12월↔1월)를 위해
// 발행연도 ±1 후보를 비교해 절대 gap이 최소인 후보를 앵커로 삼는다.
function resolveAnchorDate(
  month: number,
  day: number,
  reportDate: string
): { date: string; gap: number } {
  const reportYear = Number(reportDate.slice(0, 4))
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  let best: { date: string; gap: number } | null = null
  for (const y of [reportYear - 1, reportYear, reportYear + 1]) {
    const date = `${y}-${mm}-${dd}`
    const gap = calendarDaysBetween(reportDate, date)
    if (best === null || Math.abs(gap) < Math.abs(best.gap)) best = { date, gap }
  }
  return best as { date: string; gap: number }
}

function assertJsonSafe(s: string): void {
  if (/["\\]/.test(s)) {
    throw new Error(`[temporal-consistency] 교정 문자열에 JSON 메타문자 포함: ${s}`)
  }
}

// 패턴 A: 상대어 + (M/D, 요일)  예) "내일(07/23, 목)"
const PATTERN_A = /(오늘|내일|모레)\s*\(\s*(\d{1,2})\/(\d{1,2})\s*[,·]?\s*([월화수목금토일])\s*\)/g
// 패턴 B: 상대어 없는 (M/D)(요일)  예) "07/23(목)"
const PATTERN_B = /(\d{1,2})\/(\d{1,2})\s*\(\s*([월화수목금토일])\s*\)/g

export function checkAndFixTemporal(text: string, reportDate: string): TemporalCheckResult {
  const softFixes: string[] = []
  const violations: string[] = []

  let fixed = text.replace(PATTERN_A, (match, rel: string, mm: string, dd: string, wd: string) => {
    const { date, gap } = resolveAnchorDate(Number(mm), Number(dd), reportDate)
    if (gap < WINDOW_MIN || gap > WINDOW_MAX) {
      violations.push(`상대시제-날짜 창 밖: "${match}" — ${date}는 발행일(${reportDate}) 기준 ${gap}일`)
      return match
    }
    const expectedRel = OFFSET_TO_REL[gap]
    if (expectedRel === undefined) {
      // 창 안이지만 오늘/내일/모레(+0/+1/+2)로 지칭 불가 — 교정 불능
      violations.push(`상대시제 불능: "${match}" — ${date}는 발행일 기준 ${gap}일이라 오늘/내일/모레로 지칭 불가`)
      return match
    }
    const expectedWd = koreanWeekday(date)
    let corrected = match
    const changes: string[] = []
    if (rel !== expectedRel) {
      // 상대어는 토큰 선두이므로 접두만 교체(원문 공백·구두점 보존)
      corrected = expectedRel + corrected.slice(rel.length)
      changes.push(`${rel}→${expectedRel}`)
    }
    if (wd !== expectedWd) {
      // 요일 치환은 여는 괄호 이후로 한정 — 상대어 "내일"이 요일 문자 '일'을 포함하므로
      // 토큰 전체 replace는 "내일(08/01, 일)"→"내토(…)" 오염을 일으킨다.
      const parenIdx = corrected.indexOf('(')
      corrected = corrected.slice(0, parenIdx) + corrected.slice(parenIdx).replace(wd, expectedWd)
      changes.push(`요일 ${wd}→${expectedWd}`)
    }
    if (changes.length === 0) return match
    assertJsonSafe(corrected)
    softFixes.push(`시점 교정 [${mm}/${dd}]: ${changes.join(', ')}`)
    return corrected
  })

  fixed = fixed.replace(PATTERN_B, (match, mm: string, dd: string, wd: string) => {
    const { date } = resolveAnchorDate(Number(mm), Number(dd), reportDate)
    const expectedWd = koreanWeekday(date)
    if (wd === expectedWd) return match
    const corrected = match.replace(wd, expectedWd)
    assertJsonSafe(corrected)
    softFixes.push(`요일 교정 [${mm}/${dd}]: ${wd}→${expectedWd}`)
    return corrected
  })

  return { fixed, softFixes, violations }
}
