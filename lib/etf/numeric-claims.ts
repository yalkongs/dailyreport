// lib/etf/numeric-claims.ts
// C01·C04 (2026-10-16 감사): 본문의 "대상 + 등락률" 주장을 실제 데이터와 대조한다.
//  - C01: ETF 등락(KODEX 200 -6.25%)을 지수 등락(코스피 -5.46%)으로 부른 문장
//  - C04: 같은 ETF의 카드 수치(-3.96%)와 본문 수치(-8%대)가 다른 문장
//
// 오탐이 재생성·축소판 발송으로 이어지므로 보수적으로 판정한다. 같은 문장에서 대상과 수치가 가깝게
// 붙어 있고(사이에 다른 수치 없음), 괴리율·금리·거래대금 같은 다른 지표 문맥이 아닐 때만 대조한다.
import type { EtfQuote, IndexQuote } from './types'

interface Entity {
  label: string
  pattern: RegExp
  value: number | null // null = 실측 없음(지수) → 수치를 쓰면 위반
}

interface Mention { start: number; end: number; entity: Entity }

export interface NumericClaim {
  start: number
  end: number
  value: number
  sign: -1 | 1 | 0
  decimals: number // 표기된 소수 자릿수 — 허용오차를 정한다
  mode: 'exact' | 'band' | 'atLeast' | 'atMost' | 'approx'
}
type Claim = NumericClaim

/** 대상(ETF·지수)과 짝지어진 등락률 주장 하나. actual = 대상의 실측(없으면 null). */
export interface PairedClaim {
  label: string
  actual: number | null
  quoted: string
  claim: NumericClaim
}

/** 'exact' 모드 허용오차(표기 소수 자릿수 → %p). */
export type ExactTolerance = (decimals: number) => number

// 파이프라인 게이트 기본값 — 오탐이 재생성·축소판 발송으로 이어지므로 넉넉하다.
const PIPELINE_TOLERANCE: ExactTolerance = d => (d >= 2 ? 0.03 : d === 1 ? 0.1 : 0.6)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 지수명 — 코스피200·코스닥150·나스닥100은 다른 지수라 제외하고, 'TIGER 미국S&P500'처럼 상품명 안에
// 붙은 지수명도 제외한다.
const INDEX_NAME_PATTERNS: Array<{ nameKo: string; pattern: RegExp }> = [
  { nameKo: '코스피', pattern: /(?<![가-힣A-Za-z])코스피(?!\s?200)/g },
  { nameKo: '코스닥', pattern: /(?<![가-힣A-Za-z])코스닥(?!\s?150)/g },
  { nameKo: 'S&P500', pattern: /(?<![가-힣A-Za-z])S&P\s?500/g },
  { nameKo: '나스닥', pattern: /(?<![가-힣A-Za-z])나스닥(?!\s?100)/g },
  { nameKo: '다우', pattern: /(?<![가-힣])다우(?:존스|지수)?/g },
  { nameKo: '필라델피아 반도체지수', pattern: /필라델피아\s?반도체(?:지수)?/g },
]

// 국내 ETF 이름 뒤는 공백·괄호·구두점·조사여야 한다('KODEX 200선물인버스2X'를 'KODEX 200'으로 읽지 않게).
const JOSA = '(?:은|는|이|가|와|과|의|도|를|을|로|으로|에|에서|만|보다|까지|처럼|조차|마저|이나|나|라는|이라는)'
const KR_NAME_END = `(?=\\s|\\(|[,.·/)\\]]|$|${JOSA}(?![가-힣]))`

function buildEntities(quotes: EtfQuote[], indices: IndexQuote[] | undefined): Entity[] {
  const entities: Entity[] = []
  for (const q of quotes) {
    if (q.changePercent === null || q.changePercent === undefined || !Number.isFinite(q.changePercent)) continue
    if (q.market === 'KR') {
      entities.push({ label: q.name, pattern: new RegExp(`${escapeRe(q.name)}${KR_NAME_END}`, 'g'), value: q.changePercent })
    } else {
      entities.push({ label: q.ticker, pattern: new RegExp(`(?<![A-Za-z])${escapeRe(q.ticker)}(?![A-Za-z])`, 'g'), value: q.changePercent })
    }
  }
  for (const idx of INDEX_NAME_PATTERNS) {
    const found = indices?.find(i => i.nameKo === idx.nameKo)
    entities.push({ label: idx.nameKo, pattern: idx.pattern, value: found?.changePercent ?? null })
  }
  return entities
}

function findMentions(sentence: string, entities: Entity[]): Mention[] {
  const all: Mention[] = []
  for (const entity of entities) {
    entity.pattern.lastIndex = 0
    for (const m of sentence.matchAll(entity.pattern)) {
      all.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, entity })
    }
  }
  // 긴 이름 우선(‘KODEX 200선물인버스2X’ 안의 ‘KODEX 200’ 제외), 겹치는 짧은 매치는 버린다.
  all.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const kept: Mention[] = []
  for (const m of all) {
    if (!kept.some(k => m.start < k.end && k.start < m.end)) kept.push(m)
  }
  return kept.sort((a, b) => a.start - b.start)
}

const CLAIM_RE = /([+\-−])?\s?(\d+(?:\.\d+)?)\s?%(?!\s?p)(\s*대)?(\s*(?:넘게|이상|가까이|안팎|남짓|이하|미만))?/g
// 방향어(수치 뒤 12자 안). 2026-10-24: 가장 가까운 방향어로 판정한다 — 예전엔 하락어를 먼저 찾아 'TLT 1.87% 상승은 …
// 금리 하락'처럼 뒤따르는 다른 대상의 하락어를 집었다(10/23 거짓 위반). 활용형(오르며·내리며 등)도 더했다.
const NEG_WORD = /하락|내려|내린|내렸|내리|밀려|밀린|밀리|밀렸|급락|빠져|빠진|빠지|떨어|낙폭|약세|주저앉|내려앉|후퇴|꺾/
const POS_WORD = /상승|올라|오른|올랐|오르|급등|반등|강세|뛰/
const DIRECTION_WINDOW = 12

// 방향어 바로 앞이 다른 지표("금리 하락", "환율이 올라")면 그 방향어는 이 수치의 것이 아니다.
const OTHER_SUBJECT_BEFORE = /(?:금리|환율|달러|원화|엔화|유가|국채|수익률|물가)\s*(?:이|가|은|는|의|도)?\s*$/

/** 수치 바로 뒤(12자 안)에서 가장 먼저 나오는 이 수치의 방향어 부호. 다른 지표에 붙은 방향어는 건너뛴다. 없으면 0. */
function directionAfter(after: string): -1 | 1 | 0 {
  const head = after.slice(0, DIRECTION_WINDOW + 4)
  const hits: Array<{ at: number; sign: -1 | 1 }> = []
  for (const [re, sign] of [[NEG_WORD, -1], [POS_WORD, 1]] as const) {
    for (const m of head.matchAll(new RegExp(re.source, 'g'))) {
      const at = m.index ?? 0
      if (at > DIRECTION_WINDOW) continue
      if (OTHER_SUBJECT_BEFORE.test(head.slice(0, at))) continue
      hits.push({ at, sign })
    }
  }
  hits.sort((a, b) => a.at - b.at)
  return hits[0]?.sign ?? 0
}
// 등락률이 아닌 다른 지표 문맥 — 대상과 수치 사이에 있으면 대조하지 않는다.
// 가정·조건·미래 관찰("3% 이상 반등하면", "2% 넘게 밀릴 경우", "반등할지")은 사실 주장이 아니다.
const CONDITIONAL_AFTER = /^.{0,16}?(하면|되면|이면|다면|라면|으면|면서도|할\s*경우|될\s*경우|일\s*경우|할\s*때|일\s*때|할지|될지|인지|넘어서면|벌어지면|좁혀지면|돌파|이내라면|시\s)/
const OTHER_METRIC = /괴리|보수|비중|금리|확률|점유|물가|CPI|성장률|실업률|목표|지수대비|예상|컨센서스|전망|배당|이자|할인|프리미엄|거래대금|거래량|순자산|시가총액|AUM|NAV|변동성|수익률\s*목표/

function findClaims(sentence: string): Claim[] {
  const claims: Claim[] = []
  for (const m of sentence.matchAll(CLAIM_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const value = Number(m[2])
    const after = sentence.slice(end)
    let sign: -1 | 1 | 0 = m[1] ? (m[1] === '+' ? 1 : -1) : 0
    if (sign === 0) sign = directionAfter(after)
    const suffix = (m[4] ?? '').trim()
    const approxBefore = /약\s*$/.test(sentence.slice(Math.max(0, start - 3), start))
    const mode: Claim['mode'] = m[3] ? 'band'
      : suffix === '넘게' || suffix === '이상' ? 'atLeast'
      : suffix === '이하' || suffix === '미만' ? 'atMost'
      : suffix || approxBefore ? 'approx'
      : 'exact'
    claims.push({ start, end, value, sign, decimals: m[2].includes('.') ? m[2].split('.')[1].length : 0, mode })
  }
  return claims
}

/**
 * 주장이 실측과 맞는가. 방향어·부호가 있으면 방향도 본다. exactTolerance는 'exact' 모드에만 쓴다
 * (기본 = 파이프라인 게이트 값, 발행물 검사는 표기 반올림만 허용하는 더 엄격한 값을 넘긴다).
 */
export function claimMatches(c: NumericClaim, actual: number, exactTolerance: ExactTolerance = PIPELINE_TOLERANCE): boolean {
  // 보합 근처(±0.05% 미만)의 부호 차이는 반올림 소음으로 본다.
  if (c.sign !== 0 && Math.abs(actual) >= 0.05 && Math.sign(actual) !== c.sign) return false
  const a = Math.abs(actual)
  switch (c.mode) {
    case 'band': return Math.floor(a) === Math.floor(c.value)
    case 'atLeast': return a >= c.value
    case 'atMost': return a <= c.value
    case 'approx': return Math.abs(a - c.value) <= 1.0
    // 표기 자릿수만큼의 반올림·내림을 허용한다(7.57%를 '7.5%'로 쓴 정도는 재생성 사유가 아니다).
    default: return Math.abs(a - c.value) <= exactTolerance(c.decimals)
  }
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?=\s|$)|\n+/).map(s => s.trim()).filter(Boolean)
}

const MAX_GAP = 40 // 대상 끝 ~ 수치 시작 최대 거리

// 대상과 수치 사이에 쉼표·다른 티커·새 주어("헬스케어·필수소비재는")가 끼면 수치는 다른 대상의 것이다.
function introducesOtherSubject(gap: string): boolean {
  if (/[,，]/.test(gap)) return true
  if (/[A-Z]{2,5}/.test(gap)) return true
  const rest = gap.replace(/^\s*\(\d{6}\)/, '').replace(new RegExp(`^${JOSA}`), '')
  return /[가-힣·]{2,}(?:은|는|이|가)\s/.test(rest)
}

/**
 * 문장마다 대상(ETF 이름·티커, 지수명)과 바로 뒤 등락률 수치를 짝짓는다 — 판정은 하지 않는다.
 * 다른 지표 문맥·가정문·다른 주어가 끼면 짝을 만들지 않는다(보수적).
 */
export function extractNumericClaims(text: string, quotes: EtfQuote[], indices: IndexQuote[] | undefined): PairedClaim[] {
  const entities = buildEntities(quotes, indices)
  const out: PairedClaim[] = []
  for (const sentence of splitSentences(text)) {
    const mentions = findMentions(sentence, entities)
    if (mentions.length === 0) continue
    const claims = findClaims(sentence)
    for (let ci = 0; ci < claims.length; ci++) {
      const claim = claims[ci]
      const prevEnd = ci > 0 ? claims[ci - 1].end : 0
      const clause = mentions.filter(m => m.start >= prevEnd && m.end <= claim.start)
      if (clause.length === 0) continue
      const last = clause[clause.length - 1]
      const gap = sentence.slice(last.end, claim.start)
      if (gap.length > MAX_GAP || OTHER_METRIC.test(gap)) continue
      if (introducesOtherSubject(gap)) continue
      if (CONDITIONAL_AFTER.test(sentence.slice(claim.end))) continue

      // "A와 B가 각각 X%" → 둘 다, "각각 X%, Y%" → 순서대로 짝짓기
      let pairs: Array<[Mention, Claim]> = [[last, claim]]
      if (clause.length >= 2 && /각각/.test(gap)) {
        const run = [claim]
        while (ci + run.length < claims.length) {
          const next = claims[ci + run.length]
          if (!/^[\s,·와과및/]{0,4}$/.test(sentence.slice(run[run.length - 1].end, next.start))) break
          run.push(next)
        }
        if (run.length === clause.length) {
          pairs = clause.map((m, i) => [m, run[i]] as [Mention, Claim])
          ci += run.length - 1
        } else if (run.length === 1) {
          pairs = clause.map(m => [m, claim] as [Mention, Claim])
        } else {
          continue // 짝이 안 맞으면 판정 보류
        }
      }

      for (const [m, c] of pairs) {
        out.push({ label: m.entity.label, actual: m.entity.value, quoted: sentence.slice(c.start, c.end).trim(), claim: c })
      }
    }
  }
  return out
}

export function findNumericClaimMismatches(text: string, quotes: EtfQuote[], indices: IndexQuote[] | undefined): string[] {
  const mismatches: string[] = []
  for (const p of extractNumericClaims(text, quotes, indices)) {
    if (p.actual === null) {
      mismatches.push(`${p.label} ${p.quoted} — 지수 실측 없음`)
    } else if (!claimMatches(p.claim, p.actual)) {
      mismatches.push(`${p.label} ${p.quoted} — 실제 ${p.actual >= 0 ? '+' : ''}${p.actual.toFixed(2)}%`)
    }
  }
  return [...new Set(mismatches)]
}
