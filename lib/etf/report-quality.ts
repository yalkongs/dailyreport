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

import type { CollectedData, MorningReport, MorningStrategyInput } from './types'

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
const ETF_OR_NUMBER_PATTERN = /([A-Z]{2,5}|[가-힣A-Za-z]+ ETF|ETF|USD\/KRW|US 10Y|VIX|NAV|거래대금|\d+(?:,\d{3})*(?:\.\d+)?%?)/

// ─── Soft fix: 리포트 전체 문자열 필드에 치환 적용 ──────────────────
function applySoftFix(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value
  let next = value
  for (const { pattern, replace } of SOFT_FIXES) {
    next = next.replace(pattern, replace)
  }
  return next
}

function applyToStringArray(arr: (string | undefined)[] | undefined): string[] | undefined {
  if (!arr) return arr
  return arr.map(s => applySoftFix(s) ?? '').filter(s => s.length > 0)
}

/**
 * P1: 검증 직전에 호출해 문체 이슈를 자동 치환.
 * in-place 수정 + 적용된 치환 목록 반환 (로깅용).
 */
export function applySoftFixesInPlace(report: MorningReport): string[] {
  const before = flattenMorningReport(report)
  const fixed: string[] = []

  report.cover.headline = applySoftFix(report.cover.headline) ?? report.cover.headline
  report.cover.subline = applySoftFix(report.cover.subline) ?? report.cover.subline
  report.overnightBrief.narrative =
    applySoftFix(report.overnightBrief.narrative) ?? report.overnightBrief.narrative
  report.overnightBrief.krImpact =
    applySoftFix(report.overnightBrief.krImpact) ?? report.overnightBrief.krImpact
  report.usEtfHighlights.topMover.reason =
    applySoftFix(report.usEtfHighlights.topMover.reason) ?? report.usEtfHighlights.topMover.reason
  report.usEtfHighlights.bottomMover.reason =
    applySoftFix(report.usEtfHighlights.bottomMover.reason) ??
    report.usEtfHighlights.bottomMover.reason
  report.usEtfHighlights.sectorNarrative =
    applySoftFix(report.usEtfHighlights.sectorNarrative) ?? report.usEtfHighlights.sectorNarrative
  report.todayWatch.items = report.todayWatch.items.map(item => ({
    title: applySoftFix(item.title) ?? item.title,
    body: applySoftFix(item.body) ?? item.body,
  }))
  report.closingLine = applySoftFix(report.closingLine) ?? report.closingLine

  const notes = report.narrativeNotes
  if (notes) {
    if (notes.storySpine) {
      notes.storySpine.act1 = applySoftFix(notes.storySpine.act1)
      notes.storySpine.act2 = applySoftFix(notes.storySpine.act2)
      notes.storySpine.act3 = applySoftFix(notes.storySpine.act3)
    }
    if (notes.characters) {
      notes.characters.primary = applySoftFix(notes.characters.primary)
      notes.characters.gate = applySoftFix(notes.characters.gate)
      notes.characters.alternative = applySoftFix(notes.characters.alternative)
      notes.characters.warning = applySoftFix(notes.characters.warning)
    }
    if (notes.resolutions) {
      notes.resolutions.connect = applySoftFix(notes.resolutions.connect)
      notes.resolutions.delay = applySoftFix(notes.resolutions.delay)
      notes.resolutions.overheat = applySoftFix(notes.resolutions.overheat)
    }
    if (notes.checklist) {
      notes.checklist.actions = applyToStringArray(notes.checklist.actions)
      notes.checklist.avoids = applyToStringArray(notes.checklist.avoids)
    }
    if (notes.strategyProse) {
      notes.strategyProse = notes.strategyProse.map(s => ({
        group: s.group,
        rationale: applySoftFix(s.rationale),
        actionGuide: applySoftFix(s.actionGuide),
        avoid: applySoftFix(s.avoid),
      }))
    }
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

function flattenMorningReport(report: MorningReport): string {
  const core: (string | undefined)[] = [
    report.cover.headline,
    report.cover.subline,
    report.overnightBrief.narrative,
    report.overnightBrief.krImpact,
    report.usEtfHighlights.topMover.reason,
    report.usEtfHighlights.bottomMover.reason,
    report.usEtfHighlights.sectorNarrative,
    ...report.todayWatch.items.flatMap(item => [item.title, item.body]),
    report.closingLine,
  ]

  const notes = report.narrativeNotes
  if (notes) {
    core.push(
      notes.storySpine?.act1,
      notes.storySpine?.act2,
      notes.storySpine?.act3,
      notes.characters?.primary,
      notes.characters?.gate,
      notes.characters?.alternative,
      notes.characters?.warning,
      notes.resolutions?.connect,
      notes.resolutions?.delay,
      notes.resolutions?.overheat,
      ...(notes.checklist?.actions ?? []),
      ...(notes.checklist?.avoids ?? []),
      ...(notes.strategyProse ?? []).flatMap(s => [s.rationale, s.actionGuide, s.avoid]),
    )
  }

  return core.filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n')
}

function findMatches(text: string, patterns: RegExp[]): string[] {
  return patterns.filter(p => p.test(text)).map(p => p.source)
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]?/g)?.map(s => s.trim()).filter(Boolean) ?? []
}

function duplicateSentences(text: string): string[] {
  const counts = new Map<string, number>()
  for (const sentence of splitSentences(text)) {
    const normalized = sentence.replace(/\s+/g, ' ')
    if (normalized.length < 18) continue
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
  // 중복 제거 + 최대 3건만 노출
  return [...new Set(hits)].slice(0, 3)
}

export function validateMorningReportQuality(
  report: MorningReport,
  data: CollectedData,
  strategy: MorningStrategyInput
): void {
  // P1: 검증 전에 소프트 픽스를 먼저 적용. 가벼운 문체 이슈로 재생성하지 않도록.
  const fixesApplied = applySoftFixesInPlace(report)
  if (fixesApplied.length > 0) {
    console.log(`  [soft-fix] 자동 교정 ${fixesApplied.length}건 적용: ${fixesApplied.join(', ')}`)
  }

  const text = flattenMorningReport(report)
  const violations: string[] = []

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

  const repeated = duplicateSentences(text)
  if (repeated.length > 0) {
    violations.push(`중복 문장 감지: ${repeated.slice(0, 2).join(' / ')}`)
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

  if (report.todayWatch.items.length < 3) {
    violations.push('Today Watch 항목은 국내 개장, 환율/금리, ETF 실행 리스크를 포함해 최소 3개가 필요합니다')
  }

  const vagueWatchItems = report.todayWatch.items.filter(item => !ETF_OR_NUMBER_PATTERN.test(item.body))
  if (vagueWatchItems.length > 0) {
    violations.push('Today Watch 각 항목은 ETF명, 수치, NAV, 거래대금 등 구체적 확인 대상을 포함해야 합니다')
  }

  const krImpactHasBridge = /(SOXX|QQQ|TLT|USD\/KRW|VIX|US 10Y).*(\(\d{6}\)|국내|KODEX|TIGER)|(\(\d{6}\)|국내|KODEX|TIGER).*(SOXX|QQQ|TLT|USD\/KRW|VIX|US 10Y)/.test(report.overnightBrief.krImpact)
  if (!krImpactHasBridge) {
    violations.push('krImpact는 해외 ETF 또는 거시지표와 국내 ETF 실행 확인점을 직접 연결해야 합니다')
  }

  // P3: 애매어 (지수/증시/시장 단독) — 한국 독자 오해 방지. 헤드라인/서브라인은
  // 특히 엄격히. 본문에서는 시장 수식어가 20자 창 안에 없을 때만 경고.
  const coverAmbiguous = findUnqualifiedAmbiguousWords(
    `${report.cover.headline}\n${report.cover.subline}`
  )
  if (coverAmbiguous.length > 0) {
    violations.push(
      `커버(헤드라인/서브라인)에 시장이 특정되지 않은 '지수/증시/시장' 표현: ${coverAmbiguous.join(' | ')}`
    )
  }
  const bodyAmbiguous = findUnqualifiedAmbiguousWords(text)
  if (bodyAmbiguous.length >= 3) {
    // 본문 3회 이상 누적되면 hard violation — 체계적 오남용
    violations.push(
      `시장 특정 없이 '지수/증시/시장' 표현이 3회 이상: ${bodyAmbiguous.join(' | ')}`
    )
  } else if (bodyAmbiguous.length > 0) {
    console.log(`  [soft-warn] 본문 애매어 ${bodyAmbiguous.length}건 (허용 한도 이하): ${bodyAmbiguous.join(' | ')}`)
  }

  if (violations.length > 0) {
    throw new Error(`[report-quality] Morning 리포트 품질 검증 실패\n- ${violations.join('\n- ')}`)
  }
}
