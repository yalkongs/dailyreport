// lib/claude-client.ts
import Anthropic from '@anthropic-ai/sdk'
import type { CollectedData, EtfQuote, MorningReport } from './types'
// 2026-10-17 아침 리포트 개편: 자산군 슬롯·카드 자산군·레버리지 주의 조건을 프롬프트에 주입
// (렌더러·검증·미리보기 카드와 같은 계산).
import {
  buildAssetClassSlots,
  findTacticalAlert,
  pickFeaturedSlot,
  TACTICAL_WARNING_MIN_ABS_PCT,
  type AssetClassSlot,
  type AssetRep,
} from './asset-classes'
// R3 (2026-07-22): 본문에 이름 인용 가능한 매체 화이트리스트.
import { QUOTABLE_SOURCES } from '../quotable-sources'
import { buildMorningStrategyInput } from './morning-strategy'
import { assessMorningReportQuality, formatMorningQualityError, headlineCandidateBlocking, headlineCandidateProblems, validateMorningReportQuality } from './report-quality'
import { CLAUDE_MAX_RETRIES, CLAUDE_REQUEST_TIMEOUT_MS, ETF_GENERATION_BUDGET_MS, REPORT_MODEL, makeDeadline } from '../claude-budget'
import { EVIDENCE_RULES } from '../evidence-rules'
import { normalizeMorningReportLanguage } from './report-language'
import { describeAngle, ETF_NARRATIVE_ANGLES, type EtfNarrativeAngle } from './narrative-angle'
import { renderVoiceExemplars, pickHeadlineExemplars, renderHeadlineExemplars } from '../voice-exemplars'
// 2026-10-27 제목 편집 기준: 공통 기준 문구·최근 제목 형태·후보 선택(스펙 docs/superpowers/specs/2026-10-27-headline-editorial-design.md).
import { renderHeadlineStandard, renderRecentHeadlineLines, takeRecentHeadlines } from '../headline-editorial'
import {
  applyHeadlineSelection, chooseFinalHeadline, callHeadlineEditor, headlineSelectionEnabled, HEADLINE_EDITOR_ESTIMATE_MS,
  type HeadlineEditor, type HeadlineSelection,
} from '../headline-selection'
import { buildTemporalFramingBlock } from '../temporal-framing'
// Ruling 35: 오늘의 주제 자산군(카드 슬롯) 이름 — 제목 규칙과 검사(report-quality)가 같은 단어를 쓴다.
import { subjectAliasesOf, subjectNameOf } from './headline-subject'

// Lazy initialization: env vars may not be loaded at module parse time
let _client: Anthropic | null = null
function getClient(): Anthropic {
  // F07: 요청 상한·SDK 재시도를 명시(기본 10분·2회는 job 상한 15분과 맞지 않았다).
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: CLAUDE_REQUEST_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES })
  return _client
}

// export: 프롬프트 조립 테스트용(claude-client.prompt.test.ts). 동작 불변.
export const SYSTEM_PROMPT = `당신은 ETF 시장 분석 전문가입니다. 다음 원칙을 반드시 지키십시오.

[톤 & 스타일 — Plan B (2026-04-28) 완화 적용]
- 격식체 사용 ("~입니다", "~습니다") (cover.headline 제외 — [cover.headline 작성 규칙] 참조)
- 차분한 보고서 문체를 유지하되, **한 호흡의 글이 되도록** 문장을 자연스럽게 연결하십시오.
- 수치가 필요한 문장은 수치를 먼저 제시한 뒤 해석을 붙이는 순서를 기본으로 하되, 글의 흐름이 자연스러우면 도치를 허용합니다. (cover.headline 제외 — [cover.headline 작성 규칙] 참조)
- 짧은 문장과 자연스러운 복문을 섞어 씁니다. 단문만 나열하면 보고서가 단편 나열로 읽힙니다.
- 본문은 완결문이 기본이되, 리듬·강조를 위한 가끔의 명사 종결 조각(예: "배럴당 104달러.")은 허용합니다. 단 "SOXX -1.44%, 거래량 급증."처럼 수치를 나열만 하는 데이터피드식 조각은 금지합니다. (cover.headline은 별도 [cover.headline 작성 규칙])
- 독자는 주식·금융상품 경험이 조금 있는 개인 금융 고객입니다. 괴리율·추적오차 같은 전문 용어는 꼭 필요할 때만 짧게 풀어 씁니다.
- **사실을 정확히 만든다는 전제 하에 비유·은유 사용을 허용합니다.** 데이터를 기억하기 좋게 하는 좋은 비유는 보고서 가치를 높입니다.
- 독자를 압박하지 말고 확인 순서와 보류 조건을 친절하게 설명하십시오.

[ETF 특화 규칙 — 절대 어기지 마십시오]
- 매수/매도 권유 절대 금지 ("매수 후보", "신규 진입", "매수 검토", "분할 접근", "비중 확대", "선호 ETF군" 등)
- 이상 탐지 결과 과장 금지 ("폭락", "위험" 단어 자체 금지)
- 수치는 반드시 제공된 데이터에서만 인용, 임의 생성 절대 금지
- 가상의 인물, 가상의 사례, 날조된 통계 사용 금지

[금지 표현 — 흐린 표현·면피성 문구·AI 클리셰만 차단]
- "~할 수 있습니다" 같은 추측성 완화 어미 — 무엇이 가능하다는 뜻인지 직접 쓰십시오.
- "투자에 주의하시기 바랍니다" 같은 면피성 문구
- 은유·관점은 자연스러운 한국어로 읽힐 때 씁니다. 무엇이 진부한지는 아래 [목표 보이스] 예시로 익히고, "아무 날에나 붙일 수 있는 비유"·반복되는 구문 틀은 쓰지 마십시오. (하드 금지어 목록이 아니라 결을 따르는 것입니다.)
- "확인이 필요합니다" 반복 금지. 대신 무엇을 확인할지(거래대금·NAV·USD/KRW 등) 직접 쓰십시오.
- "가능성이 있습니다", "판단됩니다", "보입니다" 같은 흐린 문장 — 본 것을 본 그대로 쓰십시오.

${renderVoiceExemplars('etf')}

반드시 지정된 JSON 형식으로만 응답하십시오. 다른 텍스트는 일절 포함하지 마십시오.`

function extractJsonFromResponse(response: Anthropic.Message, reportType: string): string {
  if (response.content.length === 0) {
    throw new Error(`[claude-client] ${reportType} 응답이 비어 있습니다`)
  }
  const block = response.content[0]
  if (block.type !== 'text') {
    throw new Error(`[claude-client] ${reportType} 응답 타입이 text가 아닙니다: ${block.type}`)
  }
  // Strip markdown code fences. Tolerate:
  //  - leading/trailing whitespace
  //  - missing closing fence (happens if max_tokens truncates mid-response)
  //  - trailing commentary after the closing fence
  const text = block.text.trim()
  // First try full fence match (opening AND closing present)
  const fullFence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  if (fullFence) return fullFence[1]
  // If opens with fence but no closing fence, strip the opener and trust rest is JSON
  const openFence = text.match(/^```(?:json)?\s*\n?([\s\S]*)$/)
  if (openFence) {
    // Drop any trailing fence if present anywhere
    return openFence[1].replace(/\s*```\s*$/m, '').trim()
  }
  return text
}

// 생성·파싱·언어 정규화까지 수행하되 품질 검증은 하지 않는다(검증·재시도는 generateMorningReportWithFallback).
export async function generateMorningReportRaw(data: CollectedData): Promise<MorningReport> {
  const prompt = buildMorningPrompt(data)
  const response = await getClient().messages.create({
    model: REPORT_MODEL,
    // 출력 상한은 여유로 둔다(새 스키마 응답은 이보다 훨씬 짧다 — 잘림 방지용 안전 여유).
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = extractJsonFromResponse(response, 'morning')
  let report: MorningReport
  try {
    report = JSON.parse(text) as MorningReport
  } catch (e) {
    throw new Error(`[claude-client] morning 리포트 JSON 파싱 실패: ${e}\n응답: ${text.slice(0, 200)}`)
  }
  return normalizeMorningReportLanguage(report)
}

// 축소판 검증(마지막 시도) — Tier 1 fallback 결과와, 마지막 생성을 쓰지 못했을 때의 앞선 결과에 쓴다.
// 2026-10-16: 사실 검증은 경고로만 남긴다(전송 > 침묵).
// 2026-10-17 (Ruling 10): 코드가 고칠 수 있는 구조 문제(todayChecks 초과·card.key·슬롯 밖/중복 카드·card 없음)는 교정하고,
// card.line 길이·질문형과 중복 문장은 경고로만 남긴다. 필수 필드 누락·투자 권유는 그대로 막는다.
// M4 (Ruling 25): 시점·인용 빈도·자금 흐름 표현·뉴스 단정·표기 형식 검사도 경고로만 남긴다.
export function validateMorningReport(report: MorningReport, data: CollectedData): void {
  validateMorningReportQuality(report, data, buildMorningStrategyInput(data), { factChecksAsWarnings: true })
}

type Deadline = ReturnType<typeof makeDeadline>

export interface MorningGenerationOptions {
  // 테스트용 주입. 기본: 실제 Claude 호출(generateMorningReportRaw)·ETF 생성 예산(F07).
  generateRaw?: (data: CollectedData) => Promise<MorningReport>
  deadline?: Deadline
  maxAttempts?: number
  // 테스트용 주입. 기본: callHeadlineEditor(생성과 같은 모델에 한 번 묻는다).
  headlineEditor?: HeadlineEditor
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isReportObject(value: unknown): value is MorningReport {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeKind(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

/**
 * ETF 리포트 생성 — 엄격 검증 최대 maxAttempts(2)회 → Tier 1 재생성 + 축소판 검증(validateMorningReport).
 * I2 (Ruling 23, F02 "전송 > 침묵"): 파싱된 결과를 버리지 않는다. Tier 1 호출을 못 하거나(예산) 실패·파싱 실패하거나
 * 그 결과가 축소판 검증에도 걸리면, 앞선 결과를 가장 나은 것부터(카드 문구만 어긋난 결과 > 위반이 가장 적은 결과 >
 * 가장 최근 결과) 엄격 검증 전 원본으로 축소판 검증해 처음 통과하는 것을 경고와 함께 돌려준다.
 * 준법(매수·매도 권유)·진짜 필수 필드 누락은 축소판에서도 막는다. 발송할 결과가 없으면 던진다(호출 쪽이 exit 1).
 */
export async function generateMorningReportWithFallback(
  data: CollectedData,
  options: MorningGenerationOptions = {},
): Promise<MorningReport> {
  const generateRaw = options.generateRaw ?? generateMorningReportRaw
  const deadline = options.deadline ?? makeDeadline(ETF_GENERATION_BUDGET_MS)
  const maxAttempts = options.maxAttempts ?? 2
  const strategy = buildMorningStrategyInput(data)
  // 2026-10-27 제목 편집 기준: 후보를 제목 단위 검사로 거르고 임시 제목을 정한 뒤, 발송할 결과가 정해지면 편집자에게 한 번 묻는다.
  const editor = options.headlineEditor ?? callHeadlineEditor
  const selectionOn = headlineSelectionEnabled()
  const recent = takeRecentHeadlines(data.recentHeadlines ?? [])
  const featured = pickFeaturedSlot(buildAssetClassSlots(data.quotes))
  const selectHeadline = (raw: MorningReport) =>
    applyHeadlineSelection(raw, recent, c => headlineCandidateProblems(c, raw, data), { scoring: selectionOn, isBlocking: headlineCandidateBlocking })
  const strictOk = (r: MorningReport) => assessMorningReportQuality(r, data, strategy).violations.length === 0
  const reducedOk = (r: MorningReport) => { validateMorningReport(r, data); return true }
  // 편집자가 다른 생존 후보를 고르면 원본(pristine)에 그 후보를 넣어 같은 검증(ok)으로 다시 본다 — 통과할 때만 그 결과로.
  const finishHeadline = async (report: MorningReport, pristine: MorningReport, selection: HeadlineSelection | null, ok: (r: MorningReport) => boolean): Promise<MorningReport> => {
    const swapped = await chooseFinalHeadline<MorningReport>({
      selection,
      enabled: selectionOn,
      canCall: () => deadline.canStartCall(HEADLINE_EDITOR_ESTIMATE_MS),
      editor,
      input: {
        target: 'etf',
        recent,
        tier: data.etfEvidence?.tier,
        subjectName: featured ? subjectNameOf(featured) : undefined,
        evidence: data.etfEvidence?.topCatalyst ? [data.etfEvidence.topCatalyst.title] : [],
      },
      trySwap: c => {
        const next = structuredClone(pristine)
        next.cover = { ...next.cover, headline: c.headline, subline: c.subline }
        try { return ok(next) ? next : null } catch { return null }
      },
    })
    return swapped ?? report
  }
  // 엄격 검증에 걸린 결과 — report는 검증(soft fix·교정)이 손대기 전 원본, base는 카드 문구 외 위반 수.
  const kept: Array<{ report: MorningReport; base: number; violations: string[]; attempt: number; selection: HeadlineSelection | null }> = []
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1 && !deadline.canStartCall()) {
      console.warn(`[warn] 생성 예산 초과(${Math.round(deadline.elapsedMs() / 1000)}초) — ${attempt}회차 생략, Tier 1 fallback으로`)
      break
    }
    let raw: MorningReport
    try {
      raw = await generateRaw(data)
    } catch (e) {
      lastError = e
      console.warn(`[warn] Claude 생성 ${attempt}/${maxAttempts}회 실패(호출·파싱):`, errorMessage(e))
      continue
    }
    // Ruling 28: 형식이 깨진 응답(객체 아님·검증 중 예외)은 파싱 실패처럼 다룬다 — 함수 밖으로 던지지 않고 다음 시도로
    // (2회차·Tier 1·앞선 결과 발송이 살아 있게). 객체가 아닌 응답은 앞선 결과 후보에도 넣지 않는다.
    let pristine: MorningReport
    let selection: HeadlineSelection | null = null
    let quality: ReturnType<typeof assessMorningReportQuality>
    try {
      if (!isReportObject(raw)) throw new Error(`응답 최상위가 객체가 아님(${describeKind(raw)})`)
      selection = selectHeadline(raw)
      pristine = structuredClone(raw)
      quality = assessMorningReportQuality(raw, data, strategy)
    } catch (e) {
      lastError = e
      console.warn(`[warn] ${attempt}/${maxAttempts}회 응답 검증 중 오류(형식 깨짐 — 파싱 실패처럼 다음 시도로):`, errorMessage(e))
      continue
    }
    if (quality.violations.length === 0) {
      if (attempt > 1) console.log(`  ✓ ${attempt}회차에서 성공`)
      return await finishHeadline(raw, pristine, selection, strictOk)
    }
    lastError = new Error(formatMorningQualityError(quality.violations))
    kept.push({ report: pristine, base: quality.violations.length - quality.cardViolations.length, violations: quality.violations, attempt, selection })
    console.warn(`[warn] ${attempt}/${maxAttempts}회 품질 검증 실패(위반 ${quality.violations.length}건, 그중 카드 문구 ${quality.cardViolations.length}건): ${quality.violations.join(' / ')}`)
  }

  // P0 fallback: 재생성 + 축소판 검증 — 준법·필수 필드 누락만 막고 나머지는 경고·교정(Ruling 10·25).
  if (deadline.canStartCall()) {
    let raw: MorningReport | undefined
    try {
      console.log('[5b/8] Tier 1 fallback — 재생성 후 축소판 검증(사실·형식 검사는 경고, 준법·필수 필드만 막음)')
      raw = await generateRaw(data)
    } catch (e) {
      lastError = e
      console.warn('[warn] Tier 1 fallback 호출 실패(호출·파싱):', errorMessage(e))
    }
    if (raw) {
      try {
        const tierSelection = isReportObject(raw) ? selectHeadline(raw) : null
        const tierPristine = isReportObject(raw) ? structuredClone(raw) : null
        validateMorningReport(raw, data)
        console.log('  ✓ Tier 1 fallback 성공 — 경고([*-warn]·[struct-fix])가 있으면 로그를 확인하십시오')
        return tierPristine ? await finishHeadline(raw, tierPristine, tierSelection, reducedOk) : raw
      } catch (e) {
        lastError = e
        console.warn('[warn] Tier 1 fallback 결과도 축소판 검증 실패:', errorMessage(e))
      }
    }
  } else {
    console.warn(`[warn] 생성 예산 초과(${Math.round(deadline.elapsedMs() / 1000)}초) — Tier 1 fallback 호출 생략`)
  }

  // 앞선 결과를 가장 나은 것부터 축소판으로 — 같은 위반 수면 더 최근 결과.
  const ranked = [...kept].sort((a, b) => a.base - b.base || b.attempt - a.attempt)
  for (const candidate of ranked) {
    try {
      const pristine = structuredClone(candidate.report)
      validateMorningReport(candidate.report, data)
      console.warn(`[warn] 마지막 생성을 쓰지 못해 앞선 ${candidate.attempt}회차 결과로 발송 진행(축소판 검증 통과 — 엄격 검증 위반: ${candidate.violations.join(' / ')})`)
      return await finishHeadline(candidate.report, pristine, candidate.selection, reducedOk)
    } catch (e) {
      lastError = e
      console.warn(`[warn] 앞선 ${candidate.attempt}회차 결과도 축소판 검증 실패:`, errorMessage(e))
    }
  }

  throw new Error(`[claude-client] ETF 리포트 생성 실패 — 발송할 결과 없음. 마지막 원인: ${errorMessage(lastError)}`)
}

function formatPromptNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

// B6 (2026-05-30): macro 블록 — failedSources에 'macro' 있으면 머리에 경고.
// 평소 단일 지표 null(예: ^MOVE)은 진짜 부재이므로 라벨링 안 함(블록 단위 처리).
export function buildMacroBlock(macro: import('./types').MacroContext, failedSources: string[] | undefined): string {
  const warn = failedSources?.includes('macro')
    ? '⚠️ 거시 데이터 수집 실패 — 아래 수치는 신뢰할 수 없습니다(직전 영업일 기준으로도 보지 마십시오).\n'
    : ''
  // C02: 환율은 수준과 변화 방향을 함께 준다(방향 없이 수준만 주면 '원화 약세=손실' 오서술이 났다).
  const fxChange = typeof macro.usdKrwChangePercent === 'number' && macro.usdKrw !== null
    ? ` (전일 대비 ${macro.usdKrwChangePercent >= 0 ? '+' : ''}${macro.usdKrwChangePercent.toFixed(2)}% · ${macro.usdKrwChangePercent >= 0 ? '원화 약세' : '원화 강세'})`
    : ''
  return `[거시 지표]
${warn}USD/KRW: ${formatPromptNumber(macro.usdKrw, 0)}${fxChange}
VIX: ${formatPromptNumber(macro.vix, 2)}
MOVE: ${formatPromptNumber(macro.moveIndex, 2)}
코인 공포탐욕: ${formatPromptNumber(macro.fearGreed, 0)} (alternative.me 암호화폐 심리 지표 — 주식 심리 지표 아님)
US 10Y: ${formatPromptNumber(macro.us10y, 2)}%
WTI: ${formatPromptNumber(macro.wti, 1)}
Gold: ${formatPromptNumber(macro.gold, 0)}`
}

// C01 (2026-10-16): 실제 지수 블록. ETF 등락을 지수 등락으로 부르지 않도록 지수 값을 따로 준다.
export function buildIndexBlock(indices: import('./types').IndexQuote[] | undefined): string {
  if (!indices || indices.length === 0) {
    return `[지수 실측]
⚠️ 지수 시세 수집 실패 — 코스피·코스닥·S&P500·나스닥·다우의 등락률 수치를 쓰지 마십시오. ETF 등락은 ETF 이름으로만 씁니다.`
  }
  const lines = indices.map(i => {
    const pct = i.changePercent as number
    const date = i.asOf ? `, ${i.asOf.slice(5).replace('-', '/')} 종가` : ''
    return `${i.nameKo}: ${formatPromptNumber(i.price, 2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%${date})`
  })
  return `[지수 실측 — ETF와 구분]
${lines.join('\n')}
- 코스피·코스닥·S&P500·나스닥·다우 등 **지수 등락은 이 블록 값만** 인용합니다. SPY·QQQ·KODEX 200 같은 ETF 등락률을 지수 등락률로 부르지 마십시오(ETF 수치는 ETF 이름으로).
- 코스피200·나스닥100은 위 지수와 다른 지수입니다. 이 블록에 없으면 수치를 쓰지 마십시오.`
}

// C03 (2026-10-16): 미국 지표 일정 — 한국시간과 한국 정규장 관계. 10/14 CPI(한국시간 21:30)를
// '오늘 국내 장중 방향을 뒤집는 변수'로 쓴 오류 대응.
export function buildUsEventsBlock(events: import('../types').EconomicEvent[] | undefined, date: string): string {
  const upcoming = (events ?? []).filter(e => {
    const d = e.kstDate ?? e.date
    return d >= date && d <= addDaysIso(date, 2)
  })
  if (upcoming.length === 0) return ''
  const { formatEconomicEventLine } = require('../economic-calendar')
  return `[미국 주요 지표 일정 — 한국시간]
${upcoming.map(e => `- ${formatEconomicEventLine(e, date)}`).join('\n')}
- 한국 장 마감 후 발표 지표는 오늘 국내 장중 관찰 대상이 아닙니다. 각 줄에 적힌 발표 시점과 국내 반영일을 그대로 쓰고(오늘 밤인지 내일 밤인지, 국내 반영이 언제인지 — 요일·날짜를 따로 계산하지 마십시오), 그 결과가 오늘 장중 방향을 정한다고 쓰지 마십시오.

`
}

function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function formatPromptEtf(q: Pick<CollectedData['quotes'][number], 'ticker' | 'name' | 'market'>): string {
  if (q.market === 'KR') {
    return `${q.name} (${q.ticker.replace(/\.(KS|KQ)$/i, '')})`
  }
  return `${q.ticker} ${q.name}`
}

function formatSignedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function formatRep(r: AssetRep): string {
  return `${formatPromptEtf(r)} ${formatSignedPct(r.pct)}`
}

// 2026-10-17 아침 리포트 개편: 자산군 슬롯은 코드가 확정한다(asset-classes.ts — 렌더·검증·카드와 같은 계산).
// 모델에게는 key·라벨·대표 ETF 예시만 주고, 숫자는 화면에 코드가 그리므로 문장에 반복하지 않게 한다.
function buildAssetSlotBlock(slots: AssetClassSlot[], featured: AssetClassSlot | null): string {
  const lines = slots.length > 0
    ? slots.map(s => `- ${s.key} | ${s.label} | 대표 ETF 예시: ${s.reps.map(formatRep).join(' · ')}`).join('\n')
    : '- (오늘 자산군으로 분류할 시세가 없습니다)'
  // Ruling 35: 카드 슬롯이 곧 오늘의 주제 자산군 — 제목·카드·페이지 모자이크가 모두 이 자산군을 다룬다.
  const cardLine = featured
    ? `- card.key는 "${featured.key}"입니다. 미리보기 카드에는 "${featured.holdingLabel}"이 코드로 붙고, 그 아래에 card.line이 들어갑니다.
- 오늘의 주제 자산군: ${featured.key} | ${featured.label} — 제목(cover.headline)·미리보기 카드·페이지 모자이크가 모두 이 자산군을 다룹니다. 제목에 넣을 이름: "${subjectNameOf(featured)}"${subjectAliasesOf(featured).length > 0 ? `(같은 뜻으로 인정: ${subjectAliasesOf(featured).join('·')})` : ''}.`
    : '- 카드 자산군을 정할 슬롯이 없습니다.'
  return `[자산군 슬롯 — 코드가 확정]
${lines}
- 위 대표 ETF의 이름·등락률은 화면에 "예시"로 코드가 표시합니다. 숫자는 화면에 코드가 표시하므로 문장에 반복하지 마십시오. 문장은 움직임의 의미와 판단 재료만 씁니다.
- assetCards는 위 key를 위 순서대로 하나씩 모두 씁니다. 목록에 없는 key는 쓰지 마십시오.
${cardLine}`
}

// Ruling 35 (2026-10-20): [cover.headline 작성 규칙] 1번의 주제 자산군 필수 규칙. 10/20 제목(미국 섹터 이야기)과
// 카드("2차전지를 갖고 있다면")가 따로 놀았다 — 제목 주제를 카드 슬롯에 묶는다. 검사(report-quality)도 같은 단어로 본다.
function buildHeadlineSubjectRule(featured: AssetClassSlot): string {
  const name = subjectNameOf(featured)
  const words = [name, ...subjectAliasesOf(featured)].map(w => `"${w}"`)
  const wordList = words.length > 1 ? `${words[0]} 또는 ${words.slice(1).join('·')}` : words[0]
  const domesticNote = featured.key.startsWith('kr-')
    ? ' 국내 자산군이므로 "미 ○○"처럼 해외 시장을 붙인 표현은 국내 주제를 다룬 것으로 치지 않습니다.'
    : ''
  return `
- 주제 자산군 (필수 — 아래 tier·catalyst·반복 회피 규칙보다 우선): 제목은 오늘의 주제 자산군(${name})의 움직임을 반드시 다루고, 제목에 그 자산군 이름(${wordList})을 넣습니다. 미리보기 카드("${featured.holdingLabel}")와 페이지 모자이크가 이 자산군을 보여 주므로, 제목이 다른 자산군만 다루면 카드와 제목이 서로 다른 이야기를 합니다. 해외 원인·다른 자산군과의 대비는 함께 써도 됩니다(예: "미 반도체 급락에도 국내 헬스케어 ETF 강세"). 세 후보 모두에 적용됩니다.${domesticNote}`
}

// 국내 ETF 거래대금 상위 5 (원). KRX 거래대금(tradingValue)이 있으면 그 값을 쓴다.
// I1 (Ruling 22): KRX OpenAPI는 08:00 KST 게시라 06:40 실행엔 거래대금이 없다 — 그때는 렌더러의 '추정 거래대금'과
// 같은 종가×거래량 참고값으로 순위를 주고, 추정값임을 줄 머리에 밝힌다(실측처럼 인용하지 않게).
function buildKrTradingValueLine(krQuotes: EtfQuote[]): string {
  const top = (rows: Array<{ q: EtfQuote; value: number }>) => rows
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(({ q, value }) => `${formatPromptEtf(q)} ${formatPromptNumber(value, 0)}원`)
    .join(' / ')
  const actual = krQuotes
    .filter(q => typeof q.tradingValue === 'number' && Number.isFinite(q.tradingValue))
    .map(q => ({ q, value: q.tradingValue as number }))
  if (actual.length > 0) return `거래대금 상위: ${top(actual)}`
  const estimated = krQuotes
    .filter(q => typeof q.price === 'number' && typeof q.volume === 'number' && Number.isFinite(q.price) && Number.isFinite(q.volume))
    .map(q => ({ q, value: (q.price as number) * (q.volume as number) }))
  if (estimated.length === 0) return '거래대금 상위: N/A'
  return `거래대금 상위(추정 — 종가×거래량 참고값, KRX 거래대금 미게시): ${top(estimated)}`
}

// 레버리지·인버스 주의는 코드가 조건(|등락| 10% 이상)을 판단해 작성/생략을 지시한다. 검증도 같은 조건.
function buildTacticalBlock(alert: EtfQuote | null): string {
  const rule = alert
    ? `- ${formatPromptEtf(alert)} ${formatSignedPct(alert.changePercent as number)} — |등락| ${TACTICAL_WARNING_MIN_ABS_PCT}% 이상이므로 tacticalWarning을 작성하십시오(1~2문장: 하루 수익률을 추종하는 구조라 오래 들고 있을 때의 결과가 기초지수와 달라진다는 점, 변동성이 큰 날의 주의점).`
    : `- 레버리지·인버스 중 |등락| ${TACTICAL_WARNING_MIN_ABS_PCT}% 이상인 종목이 없습니다 — tacticalWarning 필드를 넣지 마십시오.`
  return `[레버리지·인버스 주의 — 코드가 판단]
${rule}`
}

// export: 프롬프트 조립 테스트용(claude-client.prompt.test.ts). 동작 불변.
export function buildMorningPrompt(data: CollectedData): string {
  const strategy = buildMorningStrategyInput(data)
  const slots = buildAssetClassSlots(data.quotes)
  const featured = pickFeaturedSlot(slots)
  // 2026-10-27: 제목 비교·순환 예시·최근 제목 줄은 앞 5건만(data.recentHeadlines 7건은 catalyst 반복 감점에 그대로 쓴다).
  const recentHeadlines = takeRecentHeadlines(data.recentHeadlines ?? [])
  const tacticalAlert = findTacticalAlert(data.quotes)
  const topUs = [...data.quotes]
    .filter(q => q.market === 'US' && q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
  const topKr = [...data.quotes]
    .filter(q => q.market === 'KR' && q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))

  const scoreLines = strategy.scores
    .map(s => `${s.displayLabel}: ${s.displayLevel} (${s.stance}) / 근거: ${s.evidence.map(item => `${item.label} ${item.value}`).join(', ')}`)
    .join('\n')

  const riskAlertLines = strategy.riskAlerts
    .map(a => `${a.level} | ${a.title}: ${a.body}`)
    .join('\n') || '없음'

  // Plan B (2026-04-28): narrativeAngle 이 주입되어 있으면 그 관점을
  // 본문 서술의 spine 으로 사용. 분석 렌즈는 "데이터 보는 각도",
  // 서사 앵글은 "이야기 풀어내는 각도" — 두 차원을 직교로 결합.
  const angleKey = (data.narrativeAngle && (ETF_NARRATIVE_ANGLES as readonly string[]).includes(data.narrativeAngle))
    ? (data.narrativeAngle as EtfNarrativeAngle)
    : undefined
  const angleBlock = angleKey
    ? `\n오늘의 서사 앵글: ${angleKey}\n앵글 가이드: ${describeAngle(angleKey)}\n`
    : ''

  // Phase E1 (2026-05-24): ETF 모드 분기 가이드
  const etfModeBlock = data.etfMode
    ? `\n[ETF 모드: ${data.etfMode.mode}] ${data.etfMode.reason}\n${require('./etf-mode').describeEtfModeForPrompt(data.etfMode.mode)}\n`
    : ''

  // Phase C (2026-05-22): 단독 휴장 시 캘린더 블록 (양국 휴장은 파이프라인에서
  // short-circuit 되므로 여기 도달하지 않음).
  const cal = data.calendarInfo
  const calendarBlock = (() => {
    if (!cal) return ''
    // KR 휴장·양국 휴장은 파이프라인 short-circuit(생성 전 skip) — 도달 시 방어적 빈 문자열.
    if (cal.isKrClosedOnly || cal.isDualClosed) return ''
    // 정상일 + 미국 단독 휴장 모두 단일 시점 소스가 처리(갭 인지 + US 휴일 맥락 흡수).
    return buildTemporalFramingBlock(cal, 'etf')
  })()

  // Phase E3 (2026-05-24): 요일 리듬 (월·금 특별 톤)
  const { getWeekdayRole, describeWeekdayRhythm } = require('../weekday-rhythm')
  const weekdayBlock = describeWeekdayRhythm(getWeekdayRole(data.date), 'etf')

  // Layer 0 (2026-05-29): 근거 상태 블록 — tier가 헤드라인 강도를 정하는 입력.
  const ev = data.etfEvidence
  const evidenceBlock = ev
    ? `\n[오늘의 근거 상태 — tier: ${ev.tier}]
- 뉴스 ${ev.newsCount}건 (신선 ${ev.freshCount}건)
- 최상위 catalyst: ${ev.topCatalyst ? `[점수 ${ev.topCatalystScore}] ${ev.topCatalyst.title}` : '없음 — 강한 catalyst 부재'}
- 실패한 데이터 소스: ${ev.failedSources.length > 0 ? ev.failedSources.join(', ') : '없음'}
이 근거 상태가 아래 [cover.headline 작성 규칙]의 tier 동작을 결정합니다.\n`
    : ''

  // JSON 예시의 assetCards는 오늘 슬롯 key를 슬롯 순서대로 전부 담는다(모델이 key를 추측하지 않게).
  const assetCardsSchema = slots
    .map(s => `    { "key": "${s.key}", "reason": "입력 근거가 있을 때만 1문장 — 없으면 이 키를 빼십시오", "ifHolding": "갖고 있다면 — 조건·관찰형 60자 이내", "ifConsidering": "새로 본다면 — 조건·관찰형 60자 이내" }`)
    .join(',\n')

  return `오늘 날짜: ${data.date}
분석 렌즈: ${data.analysisLens}${angleBlock}${etfModeBlock}${calendarBlock}${weekdayBlock}${evidenceBlock}

[독자·발행 맥락 — 모든 문장 작성 시 전제]
- 발행 시각: 매일 **한국 증시 개장(09:00) 전** 아침. 독자는 개장을 준비하는 한국 개인 투자자입니다.
- 독자는 **전일 한국 증시의 마감가·뉴스를 이미 알고** 있으며, '지수/시장' 같은 단어를 보면 반사적으로 KOSPI를 떠올립니다.
- 이 리포트의 주된 데이터는 **간밤 해외 시장(미국 마감, 유럽, 환율 야간)** 입니다.
- 용어 규칙:
  · "지수" 단독 표기 금지. 반드시 "S&P500", "나스닥", "코스피", "코스닥" 등 구체적으로 씁니다.
  · "시장" 단독 표기 금지. "미 증시", "국내 증시", "야간 환시" 등 접두를 붙입니다.
  · "증시가 하락했다"처럼 주체가 불명확한 서술 금지. 어느 시장인지를 반드시 명시합니다.
- 전일 한국 증시와 간밤 미국 시장이 **서로 다른 방향**으로 움직인 경우, 그 차이를 **명시적으로** 언급하십시오. 한국 독자가 반사적으로 떠올리는 한국 흐름과 오늘 새벽 해외 흐름이 다를 수 있다는 점을 고려합니다.
- 헤드라인에 한국 독자가 오해할 여지가 있는 애매어(지수/시장)를 쓰지 말고 **시장을 특정**하여 씁니다.

[오늘의 시장 국면 — 미국 ETF·변동성 기준]
${strategy.regime.displayName}
규칙 점수: ${strategy.regime.confidence}/100 (규칙 합산값 — 확률이 아니므로 본문에 '확신도'·'신뢰도'로 쓰지 마십시오)
요약: ${strategy.regime.summary}
${strategy.regime.domestic?.stress ? `국내 시장 스트레스: 전일 KODEX 200 ${strategy.regime.domestic.move?.toFixed(2)}% 급락 — 미국 위험선호와 국내 급락을 구분해 쓰고, 제목·결론에서 '공격'·'위험선호'를 국내 투자자에게 단정하지 마십시오.` : ''}

[오늘의 전략 결론 — 규칙 기반 참고, 문장 복사 금지]
${strategy.executiveSummary.title}
전술 태도: ${strategy.executiveSummary.tacticalStance}
확인 우선 ETF군: ${strategy.executiveSummary.preferredGroups.join(', ') || '없음'}
관찰 ETF군: ${strategy.executiveSummary.watchGroups.join(', ') || '없음'}
경계 ETF군: ${strategy.executiveSummary.cautionGroups.join(', ') || '없음'}
오늘 피해야 할 실수: ${strategy.executiveSummary.avoidToday}

[시장 국면 점수]
${scoreLines}

[리스크 알림]
${riskAlertLines}

${buildAssetSlotBlock(slots, featured)}

${buildTacticalBlock(tacticalAlert)}

[미국 ETF 상위 5]
${topUs.slice(0, 5).map(q => `${formatPromptEtf(q)}: ${q.changePercent?.toFixed(2)}%`).join('\n')}

[미국 ETF 하위 5]
${topUs.slice(-5).reverse().map(q => `${formatPromptEtf(q)}: ${q.changePercent?.toFixed(2)}%`).join('\n')}

[국내 ETF 핵심 움직임 — 전일 종가 기준]
상위: ${topKr.slice(0, 5).map(q => `${formatPromptEtf(q)} ${q.changePercent?.toFixed(2)}%`).join(' / ') || 'N/A'}
하위: ${topKr.slice(-5).reverse().map(q => `${formatPromptEtf(q)} ${q.changePercent?.toFixed(2)}%`).join(' / ') || 'N/A'}
${buildKrTradingValueLine(topKr)}

${buildIndexBlock(data.indices)}

${buildUsEventsBlock(data.usEvents, data.date)}${buildMacroBlock(data.macro, data.failedSources)}

${(() => {
  // Phase F2 (2026-05-24): ETF 측 catalyst 자동 추출.
  const { extractTopCatalysts, formatCatalystForPrompt } = require('../catalyst-extractor')
  // 2026-05-28: 최근 헤드라인 전달해 같은 catalyst 반복 패널티 적용
  const catalysts = extractTopCatalysts(data.news, {
    topN: 3,
    minScore: 4,
    recentHeadlines: data.recentHeadlines ?? [],
  })
  if (catalysts.length === 0) return ''
  return `\n[🔥 오늘의 forward catalyst — 자동 추출 ${catalysts.length}건]\n` +
    catalysts.map((c: { score: number; publishedHoursAgo?: number; title: string; source?: string }) => `- ${formatCatalystForPrompt(c)}`).join('\n') +
    `\n위는 신선도·시총 상위 기업명·시장 이벤트 키워드로 자동 점수화된 한국 시장 forward catalyst 입니다. ` +
    `summary·assetCards의 reason 등 본문에 우선 반영. 헤드라인 반영 여부·방식은 아래 [cover.headline 작성 규칙]을 따르십시오.\n`
})()}
[주요 뉴스 — 발행 N시간 경과 라벨 포함]
${data.news.slice(0, 6).map(n => {
  const ago = typeof n.publishedHoursAgo === 'number'
    ? `${Math.round(n.publishedHoursAgo)}h전`
    : 'age 불명'
  const cat = n.category ? `${n.category}|` : ''
  const snip = n.snippet ? `\n    ↳ ${n.snippet}` : ''
  return `- [${cat}${ago}] ${n.title} (${n.source}, ${n.url})${snip}`
}).join('\n')}
- **24시간 초과 기사는 "배경 맥락"으로만 활용**하고, 현재 상황·오늘의 전개로 단정하지 마십시오.
- 뉴스 내용이 어제 한국 증시 마감 이후의 전개인지, 그 이전의 전개인지 발행 시각으로 판단하여 쓰십시오.
- **[semiconductor]** 태그는 삼성·SK하이닉스 등 국내 반도체에 영향을 주는 국제 뉴스·리서치(NVIDIA·TSMC·Micron·HBM·메모리 가격·수출규제)입니다. 국내 ETF와의 연결고리를 짚어 활용하십시오.
- **해외 뉴스·리서치 인용 규칙:** ① 해외 기관·매체發 주장·전망은 반드시 **출처(기관/매체명)를 문장에 드러내** 인용(출처 없는 전망·수치 날조 금지). ② 리서치·전망을 **특정 종목·ETF 매수·매도 권유로 번역 금지** — 사실·방향성만. ③ 제공된 제목·요약(↳)의 **사실만** 인용, 원문 문단 복제·창작 금지.
- **본문에 매체명을 인용할 수 있는 것은 다음뿐**: ${QUOTABLE_SOURCES.join(', ')}. 그 외 매체(블로그·소형 외신 등) 기사는 내용은 쓰되 매체명 대신 '외신'으로 지칭하십시오.
${recentHeadlines.length > 0 ? `
[최근 ETF 리포트 헤드라인 — 같은 표현·같은 형태 반복 금지]
${renderRecentHeadlineLines(recentHeadlines)}
최근 제목과 3어절 이상 겹치거나 핵심 단어·동사를 되풀이하지 마십시오.${featured ? ` 단, 오늘의 주제 자산군 이름("${subjectNameOf(featured)}" 등)은 예외입니다 — 최근 헤드라인에 있어도 제목에 넣고, 각도·동사를 바꿉니다.` : ''}
` : ''}
[필드별 독자 목적 — 이 목적을 충족하지 못하면 해당 필드는 실패]
- 독자는 주식·금융상품 경험이 조금 있는 개인 금융 고객입니다. 페이지 위쪽만 읽고도 "어제 분위기 / 오늘 볼 것 / 내 자산군에 주는 의미"를 1~2분 안에 얻어야 합니다.
- cover: 30초 안에 "어느 시장이, 어떻게, 왜"를 파악하게 합니다. 페이지 제목이자 링크 미리보기 카드의 큰 제목입니다.
- summary: 세 줄 요약 — overseas는 간밤 해외 신호, domestic은 전일 국내 증시 상태, focus는 오늘 가장 중요한 관전점입니다.
- assetCards: 그 자산군을 가진 독자(ifHolding)와 새로 보려는 독자(ifConsidering)에게 판단 재료와 확인 조건을 줍니다. 사라·팔라가 아닙니다.
- todayChecks: 오늘 무엇을, 언제, 무엇과 비교해 볼지, 어긋나면 어떤 가설을 버릴지 알려 줍니다.
- card.line: 링크 미리보기 카드에서 자산군 문구 바로 아래 붙는 한 줄입니다.

[작성 규칙]
- 리포트는 하나의 중심 주제(오늘의 시장 인사이트)를 따라 작성하십시오. 세 줄 요약·자산군 카드·확인 3가지가 같은 논리 축을 이어받아야 합니다.
- **기간**: 입력의 ETF·지수 등락률은 모두 직전 거래일 하루(1D) 기준입니다. '이번 주·한 주간·주간' 수익률이나 주간 순위로 쓰지 마십시오.
- **환율 효과 방향**: 원/달러가 오르면(원화 약세) 환노출 해외 ETF의 원화 환산 성과에 플러스, 내리면(원화 강세) 마이너스입니다. "원화 약세가 수익을 깎는다·상쇄한다"는 틀린 서술입니다. 오늘의 환산 효과는 [거시 지표]의 USD/KRW 전일 대비 방향으로 쓰고, 높은 환율에서 새로 담을 때의 반전 위험은 별도 문장으로 씁니다. 이름에 (H)가 붙은 환헤지 상품은 환율 영향이 작습니다.
- 같은 숫자·같은 근거를 여러 필드에서 반복하지 마십시오. 같은 문장을 두 번 쓰면 자동 검증에서 걸립니다(필드가 달라도 문장 구조·주어·어휘를 바꾸십시오).
- "확실", "분명", "틀림없이", "반드시" 같은 단정 어휘는 쓰지 마십시오.
- **'혼조' 사용 규칙**: "혼조"는 **국내 증시는·미 증시는·아시아 증시는** 같이 **여러 지수를 묶는 주어** 뒤에만 씁니다. 단일 지수 이름(코스피·나스닥·S&P500 등)을 주어로 두고 "혼조 마감"이라고 쓰지 마십시오.
- 문장은 독자에게 상황을 설명하고 맥락을 건네주는 기자·애널리스트 어조로 씁니다. 단, 투자 권유나 단정적 매수 지시는 피하십시오.

[summary 작성 규칙 — 세 줄 요약]
- overseas(해외 신호)·domestic(국내 상태)·focus(오늘 핵심)를 각각 60자 이내 한 문장으로 씁니다.
- 숫자 나열이 아니라 분위기·배경을 말로 씁니다. 핵심 지표 수치는 화면에 코드가 따로 표시합니다.
- 원인은 입력(뉴스·catalyst·지표)에 근거가 있을 때만 단정하고, 근거가 약하면 오늘 확인할 점으로 씁니다.

[assetCards 작성 규칙 — 자산군별 판단 재료]
- [자산군 슬롯]의 key를 순서대로 모두, 하나씩 씁니다.
- reason: 어제 움직임의 이유 1문장. 입력(뉴스·catalyst·거시 지표)에 근거가 있을 때만 쓰고, 근거가 없으면 "reason" 키를 빼십시오. 추측으로 채우지 마십시오. 국내 직전 장이 끝난 뒤 열린 간밤 미국 장의 움직임을 국내 자산군의 이유로 들지 마십시오 — 시간 순서상 원인이 될 수 없습니다(간밤 미국 장은 오늘 국내 개장에 줄 신호로만 씁니다).
- ifHolding(갖고 있다면)·ifConsidering(새로 본다면): 각각 60자 이내의 조건·관찰형 문장입니다. "~라면 ~를 지켜볼 때입니다", "~가 확인되기 전까지는 ~를 따로 볼 자리입니다"처럼 무엇을 확인할지와 그 조건을 씁니다.
- 매수·매도·비중 조절을 지시하지 마십시오("사세요·파세요·담으세요·비중을 줄이세요·늘리세요" 같은 지시형 금지). 판단은 독자의 몫입니다.
- 대표 ETF는 화면에 "예시"로 표시됩니다. 특정 ETF를 추천 대상처럼 쓰지 마십시오.
- us-equity는 위 **환율 효과 방향** 규칙을 따릅니다.

[todayChecks 작성 규칙 — 오늘 확인할 것 3가지]
- todayChecks는 정확히 3개, 한국시간 순서로 씁니다.
- time: 한국시간 "HH:MM" 또는 "HH:MM~HH:MM"(예: "09:00~09:30"). 미국 지표는 [미국 주요 지표 일정] 블록이 있으면 그 한국시간을 그대로 쓰고, 한국 장 마감 후 발표는 그 줄에 적힌 발표 시점과 국내 반영일을 그대로 씁니다(예: "내일 밤 발표 → 국내 반영은 M/D(요일)").
- what: 무엇을 볼지(대상 ETF·지표).
- baseline: 무엇과 비교할지(전일 종가·전일 등락 방향·환율 수준 등 입력에 있는 기준).
- invalidation: 어긋나면 버릴 가설 한 문장.

[card 작성 규칙 — 링크 미리보기 카드 한 줄]
- card.key는 [자산군 슬롯]에서 정한 값을 그대로 씁니다.
- card.line: 40자 이내 평서문 한 줄. 자산군 문구("○○를 갖고 있다면")를 반복하지 말고, 그 자산군에서 오늘 지켜볼 점을 관찰형으로 씁니다. 질문형(?, ~까요, ~나요, ~인가) 금지, 숫자는 넣지 않습니다. 기간 비교·최상급 표현 금지는 [cover.headline 작성 규칙]과 같습니다.

[cover.headline 작성 규칙]

이 헤드라인은 개장 전 한국 개인투자자가 가장 먼저 만나는 한 줄이며, 페이지 제목이자 링크 미리보기 카드의 큰 제목입니다. 한국 신문 편집자가 쓰듯 씁니다.

${renderHeadlineStandard()}

${renderHeadlineExemplars(pickHeadlineExemplars('etf', recentHeadlines, data.date))}

1. 형태 (모든 tier 공통)
- 주어·핵심 사실을 앞세워 한 호흡으로 씁니다. 정확한 등락률·티커는 cover.subline 이 받칩니다.
- 제목에는 티커·6자리 코드 대신 한국어 명칭을 씁니다 (예: SOXX → 미 반도체, GDX → 금광주, TLT → 미 장기채).
- 등락률·티커를 제목 맨 앞 앵커로 두지 마십시오. 사건의 규모를 전하는 수치 하나(20원·45조·성장률 3.5% 상향 등)는 문장 안에 둘 수 있고, 코스피 7,000·환율 1,500원 같은 심리적 분기점 숫자는 앞에 와도 됩니다.${featured ? buildHeadlineSubjectRule(featured) : ''}

2. 종결
- 기사체 '~다' 또는 서술성 명사(급등·반등·마감·경신·진입·본격화 등)로 끝냅니다.
- '~다'는 짧은 기사체 술어로 씁니다. 목적어·부사가 늘어진 산문 문장은 표제어가 아닙니다.
- 피할 형태: 시간명사 종결("~한 날", "~한 밤", "~한 하루", "~한 주말", "~한 금요일"), "~ 다음 날,"로 시작하는 틀, 존댓말 '~습니다', 체크리스트형 어미("확인", "점검", "~해야").

3. 근거 상태(tier) (위 [오늘의 근거 상태] 참조 — 블록이 없으면 thin)
- 인과 표현의 강도는 [제목 편집 기준] 3을 따릅니다.
- hollow: 사실 모드. 은유를 만들지 않고 절제된 사실로 씁니다. catalyst 반영 의무는 없습니다.

4. 그 밖의 규칙
- catalyst 반영 (기본 + 예외): strong·thin 에서 [🔥 오늘의 forward catalyst] 항목이 있으면 사건을 근거로 반영합니다. [반복 회피 — 기본보다 우선] 같은 catalyst·anchor 가 [최근 ETF 리포트 헤드라인]에 이미 등장했으면 (a) 사건의 국면·단계를 다르게(진전→타결→후속/확산/정착) 쓰거나 (b) anchor 를 subline 으로 내리고 새 각도(환율·금·은·원유·국내 ETF 등 오늘 의미 있게 움직인 지표)로 씁니다.
- 시장 특정: "지수/시장/증시" 단독 표기 금지. 어느 시장인지 명시합니다(S&P500·나스닥·코스피 등 구체 명칭, 또는 "미·국내·채권" 수식어). 해외 시장의 섹터·자산을 가리키는 단어(반도체·바이오·유틸리티·부동산·기술주 등)에는 반드시 그 시장(미·미국·중국 등)을 붙입니다 — 한국 독자는 시장 표시 없는 섹터 이름을 국내 섹터로 읽습니다(예: 미국 섹터 이야기라면 "바이오·반도체 올랐다"가 아니라 "미 바이오·반도체 올랐다").
- 기간 비교·최상급 금지: 제목·카드 문구(cover.headline·card.line)에는 'N년치·N개월치', '역대·사상 최대/최고/최저', 'N년 만에 최고/최저', '연중 최고/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않습니다 — 입력 데이터로 확인되는 수치와 사실만 씁니다. (입력의 등락률은 직전 거래일 하루 기준이라 이런 주장은 확인할 수 없습니다.)
- 길이: 14~26자 권장, 최대 28자. 프리뷰는 3줄까지만 깔끔히 렌더되므로 보조 수치·맥락은 subline 으로 넘깁니다.
- summary와의 관계: summary 세 줄은 제목과 같은 주제를 다루되 제목 문장을 되풀이하지 않습니다. 어느 후보가 뽑혀도 맞도록 씁니다.

- cover.subline은 결론과 제약 조건을 함께 담습니다. 반드시 서술어가 있는 완결문으로 씁니다.

${EVIDENCE_RULES}

[준법·표현 규칙]
- **직접적인 매수 권유 어휘 금지**: "매수 후보", "접근 후보", "매수 검토", "신규 진입", "분할 접근", "비중 확대", "선호 ETF군" 등.
- 대신 독자가 자연스럽게 읽을 수 있는 **중립적 관찰 표현**을 상황에 맞게 골라 쓰십시오. 예: "관찰 대상", "지켜볼 상품", "눈여겨볼 ETF", "오늘 시선이 갈 만한 상품", "흐름을 읽어야 할 자리", "주목할 구간", "검토 대상", "확인할 포인트" 등.
- 같은 표현을 한 리포트 안에서 3회 이상 반복하지 마십시오. 문장마다 자연스럽게 바꿔 씁니다.
- "~확인합니다", "~봅니다", "~점검합니다" 같은 점검형 어미가 한 문단에 3회 넘게 반복되지 않도록 하십시오. "~이 의미 있습니다", "~에서 힌트를 얻을 수 있습니다", "~가 보여주는 이야기가 있습니다", "~가 오늘의 변수입니다" 같은 서술 방식을 섞어 씁니다.
- "전이"는 한 문단에 1회 이하로만 씁니다. 본문에서 "해외→국내" 연결을 서술할 때 문장 구조와 어휘를 매일 다르게 바꾸십시오.
- 숫자는 위 입력에 있는 값만 사용하십시오.
- 뉴스는 제목·출처·발행시각·URL(일부는 짧은 요약 ↳)이 제공된 참고 근거입니다. 제공된 제목·요약 밖의 기사 본문 내용을 단정하지 마십시오.
- "보도에 따르면", "전문가들은", "시장에서는" 같은 출처 없는 단정 표현을 쓰지 마십시오.
- "가능성이 존재합니다", "가능성이 있습니다", "구조입니다", "시사합니다", "나타냅니다", "판단됩니다", "보입니다"를 쓰지 마십시오.
- "직접 연결됩니다"를 쓰지 마십시오. "우호적 선행 신호", "거래대금으로 확인합니다"처럼 조건과 확인 지표를 함께 쓰십시오.
- "확인이 필요합니다"를 쓰지 마십시오. "거래대금", "NAV", "USD/KRW", "US 10Y"처럼 확인 대상을 직접 쓰십시오.
- "필수"를 쓰지 마십시오. 실행 기준과 확인 대상을 구체적으로 쓰십시오.
- "ETF은"처럼 어색한 조사를 쓰지 말고 "ETF는"으로 쓰십시오.
- 원화 금액은 긴 숫자로 쓰지 말고 "6,930억 원", "1.8조 원"처럼 축약하십시오.
- USD/KRW처럼 1,000 이상인 숫자는 반드시 쉼표를 넣어 "1,475"처럼 표기하십시오.
- 국내 ETF는 반드시 "종목명 (6자리 코드)"로 표기하십시오. (cover.headline 제외 — [cover.headline 작성 규칙] 참조) "122630.KS KODEX 레버리지"나 "122630.KS" 형식은 금지입니다.
  예: "KODEX 반도체 (091160)"처럼 코드를 괄호로 감쌉니다. 괄호 없는 "KODEX 반도체 091160"은 금지입니다.
- 자금 유입, 자금 유출, 순유입, 순유출, 영문 flow 표현을 쓰지 마십시오.
- 매수/매도 지시를 하지 말고 판단 재료와 확인 조건으로만 표현하십시오.

아래 JSON 형식으로만 응답하십시오:
{
  "cover": { "headlineCandidates": [ { "headline": "...", "subline": "..." }, { "headline": "...", "subline": "..." }, { "headline": "...", "subline": "..." } ] },
  "summary": { "overseas": "해외 신호 — 60자 이내", "domestic": "국내 상태 — 60자 이내", "focus": "오늘 핵심 — 60자 이내" },
  "assetCards": [
${assetCardsSchema}
  ],
  "todayChecks": [
    { "time": "HH:MM", "what": "...", "baseline": "...", "invalidation": "..." },
    { "time": "HH:MM", "what": "...", "baseline": "...", "invalidation": "..." },
    { "time": "HH:MM", "what": "...", "baseline": "...", "invalidation": "..." }
  ],
  "card": { "key": "${featured?.key ?? ''}", "line": "40자 이내 평서문" }${tacticalAlert ? `,
  "tacticalWarning": "1~2문장"` : ''}
}`
}
