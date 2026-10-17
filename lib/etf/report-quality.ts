// lib/report-quality.ts
//
// P1 (2026-04-24): Validator 2단계 재설계.
//
// 기존 구조는 어휘 블랙리스트 매칭으로 통과/실패만 판정 → Tier 2로 출력량이
// 커지자 오탐이 잦아져 재시도 3회도 부족해지는 사고(4/24) 발생. 근본 원인은
// "문체 힌트"와 "투자 권유 단속"이 한 바구니에 섞여 있었다는 것.
//
// 새 구조:
//   1) Soft fix (자동 교정) — 문체 레벨 이슈. 재생성 없이 치환으로 해결.
//   2) Hard validation (재생성 사유) — 실제 투자 권유·사실 오류·포맷 위반 등만.
//
// 외부 API는 하위 호환 — validateMorningReportQuality 는 그대로 유지하되
// 내부에서 applySoftFixesInPlace 를 먼저 호출해 검증 직전에 자동 교정을 적용.
// 외부 호출자(claude-client, run-etf)는 기존 호출만으로 새 구조의 이점을 얻음.

import { findNumericClaimMismatches } from './numeric-claims'
import type { CollectedData, MorningReport, MorningStrategyInput } from './types'
// 2026-10-17 출력 스키마 개편: 자산군 카드 key·카드 key는 코드가 확정한 슬롯 안에서만.
import { buildAssetClassSlots, findTacticalAlert, pickFeaturedSlot, TACTICAL_WARNING_MIN_ABS_PCT } from './asset-classes'
// Ruling 15: 미리보기 카드 문구는 카드 렌더러와 같은 규칙으로 발행 전에 판정한다.
import { cardTextFits } from '../preview/data-card'
// 정합성 검사 (2026-07-22): R2 시점 / R3 출처 인용. (R1 Characters 카드-산문 정합은 스키마 개편으로 제거)
import { checkAndFixTemporal } from '../temporal-consistency'
import { softFixUnquotableSources, countCitationPhrases } from '../quotable-sources'

// ─── Hard patterns: 진짜 투자 권유 ─────────────────────────────────────
const INVESTMENT_ADVICE_PATTERNS = [
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

const FLOW_WORD_PATTERNS = [
  /자금\s*유입/,
  /자금\s*유출/,
  /순유입/,
  /순유출/,
  /flow/i,
  /fund\s*flow/i,
]

// 뉴스 단정 — "시장에서는 X를 예상한다" 같은 출처 없는 의견 전달만 남김
const NEWS_OVERREACH_PATTERNS = [
  /시장에서는\s*[^.!?]{0,40}(예상|전망|기대|관측|점치)/,
]

// ─── Soft fixes: 문체 레벨, 자동 치환 ─────────────────────────────────
// 치환 후에도 의미 변화가 없거나 더 자연스러운 표현만 등록.
type SoftFix = { pattern: RegExp; replace: string }
const SOFT_FIXES: SoftFix[] = [
  // 조사 오류
  { pattern: /ETF은\b/g, replace: 'ETF는' },

  // 약한 관찰 어미 — 더 자연스러운 서술어로
  { pattern: /가능성이\s*존재합니다/g, replace: '여지가 남아 있습니다' },
  { pattern: /가능성이\s*있습니다/g, replace: '여지가 있습니다' },
  { pattern: /구조입니다/g, replace: '흐름입니다' },
  { pattern: /시사합니다/g, replace: '말해 줍니다' },
  { pattern: /나타냅니다/g, replace: '드러냅니다' },
  { pattern: /판단됩니다/g, replace: '읽힙니다' },
  // "보입니다" 는 복합어(엿보입니다 등) 에는 붙이지 않도록 경계문자 사용
  { pattern: /(?<![가-힣])보입니다/g, replace: '관측됩니다' },
  { pattern: /직접\s*연결됩니다/g, replace: '이어집니다' },
  { pattern: /확인이\s*필요합니다/g, replace: '확인 지점입니다' },
  { pattern: /주목해야\s*합니다/g, replace: '눈여겨볼 지점입니다' },

  // 출처 없는 단정 → 중립 서술로
  { pattern: /보도에\s*따르면/g, replace: '보도 기준' },
  { pattern: /기사에\s*따르면/g, replace: '기사 기준' },
  { pattern: /전문가들은/g, replace: '관측 주체들은' },

  // "확실히 확인됩니다" 같은 중립 맥락의 잉여 수식어 제거
  { pattern: /확실히\s+(확인|점검|관측)/g, replace: '$1' },

  // 준법성 안내문 — 리포트 문장은 관찰 어조, "주의하시기 바랍니다" 는 정리
  { pattern: /투자에\s*주의하시기\s*바랍니다/g, replace: '점검 대상으로 남겨 둡니다' },
]

const UNFORMATTED_USD_KRW_PATTERN = /USD\/KRW\s+(?:1[0-9]{3}|[2-9][0-9]{3})(?![,\d])/g
const RAW_KRW_AMOUNT_PATTERN = /\d{10,}원/g

// 미리보기 카드 한 줄(card.line): 32자 이내 평서문. 질문형 = 물음표가 있거나 의문형 어미로 끝나는 문장
// ("~까/~까요"(을까·할까·습니까 포함), "~나요", "~는가", "~인가").
export const CARD_LINE_MAX_CHARS = 32
const QUESTION_FORM = /[?？]|(?:까요?|나요|는가|인가)[.!…]?\s*$/

// ─── Soft fix: 리포트 전체 문자열 필드에 치환 적용 ──────────────────
function applySoftFix(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value
  let next = value
  for (const { pattern, replace } of SOFT_FIXES) {
    next = next.replace(pattern, replace)
  }
  return next
}

// 형식이 깨진 응답(배열 아님·원소가 객체 아님)에서도 던지지 않도록 객체 원소만 고른다.
function objectItems<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'object' && item !== null) : []
}

/**
 * P1: 검증 직전에 호출해 문체 이슈를 자동 치환.
 * in-place 수정 + 적용된 치환 목록 반환 (로깅용).
 */
export function applySoftFixesInPlace(report: MorningReport): string[] {
  const before = flattenMorningReport(report)
  const fixed: string[] = []

  if (report.cover) {
    report.cover.headline = applySoftFix(report.cover.headline) ?? report.cover.headline
    report.cover.subline = applySoftFix(report.cover.subline) ?? report.cover.subline
  }
  if (report.summary) {
    report.summary.overseas = applySoftFix(report.summary.overseas) ?? report.summary.overseas
    report.summary.domestic = applySoftFix(report.summary.domestic) ?? report.summary.domestic
    report.summary.focus = applySoftFix(report.summary.focus) ?? report.summary.focus
  }
  for (const card of objectItems(report.assetCards)) {
    if (card.reason !== undefined) card.reason = applySoftFix(card.reason)
    card.ifHolding = applySoftFix(card.ifHolding) ?? card.ifHolding
    card.ifConsidering = applySoftFix(card.ifConsidering) ?? card.ifConsidering
  }
  for (const check of objectItems(report.todayChecks)) {
    check.time = applySoftFix(check.time) ?? check.time
    check.what = applySoftFix(check.what) ?? check.what
    check.baseline = applySoftFix(check.baseline) ?? check.baseline
    check.invalidation = applySoftFix(check.invalidation) ?? check.invalidation
  }
  if (report.card) {
    report.card.line = applySoftFix(report.card.line) ?? report.card.line
  }
  if (report.tacticalWarning !== undefined) {
    report.tacticalWarning = applySoftFix(report.tacticalWarning)
  }

  const after = flattenMorningReport(report)
  if (before !== after) {
    for (const { pattern } of SOFT_FIXES) {
      if (pattern.test(before) && !pattern.test(after)) {
        fixed.push(pattern.source)
      }
    }
  }
  return fixed
}

// 산문 필드 전부 — 수치 대조·주간·환율 방향·준법 패턴·중복 문장 검사가 이 텍스트에 적용된다.
// key 같은 열거값은 산문이 아니라 뺀다. skipShortFields: 중복 문장 검사용 — todayChecks의 time·baseline은
// "전일 종가" 같은 짧은 기준 문구라 항목끼리 같아도 정상이다.
function flattenMorningReport(report: MorningReport, options: { includeCover?: boolean; skipShortFields?: boolean } = {}): string {
  const includeCover = options.includeCover ?? true
  const skipShort = options.skipShortFields ?? false
  const core: unknown[] = [
    ...(includeCover ? [report.cover?.headline, report.cover?.subline] : []),
    report.summary?.overseas,
    report.summary?.domestic,
    report.summary?.focus,
    ...objectItems(report.assetCards).flatMap(card => [card.reason, card.ifHolding, card.ifConsidering]),
    ...objectItems(report.todayChecks).flatMap(check => (skipShort
      ? [check.what, check.invalidation]
      : [check.time, check.what, check.baseline, check.invalidation])),
    report.card?.line,
    report.tacticalWarning,
  ]
  return core.filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n')
}

function findMatches(text: string, patterns: RegExp[]): string[] {
  return patterns.filter(p => p.test(text)).map(p => p.source)
}

function splitSentences(text: string): string[] {
  // P1+보강 (2026-04-24): 기존 /[^.!?\n]+[.!?]?/ 는 "-0.39" 의 decimal period
  // 에서 문장을 잘라 "S&P500 -0." 같은 단편이 중복으로 오인됨. 문장 경계는
  // .!? **다음이 공백/줄바꿈/문자열 끝** 일 때만 인정.
  return text
    .split(/(?<=[.!?])(?=\s|$)|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// C02 (2026-10-16 감사): 원/달러 상승(원화 약세)은 환노출 해외 ETF의 원화 환산 성과에 플러스다.
// "원화 약세 → 환율 손실이 수익을 상쇄" 같은 반대 방향 서술을 잡는다. 같은 문장에 원화 강세·반전이
// 함께 나오면(높은 환율에서 진입한 뒤 원화가 강해질 위험) 정상 서술이므로 통과시킨다.
const FX_LOSS_WORDS = /환율\s*손실|환손실|환차손|환산\s*손실|깎|상쇄/
const FX_REVERSAL_WORDS = /원화\s*강세|강세로|반전|되돌|돌아서/
export function findFxDirectionErrors(text: string): string[] {
  const errors: string[] = []
  for (const sentence of splitSentences(text)) {
    const wrong = /환율이?\s*깎/.test(sentence) ||
      (/원화\s*약세/.test(sentence) && FX_LOSS_WORDS.test(sentence) && !FX_REVERSAL_WORDS.test(sentence))
    if (wrong) errors.push(sentence.length > 80 ? `${sentence.slice(0, 80)}…` : sentence)
  }
  return errors
}

// C05 (2026-10-16 감사): ETF 입력의 등락률은 모두 1일 기준이다. "이번 주 KODEX 반도체 -11.94%"처럼
// 하루 수익률을 주간 수익률로 쓰는 문장을 잡는다(부호 있는 %나 방향어가 붙은 %만 — 예상치 등은 제외).
const WEEK_WORDS = /이번\s*주|금주|한\s*주\s*(?:간|동안)?|주간/
const DIRECTIONAL_PERCENT = /[+\-−]\s?\d+(?:\.\d+)?%|\d+(?:\.\d+)?%\s*(?:대\s*)?(?:하락|상승|급락|급등|내려|올라|밀려|빠져|반등)/
export function findWeeklyReturnClaims(text: string): string[] {
  return splitSentences(text)
    .filter(s => WEEK_WORDS.test(s) && DIRECTIONAL_PERCENT.test(s))
    .map(s => (s.length > 80 ? `${s.slice(0, 80)}…` : s))
}

function duplicateSentences(text: string): string[] {
  // P1+보강 [M2] (2026-04-24): 중복 검출 하한 18자 → 14자.
  // Story Spine 1막과 간밤 시장 요약이 동일 문장을 반복 출력하는 사례 대응.
  // 단, splitSentences 가 "97%, SLV -2." 같은 데이터 단편을 별개 sentence로
  // 잘라낼 때 오탐 위험이 있음. 한글 4자 이상 포함된 sentence(즉, 실제 산문)
  // 만 카운트해 데이터 fragment 오탐 방지.
  const counts = new Map<string, number>()
  for (const sentence of splitSentences(text)) {
    const normalized = sentence.replace(/\s+/g, ' ').trim()
    if (normalized.length < 14) continue
    const koreanChars = (normalized.match(/[가-힣]/g) ?? []).length
    if (koreanChars < 4) continue // 데이터 fragment (수치·티커만) 제외
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([sentence]) => sentence)
}

// P3 보강: "지수"·"시장" 단독 사용 시 한국 독자가 KOSPI로 오해할 위험 차단.
// 아래 "애매어" 가 명시적 시장 수식어 없이 등장하면 하드 위반 처리.
const AMBIGUOUS_INDEX_WORD_PATTERN =
  /(?<![가-힣A-Za-z])지수(?![A-Za-z0-9가-힣])|(?<![가-힣A-Za-z])증시(?![A-Za-z0-9가-힣])|(?<![가-힣A-Za-z])시장(?![A-Za-z0-9가-힣])/g

const MARKET_QUALIFIER_WINDOW = 20 // 애매어 앞뒤 20자 이내에 시장 수식어 있어야 함
const MARKET_QUALIFIER_PATTERN =
  /S&P500|S&P\s*500|나스닥|NASDAQ|다우|DOW|러셀|Russell|코스피|코스닥|KOSPI|KOSDAQ|미\s*증시|국내\s*증시|미국\s*증시|한국\s*증시|야간\s*환시|신흥국|선진국|글로벌|아시아|유럽|중국|일본|홍콩|대만|시장\s*국면|채권\s*시장|외환\s*시장|이상\s*탐지\s*시장/

function findUnqualifiedAmbiguousWords(text: string): string[] {
  const hits: string[] = []
  for (const match of text.matchAll(AMBIGUOUS_INDEX_WORD_PATTERN)) {
    const idx = match.index ?? 0
    const start = Math.max(0, idx - MARKET_QUALIFIER_WINDOW)
    const end = Math.min(text.length, idx + match[0].length + MARKET_QUALIFIER_WINDOW)
    const window = text.slice(start, end)
    if (!MARKET_QUALIFIER_PATTERN.test(window)) {
      hits.push(`…${window.replace(/\n/g, ' ').trim()}…`)
    }
  }
  return [...new Set(hits)]
}

const AMBIGUOUS_SAMPLE_LIMIT = 3 // 로그·위반 메시지에 노출할 표본 수

/**
 * '지수/증시/시장' 단독 표기 판정. 적용 범위 (2026-09-21):
 *  - 커버(헤드라인·서브라인): 독자가 가장 먼저 보는 자리 — 한 건이라도 hard violation.
 *  - 본문: 기록 전용. 문맥상 오해 여지가 없는 자연스러운 표현("해외 지수 추종 ETF",
 *    "시장 주도권", "지수 상승분")까지 기각해 1회차 실패 68%·서사 없는 축소판 발송 28%를
 *    만들던 '3회 이상 hard' 분기를 없앴다. 건수는 로그로 남겨 추후 점검한다.
 */
export function assessAmbiguousMarketWords(report: MorningReport): {
  coverHits: string[]
  bodyCount: number
  bodySamples: string[]
} {
  // 헤드라인과 서브라인은 따로 본다 — 이어 붙이면 헤드라인의 '지수'가 서브라인 첫머리의
  // '나스닥' 같은 수식어에 기대 통과한다(20자 창이 줄 경계를 넘음).
  const coverHits = [
    ...findUnqualifiedAmbiguousWords(report.cover?.headline ?? ''),
    ...findUnqualifiedAmbiguousWords(report.cover?.subline ?? ''),
  ].slice(0, AMBIGUOUS_SAMPLE_LIMIT)
  const bodyHits = findUnqualifiedAmbiguousWords(flattenMorningReport(report, { includeCover: false }))
  return {
    coverHits,
    bodyCount: bodyHits.length,
    bodySamples: bodyHits.slice(0, AMBIGUOUS_SAMPLE_LIMIT),
  }
}

export interface ConsistencySoftFixResult {
  softFixes: string[]
  warnings: string[]
  temporalViolations: string[]
  citationCount: number
}

/**
 * R2·R3 (2026-07-22): 시점·출처 정합을 JSON 문자열 레벨에서 soft fix.
 * report 전체를 JSON.stringify → temporal fix + source fix → re-parse 후 report 를
 * in-place 로 교체(field-by-field 매핑 코드 없이 전 필드 반영). 교정 문자열은
 * checkAndFixTemporal·softFixUnquotableSources 가 JSON 메타문자 미포함을 보장하므로
 * re-parse 는 항상 성공한다. temporal hard violation·인용 빈도는 반환해 호출부가 판정.
 */
export function applyConsistencySoftFixesInPlace(
  report: MorningReport,
  reportDate: string,
  todaySources: string[]
): ConsistencySoftFixResult {
  const json = JSON.stringify(report)
  const temporal = checkAndFixTemporal(json, reportDate)
  const source = softFixUnquotableSources(temporal.fixed, todaySources)
  if (source.fixed !== json) {
    const reparsed = JSON.parse(source.fixed) as MorningReport
    const mutable = report as unknown as Record<string, unknown>
    for (const key of Object.keys(mutable)) delete mutable[key]
    Object.assign(report, reparsed)
  }
  return {
    softFixes: [...temporal.softFixes, ...source.softFixes],
    warnings: source.warnings,
    temporalViolations: temporal.violations,
    citationCount: countCitationPhrases(source.fixed),
  }
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

const SUMMARY_SOFT_MAX_CHARS = 60
const DIGIT = /[0-9]/

/**
 * 2026-10-17 출력 스키마 구조 검사.
 *  - 필수 필드(cover·summary 세 줄·assetCards·todayChecks와 각 필드·card.key·card.line)
 *  - todayChecks 정확히 3개
 *  - assetCards key ⊆ 자산군 슬롯(중복 없이), card.key ∈ 자산군 슬롯 (buildAssetClassSlots(data.quotes))
 *  - card.line 32자 이내·질문형 금지
 *  - 미리보기 카드 문구(제목·card 자산군 라벨·card.line)가 카드 규칙 안에 들어감(cardTextFits, Ruling 15)
 * Ruling 10(2026-10-17): 마지막 축소판(lastAttempt = factChecksAsWarnings)에서는 코드가 고칠 수 있는 구조 문제를
 * 그 자리에서 교정하고 console.warn으로 남긴다 — 발송을 막지 않는다(전송 > 침묵). 1·2회차는 재생성 사유.
 *   todayChecks 3개 초과 → 앞 3개 / 1~2개 → 경고 / 0개 → 필수 필드 누락(막음)
 *   card.key 슬롯 밖·누락 → 주제 슬롯(pickFeaturedSlot) key
 *   assetCards 슬롯 밖 key → 버림, 중복 key → 첫 카드만
 *   card.line 길이·질문형, 카드 문구 넘침 → 경고(카드 렌더러가 마지막 수단으로 '…' 처리)
 * 진짜 비어 있는 필수 필드(summary·ifHolding 등)는 마지막 시도에도 막는다.
 * 기록만(soft-warn): 60자 권장 초과, 슬롯 누락 카드(렌더러가 숫자만 있는 카드로 그림), card.key ≠ 주제 슬롯,
 * card.line의 숫자(숫자 자체가 뉴스일 때는 쓸 수 있음).
 */
function findStructuralViolations(report: MorningReport, data: CollectedData, options: MorningQualityOptions = {}): string[] {
  const lastAttempt = options.factChecksAsWarnings === true
  const violations: string[] = []
  const repaired = (message: string) => console.warn(`  [struct-fix] ${message}`)

  const slots = buildAssetClassSlots(data.quotes)
  const slotKeys = slots.map(s => s.key)
  const allowed = new Set<string>(slotKeys)
  const allowedLabel = slotKeys.join(', ') || '없음'
  const featuredKey = pickFeaturedSlot(slots)?.key

  // ── 교정·위반: assetCards key (슬롯 밖·중복) ──
  if (Array.isArray(report.assetCards)) {
    const objectCards = objectItems(report.assetCards)
    const keys = objectCards.map(c => c.key as unknown).filter(isFilled) as string[]
    const unknownKeys = [...new Set(keys.filter(k => !allowed.has(k)))]
    const duplicateKeys = [...new Set(keys.filter((k, i) => allowed.has(k) && keys.indexOf(k) !== i))]
    const keyless = objectCards.some(c => !isFilled(c.key))
    if (lastAttempt && (unknownKeys.length > 0 || duplicateKeys.length > 0 || keyless)) {
      const seen = new Set<string>()
      const before = report.assetCards.length
      report.assetCards = report.assetCards.filter(item => {
        if (typeof item !== 'object' || item === null) return true // 형식 오류는 아래 필수 필드 검사가 보고
        const key = item.key as unknown
        if (!isFilled(key) || !allowed.has(key as string) || seen.has(key as string)) return false
        seen.add(key as string)
        return true
      })
      const reasons = [...unknownKeys.map(k => `슬롯 밖 ${k}`), ...duplicateKeys.map(k => `중복 ${k}`), ...(keyless ? ['key 없음'] : [])]
      repaired(`assetCards ${before - report.assetCards.length}장 제거(${reasons.join(', ')})`)
    } else {
      if (unknownKeys.length > 0) violations.push(`assetCards key가 자산군 슬롯에 없음: ${unknownKeys.join(', ')} (허용: ${allowedLabel})`)
      if (duplicateKeys.length > 0) violations.push(`assetCards key 중복: ${duplicateKeys.join(', ')}`)
    }
  }

  // ── 교정·위반: todayChecks 개수 (0개는 아래 필수 필드 누락) ──
  const checkCount = Array.isArray(report.todayChecks) ? report.todayChecks.length : 0
  if (checkCount !== 3) {
    if (!lastAttempt) {
      violations.push(`오늘 확인할 것은 정확히 3개여야 합니다(현재 ${checkCount}개)`)
    } else if (checkCount > 3) {
      report.todayChecks = report.todayChecks.slice(0, 3)
      repaired(`todayChecks ${checkCount}개 → 앞 3개만 남김`)
    } else if (checkCount > 0) {
      repaired(`todayChecks ${checkCount}개(3개 미만) — 그대로 발송`)
    }
  }

  // ── 교정·위반: card.key ──
  const card = typeof report.card === 'object' && report.card !== null ? report.card : undefined
  const cardKey = card?.key as unknown
  if (card && !(isFilled(cardKey) && allowed.has(cardKey as string))) {
    if (lastAttempt && featuredKey) {
      repaired(`card.key ${isFilled(cardKey) ? cardKey : '(없음)'} → ${featuredKey}(주제 슬롯)`)
      card.key = featuredKey
    } else if (isFilled(cardKey)) {
      violations.push(`card.key가 자산군 슬롯에 없음: ${cardKey} (허용: ${allowedLabel})`)
    }
  } else if (card && featuredKey && cardKey !== featuredKey) {
    console.log(`  [soft-warn] card.key ${cardKey}가 주제 슬롯(${featuredKey})과 다름`)
  }

  // ── 필수 필드(교정 뒤 상태 기준) ──
  const missing: string[] = []
  const need = (value: unknown, path: string) => { if (!isFilled(value)) missing.push(path) }
  need(report.cover?.headline, 'cover.headline')
  need(report.cover?.subline, 'cover.subline')
  need(report.summary?.overseas, 'summary.overseas')
  need(report.summary?.domestic, 'summary.domestic')
  need(report.summary?.focus, 'summary.focus')
  if (!Array.isArray(report.assetCards) || report.assetCards.length === 0) {
    missing.push('assetCards')
  } else {
    report.assetCards.forEach((c, i) => {
      if (typeof c !== 'object' || c === null) { missing.push(`assetCards[${i}]`); return }
      need(c.key, `assetCards[${i}].key`)
      need(c.ifHolding, `assetCards[${i}].ifHolding`)
      need(c.ifConsidering, `assetCards[${i}].ifConsidering`)
    })
  }
  if (!Array.isArray(report.todayChecks) || report.todayChecks.length === 0) {
    missing.push('todayChecks')
  } else {
    report.todayChecks.forEach((check, i) => {
      if (typeof check !== 'object' || check === null) { missing.push(`todayChecks[${i}]`); return }
      need(check.time, `todayChecks[${i}].time`)
      need(check.what, `todayChecks[${i}].what`)
      need(check.baseline, `todayChecks[${i}].baseline`)
      need(check.invalidation, `todayChecks[${i}].invalidation`)
    })
  }
  need(card?.key, 'card.key')
  need(card?.line, 'card.line')
  if (missing.length > 0) violations.push(`필수 필드 누락: ${missing.join(', ')}`)

  const cardKeys = objectItems(report.assetCards).map(c => c.key as unknown).filter(isFilled) as string[]
  const missingSlots = slotKeys.filter(k => !cardKeys.includes(k))
  if (missingSlots.length > 0) console.log(`  [soft-warn] assetCards에 빠진 슬롯(숫자만 렌더): ${missingSlots.join(', ')}`)

  // ── 미리보기 카드 문구(Ruling 15): 카드 렌더러와 같은 규칙(cardTextFits)으로 판정 ──
  // 1·2회차 위반(재생성), 마지막 시도 경고만 — 카드 렌더러는 넘치는 줄을 '…'로 줄여 그린다.
  // 제목·한 줄이 비어 있으면 위 필수 필드 누락이 이미 보고하므로 여기서는 보지 않는다.
  const headline = typeof report.cover?.headline === 'string' ? report.cover.headline : ''
  const cardLine = typeof card?.line === 'string' ? card.line : ''
  if (isFilled(headline) && isFilled(cardLine)) {
    const cardSlot = slots.find(s => s.key === card?.key) ?? pickFeaturedSlot(slots)
    const fit = cardTextFits('etf', { headline, line: cardLine, holdingLabel: cardSlot?.holdingLabel ?? '' })
    // 자산군 슬롯이 하나도 없는 날(데이터 문제)은 라벨이 빌 수밖에 없다 — 재생성으로 고칠 수 없으니 라벨은 보지 않는다.
    const reasons = cardSlot ? fit.reasons : fit.reasons.filter(r => !r.startsWith('holdingLabel'))
    if (reasons.length > 0) {
      const message = `미리보기 카드 문구가 카드에 들어가지 않음: ${reasons.join('; ')}`
      if (lastAttempt) console.warn(`  [card-warn] ${message} — 경고만(카드 렌더러가 '…'로 줄임)`)
      else violations.push(message)
    }
  }

  // ── card.line: 1·2회차 위반, 마지막 시도 경고 ──
  const line = typeof card?.line === 'string' ? card.line.trim() : ''
  if (line.length > 0) {
    const lineProblems: string[] = []
    const length = Array.from(line).length
    if (length > CARD_LINE_MAX_CHARS) lineProblems.push(`card.line은 ${CARD_LINE_MAX_CHARS}자 이내여야 합니다(현재 ${length}자): ${line}`)
    if (QUESTION_FORM.test(line)) lineProblems.push(`card.line은 평서문이어야 합니다(질문형 금지): ${line}`)
    if (lastAttempt) lineProblems.forEach(problem => repaired(`${problem} — 경고만(카드 렌더러가 줄임)`))
    else violations.push(...lineProblems)
    if (DIGIT.test(line)) console.log(`  [soft-warn] card.line에 숫자 — 숫자 자체가 뉴스일 때만 씁니다: ${line}`)
  }

  const long = [
    ['summary.overseas', report.summary?.overseas],
    ['summary.domestic', report.summary?.domestic],
    ['summary.focus', report.summary?.focus],
    ...objectItems(report.assetCards).flatMap(c => [[`${c.key}.ifHolding`, c.ifHolding], [`${c.key}.ifConsidering`, c.ifConsidering]]),
  ].filter(([, v]) => typeof v === 'string' && Array.from(v).length > SUMMARY_SOFT_MAX_CHARS).map(([k]) => k)
  if (long.length > 0) console.log(`  [soft-warn] ${SUMMARY_SOFT_MAX_CHARS}자 초과(기록 전용): ${long.join(', ')}`)

  return violations
}

export interface MorningQualityOptions {
  // 마지막 축소판(Tier 1) 검증 표시 — 운영 원칙 "품질 낮아도 전송 > 침묵"(F02 유지 결정, 2026-10-16).
  // 사실 검증(수치 대조·주간 둔갑·환율 방향)과 중복 문장은 경고로 남기고, 코드가 고칠 수 있는 구조 문제는
  // 교정한다(Ruling 10, 2026-10-17). 필수 필드 누락·준법(투자 권유) 등은 그대로 위반.
  factChecksAsWarnings?: boolean
}

export function validateMorningReportQuality(
  report: MorningReport,
  data: CollectedData,
  strategy: MorningStrategyInput,
  options: MorningQualityOptions = {}
): void {
  // 레버리지·인버스 주의는 코드가 정한 조건(|등락| 10% 이상)인 날에만 — 아니면 재생성 대신 자동 생략.
  if (report.tacticalWarning !== undefined && !findTacticalAlert(data.quotes)) {
    delete report.tacticalWarning
    console.log(`  [soft-fix] tacticalWarning 생략 — 레버리지·인버스 |등락| ${TACTICAL_WARNING_MIN_ABS_PCT}% 이상 없음`)
  }

  // P1: 검증 전에 소프트 픽스를 먼저 적용. 가벼운 문체 이슈로 재생성하지 않도록.
  const fixesApplied = applySoftFixesInPlace(report)
  if (fixesApplied.length > 0) {
    console.log(`  [soft-fix] 자동 교정 ${fixesApplied.length}건 적용: ${fixesApplied.join(', ')}`)
  }

  // R2·R3: 시점·출처 정합 soft fix (data.date·data.news 에서 앵커·소스 목록 유도).
  const consistency = applyConsistencySoftFixesInPlace(
    report,
    data.date,
    data.news.map(n => n.source)
  )
  if (consistency.softFixes.length > 0) {
    console.log(`  [soft-fix] 정합성 교정 ${consistency.softFixes.length}건: ${consistency.softFixes.join(', ')}`)
  }
  if (consistency.warnings.length > 0) {
    console.log(`  [soft-warn] 비승인 출처 잔존: ${consistency.warnings.join(', ')}`)
  }

  const violations: string[] = []

  // 2026-10-17 출력 스키마 구조 검사 — 1·2회차는 재생성 사유, 마지막 축소판은 고칠 수 있는 것을 교정(Ruling 10).
  // 교정(카드·확인 항목 제거)이 아래 텍스트 검사에 반영되도록 먼저 돈다.
  violations.push(...findStructuralViolations(report, data, options))

  const text = flattenMorningReport(report)

  // R2: 시점-요일-상대시제 창 밖·불능은 hard violation.
  violations.push(...consistency.temporalViolations)

  // R3: "에 따르면" 인용 빈도 — 8회 이상 hard, 5회 이상 soft-warn.
  if (consistency.citationCount >= 8) {
    violations.push(`"에 따르면" 인용이 ${consistency.citationCount}회로 과다합니다 (출처 의존 서술 축소 필요)`)
  } else if (consistency.citationCount >= 5) {
    console.log(`  [soft-warn] "에 따르면" 인용 ${consistency.citationCount}회 (허용 한도 이하)`)
  }

  // 사실 검증(2026-10-16 감사 C01·C02·C04·C05) — 정상 시도에서는 재생성 사유, 축소판에서는 경고.
  const factViolations: string[] = []
  const numeric = findNumericClaimMismatches(text, data.quotes, data.indices)
  if (numeric.length > 0) {
    factViolations.push(`수치가 입력 데이터와 다름(지수/ETF 혼동·카드와 본문 불일치): ${numeric.slice(0, 3).join(' / ')}`)
  }
  const weekly = findWeeklyReturnClaims(text)
  if (weekly.length > 0) {
    factViolations.push(`주간 수익률 서술(입력은 1일 등락률뿐): ${weekly.slice(0, 2).join(' / ')}`)
  }
  const fxErrors = findFxDirectionErrors(text)
  if (fxErrors.length > 0) {
    factViolations.push(`환율 방향 오류(원화 약세는 환노출 원화 환산에 플러스): ${fxErrors.slice(0, 2).join(' / ')}`)
  }
  if (options.factChecksAsWarnings) {
    for (const v of factViolations) console.warn(`  [fact-warn] ${v}`)
  } else {
    violations.push(...factViolations)
  }

  const adviceMatches = findMatches(text, INVESTMENT_ADVICE_PATTERNS)
  if (adviceMatches.length > 0) {
    violations.push(`투자 권유성 표현 감지: ${adviceMatches.join(', ')}`)
  }

  if (!strategy.dataCoverage.hasRealFlowData) {
    const flowMatches = findMatches(text, FLOW_WORD_PATTERNS)
    if (flowMatches.length > 0) {
      violations.push('실제 fund flow 데이터가 없는데 자금 유입/유출 표현을 사용했습니다')
    }
  }

  const hasNewsBody = data.news.some(n => n.title.length > 0 && n.url.length > 0)
  if (hasNewsBody) {
    const newsMatches = findMatches(text, NEWS_OVERREACH_PATTERNS)
    if (newsMatches.length > 0) {
      violations.push(`뉴스 제목 이상의 단정 표현 감지: ${newsMatches.join(', ')}`)
    }
  }

  // 중복 문장 — todayChecks의 time·baseline(짧은 기준 문구)은 보지 않는다. 마지막 축소판에서는 경고(Ruling 10).
  const repeated = duplicateSentences(flattenMorningReport(report, { skipShortFields: true }))
  if (repeated.length > 0) {
    const message = `중복 문장 감지: ${repeated.slice(0, 2).join(' / ')}`
    if (options.factChecksAsWarnings) console.warn(`  [dup-warn] ${message}`)
    else violations.push(message)
  }

  const unformattedUsdKrw = text.match(UNFORMATTED_USD_KRW_PATTERN)
  if (unformattedUsdKrw) {
    violations.push(`USD/KRW 천 단위 쉼표 누락: ${unformattedUsdKrw.join(', ')}`)
  }

  const rawKrwAmount = text.match(RAW_KRW_AMOUNT_PATTERN)
  if (rawKrwAmount) {
    violations.push(`원화 금액은 억 원/조 원 단위로 축약해야 합니다: ${rawKrwAmount.slice(0, 2).join(', ')}`)
  }

  // P1: 약한 어미 (확인/점검/봅니다) 과다 사용은 validator 레벨에서 소프트 경고로만
  const weakActionCount = (text.match(/확인합니다|점검합니다|봅니다/g) ?? []).length
  if (weakActionCount >= 18) {
    violations.push('확인/점검/봅니다 문장이 과도합니다. 확인 결과에 따른 행동 기준까지 써야 합니다')
  }

  if (/\b\d{6}\.(KS|KQ)\b/i.test(text)) {
    violations.push('국내 ETF는 "종목명 (6자리 코드)" 형식으로 표기해야 합니다')
  }

  // P1+보강 [H2] (2026-04-24): "종목명 공백 6자리" (괄호 누락) 도 차단.
  // 예: "KODEX 반도체 091160" → "KODEX 반도체 (091160)" 로 쓸 것.
  // 한국어·영문·숫자 뒤에 공백 + 6자리 숫자 + 닫는 괄호 없음 패턴.
  const missingParens = text.match(/(?:[가-힣A-Za-z])\s+\d{6}(?!\)|\d|\.(KS|KQ))/g)
  if (missingParens && missingParens.length > 0) {
    violations.push(
      `국내 ETF 코드는 반드시 괄호로 감싸야 합니다 "(6자리)": ${missingParens.slice(0, 3).join(', ')}`
    )
  }

  // P3: 애매어 (지수/증시/시장 단독) — 한국 독자 오해 방지.
  // 커버는 hard, 본문은 기록 전용 (assessAmbiguousMarketWords 주석 참조).
  const ambiguous = assessAmbiguousMarketWords(report)
  if (ambiguous.coverHits.length > 0) {
    violations.push(
      `커버(헤드라인/서브라인)에 시장이 특정되지 않은 '지수/증시/시장' 표현: ${ambiguous.coverHits.join(' | ')}`
    )
  }
  if (ambiguous.bodyCount > 0) {
    console.log(`  [soft-warn] 본문 애매어 ${ambiguous.bodyCount}건 (기록 전용): ${ambiguous.bodySamples.join(' | ')}`)
  }

  if (violations.length > 0) {
    throw new Error(`[report-quality] Morning 리포트 품질 검증 실패\n- ${violations.join('\n- ')}`)
  }
}
