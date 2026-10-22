// lib/published-check.ts
// 발행물 정확성 검사(2026-10-23) — 고객이 보는 공개 페이지(Vercel)를 원천 시세(Yahoo)와 기계적으로 대조한다.
// 계기: 10/20~10/23 화~금 Market 카드의 코스피 줄무늬 맨 끝이 어제가 아니라 그저께였고, 운영자가 먼저 발견했다
// (야후 ^KS11 일봉이 최근 칸을 비움 — 0066b0a에서 수정). 눈이 아니라 매일 기계가 확인한다.
//
// 검사(한 줄 = 하나의 PASS/FAIL/SKIP):
//   Market /reports/DATE.html
//     M1 줄무늬 맨 끝(data-session) = 직전 한국 거래일                         (시세 무관)
//     M2 줄무늬 맨 끝 등락 = ^KS11 직전 거래일 등락(data-pct ±0.05%p, 없으면 색 부호)
//     M3 핵심 지표 코스피·S&P 500·나스닥 가격 ±0.1%·등락 ±0.05%p(24시간 지표는 SKIP)
//     M4 제목·카드 한 줄·세 줄 요약의 지수 등락 수치(표기 자릿수 반올림만 허용, 방향어 대조)
//     M5 og:image = 그날 미리보기 PNG(200 image/png), og:title = h1           (시세 무관)
//   ETF /etf-reports/DATE.html
//     E1 자산군 카드의 '예시' ETF 등락 = 시세 ±0.05%p
//     E2 모자이크 타일(data-ticker·data-pct, 없으면 색 부호)
//     E3 제목·세 줄 요약의 지수 등락 수치(M4와 같은 규칙)
//     E4 = M5                                                                    (시세 무관)
// 시점: 시세의 거래일(한국 Asia/Seoul·미국 America/New_York)이 그 날짜의 직전 거래일과 같을 때만 대조한다.
//   더 늦으면(오늘 장이 열림·과거 날짜) SKIP, 더 이르면(출처 지연) FAIL. 한국 휴장일은 리포트가 없으니 전부 SKIP.
// 견고성: 페이지·시세는 3번까지 다시 시도하고, 그래도 없으면 그에 기대는 검사는 FAIL(침묵은 통과가 아니다).
// 입출력(가져오기·시세)은 주입한다 — scripts/check-published.ts가 실제 fetch·yahoo-finance2를 넘긴다.

import { getMarketCalendarInfo, getPrevTradingDay } from './market-calendar'
import { sessionDate } from './etf/market-context'
import { claimMatches, extractNumericClaims, type ExactTolerance } from './etf/numeric-claims'
import { ALL_ETF_UNIVERSE } from './etf/universe'
import { decodeCharacterReferences } from './html-entities'

export type ReportKind = 'market' | 'etf'
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP'

export interface CheckResult {
  id: string
  kind: ReportKind
  status: CheckStatus
  title: string
  expected?: string
  actual?: string
  note?: string
}

export interface PageResponse { status: number; contentType: string; body: string }
/** GET 한 번. binary면 본문을 읽지 않아도 된다(PNG 확인용). 네트워크 오류는 throw. */
export type PageFetcher = (url: string, opts?: { binary?: boolean }) => Promise<PageResponse>

export interface QuoteSnapshot { symbol: string; price: number | null; changePercent: number | null; marketTime: Date | null; previousClose?: number | null }
/** 여러 종목 시세를 한 번에. 없는 종목은 결과에서 빠져도 된다(야후 배치가 그렇다). 실패는 throw. */
export type QuoteProvider = (symbols: string[]) => Promise<QuoteSnapshot[]>

/** 시세 하나를 이 날짜 기준으로 판정한 결과 — ok일 때만 대조한다. */
export type QuoteEval =
  | { state: 'ok'; symbol: string; session: string; price: number | null; changePercent: number; previousClose?: number | null }
  | { state: 'skip'; symbol: string; note: string }
  | { state: 'fail'; symbol: string; note: string }

export interface PublishedCheckOptions {
  date: string
  base?: string
  kinds?: ReportKind[]
  fetchPage: PageFetcher
  fetchQuotes: QuoteProvider
  /** 오늘(KST) — 장중 SKIP과 과거 날짜 SKIP의 문구를 가른다. 기본 = 지금의 KST 날짜. */
  today?: string
  /** Market 카드 한 줄 — HTML에는 없고 PNG·data/reports-index.json에만 있다. undefined·null이면 확인 불가로 적는다. */
  marketCardLine?: string | null
  sleep?: (ms: number) => Promise<void>
  retryBaseMs?: number
}

export const DEFAULT_BASE = 'https://dailyreport-eta.vercel.app'
const PCT_TOLERANCE = 0.05 // %p — data-pct·예시 ETF·모자이크·핵심 지표 등락
const PRICE_TOLERANCE = 0.001 // 0.1% — 핵심 지표 가격
const NEUTRAL_FILL = '#E7EAEE' // lib/preview/data-card.ts diverging()의 보합 색(|등락|<0.1)
const NEUTRAL_BAND = 0.1
/** 발행물 수치 주장: 표기 자릿수 반올림만 허용(소수 한 자리 ±0.06, 두 자리 ±0.006, 정수 ±0.6). */
const PUBLISHED_TOLERANCE: ExactTolerance = (decimals) => 0.6 * 10 ** -decimals
const MAX_LISTED = 10

// ── 공용 ────────────────────────────────────────────────────────────────

export function kstToday(now: Date = new Date()): string {
  return sessionDate(now, 'Asia/Seoul') as string
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** fn을 최대 attempts번(기본 3) 시도한다. 실패 사이에 baseMs·2배씩 기다린다. 마지막 오류를 던진다. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 1000
  const sleep = opts.sleep ?? realSleep
  let last: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i)
    } catch (e) {
      last = e
      if (i < attempts) await sleep(baseMs * 2 ** (i - 1))
    }
  }
  throw last
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function fmtPct(p: number): string {
  return `${p > 0 ? '+' : ''}${p.toFixed(2)}%`
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** '-3.52%' '+0.28%' '−1.2%' → 숫자. '-'·빈 칸은 null. */
function parsePct(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.replace(/[−–]/g, '-').replace(/[%p\s,]/g, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** '5,533.77' '$81,373' → 숫자. */
function parseNumber(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.replace(/[$,\s원]/g, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

// ── HTML 읽기(우리 렌더러가 만든 정적 HTML — 정규식으로 충분) ───────────────

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? decodeCharacterReferences(m[1]) : null
}

/** 보이는 글자: ETF 칩의 코드 표기를 빼고 태그를 벗기고 문자 참조를 풀고 공백을 하나로. */
export function visibleText(fragment: string): string {
  return decodeCharacterReferences(
    fragment
      .replace(/<span class="etf-chip-code">[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]*>/g, ''),
  ).replace(/\s+/g, ' ').trim()
}

/** data-section="name" 이 있는 요소부터 다음 data-section 직전까지. */
function section(html: string, name: string): string | null {
  const start = html.indexOf(`data-section="${name}"`)
  if (start < 0) return null
  const next = html.indexOf('data-section="', start + 1)
  return html.slice(start, next < 0 ? undefined : next)
}

function between(html: string, startMarker: string, endMarker: string): string | null {
  const start = html.indexOf(startMarker)
  if (start < 0) return null
  const end = html.indexOf(endMarker, start)
  return html.slice(start, end < 0 ? undefined : end)
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (attr(tag, 'property') === property || attr(tag, 'name') === property) return attr(tag, 'content')
  }
  return null
}

function h1Text(html: string): string | null {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)
  return m ? visibleText(m[1]) : null
}

function summaryTexts(html: string): string[] {
  const box = section(html, 'summary')
  if (!box) return []
  return [...box.matchAll(/<li class="summary-row">([\s\S]*?)<\/li>/g)]
    .map((m) => visibleText(m[1].replace(/<span class="summary-label">[\s\S]*?<\/span>/, '').replace(/<span class="summary-arrow"[^>]*>[\s\S]*?<\/span>/, '')))
    .filter(Boolean)
}

interface Stripe { session: string; pct: number | null; fill: string }
function parseStripes(html: string): Stripe[] {
  const group = between(html, '<g data-role="stripes">', '</svg>')
  if (!group) return []
  return (group.match(/<rect\b[^>]*\bdata-session="[^"]*"[^>]*>/g) ?? []).map((tag) => ({
    session: attr(tag, 'data-session') ?? '',
    pct: parsePct(attr(tag, 'data-pct')),
    fill: attr(tag, 'fill') ?? '',
  }))
}

interface Tile { ticker: string | null; pct: number | null; fill: string }
function parseMosaic(html: string): Tile[] | null {
  const group = between(html, '<g data-role="mosaic">', '</svg>')
  if (!group) return null
  // 타일만 둥근 모서리(rx)가 있다 — 배경 사각형은 없다.
  return (group.match(/<rect\b[^>]*\brx="[^"]*"[^>]*>/g) ?? []).map((tag) => ({
    ticker: attr(tag, 'data-ticker'),
    pct: parsePct(attr(tag, 'data-pct')),
    fill: attr(tag, 'fill') ?? '',
  }))
}

interface Indicator { label: string; value: string; change: string }
function parseKeyIndicators(html: string): Indicator[] | null {
  const box = section(html, 'key-indicators')
  if (!box) return null
  return box.split('<div class="pulse-card').slice(1).map((card) => ({
    label: visibleText(card.match(/class="label">([\s\S]*?)<\/div>/)?.[1] ?? ''),
    value: visibleText(card.match(/class="value">([\s\S]*?)<\/div>/)?.[1] ?? ''),
    change: visibleText(card.match(/class="change[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? ''),
  }))
}

interface Rep { asset: string; name: string; code: string; changeText: string }
function parseReps(html: string): Rep[] | null {
  const box = section(html, 'asset-cards')
  if (!box) return null
  const reps: Rep[] = []
  for (const card of box.split('<article class="asset-card"').slice(1)) {
    const asset = visibleText(card.match(/class="asset-label">([\s\S]*?)<\/div>/)?.[1] ?? '')
    for (const row of card.matchAll(/<li class="rep-row">([\s\S]*?)<\/li>/g)) {
      reps.push({
        asset,
        name: visibleText(row[1].match(/class="rep-name">([\s\S]*?)<\/span>/)?.[1] ?? ''),
        code: visibleText(row[1].match(/class="rep-code">([\s\S]*?)<\/span>/)?.[1] ?? ''),
        changeText: visibleText(row[1].match(/class="[^"]*\brep-change\b[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? ''),
      })
    }
  }
  return reps
}

// ── 색 부호(data-pct 없는 옛 페이지) ────────────────────────────────────────

/**
 * 줄무늬·타일 색 → 방향. diverging(): 보합(|r|<0.1)은 #E7EAEE, 상승은 회색→빨강(R>B), 하락은 회색→파랑(B>R).
 * 팔레트 전 구간에서 성립한다(테스트가 0.1~12%를 훑는다). 색이 아니면 null.
 */
export function colorSign(fill: string): 'up' | 'down' | 'flat' | null {
  const m = fill.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return null
  if (`#${m[1].toUpperCase()}` === NEUTRAL_FILL) return 'flat'
  const r = parseInt(m[1].slice(0, 2), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  return r > b ? 'up' : b > r ? 'down' : 'flat'
}

const SIGN_KO = { up: '상승(빨강)', down: '하락(파랑)', flat: '보합(회색)' } as const

/** 페이지 색 방향이 시세와 맞는가 — 색 경계(0.1)에 ±0.05%p 여유. */
function colorConsistent(sign: 'up' | 'down' | 'flat', q: number): boolean {
  if (sign === 'flat') return Math.abs(q) < NEUTRAL_BAND + PCT_TOLERANCE
  return sign === 'up' ? q >= NEUTRAL_BAND - PCT_TOLERANCE : q <= -(NEUTRAL_BAND - PCT_TOLERANCE)
}

// ── 시세 판정 ────────────────────────────────────────────────────────────

interface QuoteContext {
  date: string
  today: string
  krExpected: string
  usExpected: string
  quotes: Map<string, QuoteSnapshot>
  quoteError: string | null
}

function marketOfSymbol(symbol: string): 'KR' | 'US' {
  return /^\^K[SQ]11$/.test(symbol) || /\.(KS|KQ)$/i.test(symbol) ? 'KR' : 'US'
}

function evalQuote(ctx: QuoteContext, symbol: string): QuoteEval {
  if (ctx.quoteError) return { state: 'fail', symbol, note: `시세 조회 실패: ${ctx.quoteError}` }
  const q = ctx.quotes.get(symbol)
  if (!q || typeof q.changePercent !== 'number' || !Number.isFinite(q.changePercent)) {
    return { state: 'fail', symbol, note: `시세 없음(${symbol})` }
  }
  const market = marketOfSymbol(symbol)
  const session = sessionDate(q.marketTime, market === 'KR' ? 'Asia/Seoul' : 'America/New_York')
  if (!session) return { state: 'fail', symbol, note: `시세 시각 없음(${symbol})` }
  const expected = market === 'KR' ? ctx.krExpected : ctx.usExpected
  if (session === expected) return { state: 'ok', symbol, session, price: q.price, changePercent: q.changePercent, previousClose: q.previousClose ?? null }
  if (session > expected) {
    if (ctx.date === ctx.today) {
      const what = market === 'KR' ? '장중 — 직전 거래일 시세 아님' : '미국 장중 — 직전 거래일 시세 아님'
      return { state: 'skip', symbol, note: `${what}(${symbol} 시세 ${session}, 기대 ${expected})` }
    }
    return { state: 'skip', symbol, note: `과거 날짜 — 현재 시세(${symbol} ${session})는 ${ctx.date}의 직전 거래일(${expected}) 시세가 아님` }
  }
  return { state: 'fail', symbol, note: `오래된 시세 — ${symbol} 거래일 ${session}이 기대 ${expected}보다 이르다(출처 지연)` }
}

/**
 * 대조에 쓴 시세의 출처 표기. 불일치일 때는 시세의 이전 종가도 적는다 — 야후 시세가 틀린 날(10/23 ^KQ11: 이전 종가가
 * 10/21이 아니라 10/20 종가로 남아 -3.62%가 -2.29%로 보였다)을 메일만 보고 가려낼 수 있게.
 */
function basis(ev: Extract<QuoteEval, { state: 'ok' }>, mismatch: boolean): string {
  const prev = mismatch && typeof ev.previousClose === 'number' ? ` · 시세 이전 종가 ${fmtNum(ev.previousClose)}` : ''
  return `${ev.symbol} ${ev.session}${prev}`
}

function notOk(ev: Exclude<QuoteEval, { state: 'ok' }>): CheckStatus {
  return ev.state === 'skip' ? 'SKIP' : 'FAIL'
}

// 수치 주장의 대상 지수 — 이름은 lib/etf/numeric-claims.ts INDEX_NAME_PATTERNS의 이름과 같다.
const CLAIM_INDEX_SYMBOLS: Record<string, string> = {
  코스피: '^KS11', 코스닥: '^KQ11', 'S&P500': '^GSPC', 나스닥: '^IXIC', 다우: '^DJI', '필라델피아 반도체지수': '^SOX',
}

// 핵심 지표 라벨 → 심볼(지수만). 나머지 라벨은 SKIP 사유를 단다.
const KEY_INDICATOR_SYMBOLS: Record<string, string> = { 코스피: '^KS11', 'S&P 500': '^GSPC', 나스닥: '^IXIC' }
const REQUIRED_KEY_INDICATORS = Object.keys(KEY_INDICATOR_SYMBOLS)
function keyIndicatorSkipNote(label: string): string {
  if (/원\/달러|달러|엔|위안|유로/.test(label)) return '환율 — 24시간 거래(수집 시점 값이라 지금 시세와 다를 수 있음)'
  if (/10년물|국채|금리/.test(label)) return '금리 — %p 표기, 24시간 국채 시장(대조 대상 아님)'
  if (/원유|WTI|브렌트|금|은|비트코인|이더리움/.test(label)) return '원자재·가상자산 — 24시간 거래(대조 대상 아님)'
  return '대조 대상 아님'
}

// ── 개별 검사 ────────────────────────────────────────────────────────────

function checkStripeDate(stripes: Stripe[], date: string): CheckResult {
  const expected = getPrevTradingDay(date, 'kr')
  const base = { id: 'M1', kind: 'market' as const, title: '줄무늬 맨 끝 = 직전 한국 거래일', expected }
  const last = stripes.at(-1)
  if (!last) return { ...base, status: 'FAIL', actual: '없음', note: '코스피 줄무늬(data-session)를 찾지 못함' }
  return { ...base, status: last.session === expected ? 'PASS' : 'FAIL', actual: last.session }
}

function checkStripeValue(stripes: Stripe[], ev: QuoteEval): CheckResult {
  const base = { id: 'M2', kind: 'market' as const, title: '줄무늬 맨 끝 등락 = 코스피 직전 거래일 시세' }
  const last = stripes.at(-1)
  if (!last) return { ...base, status: 'FAIL', actual: '없음', note: '코스피 줄무늬를 찾지 못함' }
  const shown = last.pct !== null ? fmtPct(last.pct) : `${SIGN_KO[colorSign(last.fill) ?? 'flat']} ${last.fill}`
  if (ev.state !== 'ok') return { ...base, status: notOk(ev), actual: shown, note: ev.note }
  const q = ev.changePercent
  const where = `맨 끝 ${last.session} · ${ev.symbol} ${ev.session}`
  if (last.pct !== null) {
    const ok = Math.abs(last.pct - q) <= PCT_TOLERANCE
    return { ...base, status: ok ? 'PASS' : 'FAIL', expected: fmtPct(q), actual: fmtPct(last.pct), note: `맨 끝 ${last.session} · ${basis(ev, !ok)} · 허용 ±${PCT_TOLERANCE}%p` }
  }
  const sign = colorSign(last.fill)
  if (!sign) return { ...base, status: 'FAIL', expected: fmtPct(q), actual: last.fill || '색 없음', note: `${where} · data-pct 없음, 색도 읽을 수 없음` }
  const consistent = colorConsistent(sign, q)
  return {
    ...base,
    status: consistent ? 'PASS' : 'FAIL',
    expected: fmtPct(q),
    actual: shown,
    note: `맨 끝 ${last.session} · ${basis(ev, !consistent)} · data-pct 없음 — 색 부호로 판정`,
  }
}

function checkKeyIndicators(indicators: Indicator[] | null, ctx: QuoteContext): CheckResult[] {
  const base = { id: 'M3', kind: 'market' as const }
  if (!indicators || indicators.length === 0) {
    return [{ ...base, title: '핵심 지표', status: 'FAIL', note: '핵심 지표(data-section="key-indicators")를 찾지 못함' }]
  }
  const out: CheckResult[] = []
  for (const label of REQUIRED_KEY_INDICATORS) {
    if (!indicators.some((i) => i.label === label)) out.push({ ...base, title: `핵심 지표 ${label}`, status: 'FAIL', actual: '없음', note: '페이지에 이 지표가 없음' })
  }
  for (const ind of indicators) {
    const title = `핵심 지표 ${ind.label}`
    const actual = `${ind.value} / ${ind.change}`
    const symbol = KEY_INDICATOR_SYMBOLS[ind.label]
    if (!symbol) {
      out.push({ ...base, title, status: 'SKIP', actual, note: keyIndicatorSkipNote(ind.label) })
      continue
    }
    const ev = evalQuote(ctx, symbol)
    if (ev.state !== 'ok') {
      out.push({ ...base, title, status: notOk(ev), actual, note: ev.note })
      continue
    }
    const value = parseNumber(ind.value)
    const change = parsePct(ind.change)
    const problems: string[] = []
    if (ev.price === null || value === null || Math.abs(value - ev.price) / Math.abs(ev.price) > PRICE_TOLERANCE) problems.push('가격')
    if (change === null || Math.abs(change - ev.changePercent) > PCT_TOLERANCE) problems.push('등락')
    out.push({
      ...base,
      title,
      status: problems.length ? 'FAIL' : 'PASS',
      expected: `${ev.price === null ? '?' : fmtNum(ev.price)} / ${fmtPct(ev.changePercent)}`,
      actual,
      note: `${basis(ev, problems.length > 0)} · 가격 ±0.1%, 등락 ±${PCT_TOLERANCE}%p${problems.length ? ` · 불일치: ${problems.join('·')}` : ''}`,
    })
  }
  return out
}

/**
 * 제목·카드 한 줄·요약의 지수 등락 주장(코스피 3.3% 반등, 나스닥이 2.14% 밀렸다 …)을 시세와 대조한다.
 * 짝짓기는 lib/etf/numeric-claims.ts(파이프라인 게이트와 같은 규칙), 판정만 표기 자릿수 반올림으로 엄격하게.
 * 대상 지수 시세가 장중·과거 날짜면 그 주장은 SKIP, 시세가 없으면 FAIL.
 */
export function checkIndexClaims(
  id: string,
  kind: ReportKind,
  texts: Array<{ source: string; text: string }>,
  evals: Record<string, QuoteEval>,
  notes: string[] = [],
): CheckResult {
  const passed: string[] = []
  const failed: string[] = []
  const skipped: string[] = []
  const reasons = new Set<string>()
  for (const { source, text } of texts) {
    for (const p of extractNumericClaims(text, [], [])) {
      const where = `${source}: ${p.label} ${p.quoted}`
      const ev = evals[p.label]
      if (!ev) {
        skipped.push(`${where}(대조 시세 없음)`)
      } else if (ev.state === 'skip') {
        skipped.push(`${where}(${ev.note})`)
      } else if (ev.state === 'fail') {
        failed.push(`${where} — ${ev.note}`)
        reasons.add(ev.note)
      } else if (claimMatches(p.claim, ev.changePercent, PUBLISHED_TOLERANCE)) {
        passed.push(`${where} ≈ ${fmtPct(ev.changePercent)}`)
      } else {
        failed.push(`${where} ≠ 실제 ${fmtPct(ev.changePercent)}(${basis(ev, true)})`)
      }
    }
  }
  const status: CheckStatus = failed.length ? 'FAIL' : passed.length ? 'PASS' : 'SKIP'
  const allNotes = [...reasons, ...skipped.map((s) => `SKIP ${s}`), ...notes]
  if (status === 'SKIP' && skipped.length === 0) allNotes.unshift('대조할 지수 등락 수치가 없음')
  return {
    id,
    kind,
    title: '제목·카드·요약의 지수 등락 수치',
    status,
    expected: '지수 시세와 표기 반올림 이내(1자리 ±0.06·2자리 ±0.006·N%대/넘게 하한), 방향어 일치',
    actual: failed.length ? failed.join('; ') : passed.join('; ') || '-',
    note: allNotes.length ? allNotes.join(' · ') : undefined,
  }
}

async function checkMeta(
  id: string,
  kind: ReportKind,
  html: string,
  pageUrl: string,
  date: string,
  fetchPng: (url: string) => Promise<PageResponse>,
): Promise<CheckResult> {
  const dir = kind === 'market' ? 'reports' : 'etf-reports'
  const expectedPath = `/${dir}/${date}-preview.png`
  const base = { id, kind, title: 'og:image = 그날 미리보기 PNG(200 image/png), og:title = h1', expected: `${expectedPath} · 200 image/png · og:title = h1` }
  const problems: string[] = []
  const parts: string[] = []
  const ogImage = metaContent(html, 'og:image')
  if (!ogImage) {
    problems.push('og:image 없음')
    parts.push('og:image 없음')
  } else {
    let url: URL | null = null
    try {
      url = new URL(ogImage, pageUrl)
    } catch {
      problems.push(`og:image 주소를 읽을 수 없음(${ogImage})`)
    }
    if (url) {
      parts.push(url.pathname)
      if (url.pathname !== expectedPath) problems.push(`og:image가 ${url.pathname}`)
      try {
        const res = await fetchPng(url.toString())
        parts.push(`${res.status} ${res.contentType || '-'}`)
        if (res.status !== 200 || !/^image\/png\b/i.test(res.contentType)) problems.push(`미리보기 PNG 응답 ${res.status} ${res.contentType || '-'}`)
      } catch (e) {
        parts.push('PNG 가져오기 실패')
        problems.push(`미리보기 PNG를 가져오지 못함: ${errText(e)}`)
      }
    }
  }
  const ogTitle = metaContent(html, 'og:title')
  const h1 = h1Text(html)
  const norm = (s: string) => s.replace(/\s*\(\s*[0-9][0-9A-Z]{5}\s*\)/g, '').replace(/\b([0-9][0-9A-Z]{5})\.(KS|KQ)\b/gi, '$1').replace(/\s+/g, ' ').trim()
  if (!ogTitle || !h1) {
    problems.push(!ogTitle ? 'og:title 없음' : 'h1 없음')
    parts.push('og:title·h1 확인 불가')
  } else if (norm(ogTitle) !== norm(h1)) {
    problems.push(`og:title "${ogTitle}" ≠ h1 "${h1}"`)
    parts.push('og:title ≠ h1')
  } else {
    parts.push('og:title = h1')
  }
  return { ...base, status: problems.length ? 'FAIL' : 'PASS', actual: parts.join(' · '), note: problems.length ? problems.join(' · ') : undefined }
}

/** 예시 ETF 코드(6자리 국내 코드 — 영숫자 포함 — 또는 미국 티커) → 시세 심볼. */
function repSymbol(code: string): string {
  const def = ALL_ETF_UNIVERSE.find((e) => e.ticker === code || e.ticker.replace(/\.(KS|KQ)$/i, '') === code)
  if (def) return def.ticker
  return /^[0-9][0-9A-Z]{5}$/.test(code) ? `${code}.KS` : code
}

function checkReps(reps: Rep[] | null, ctx: QuoteContext): CheckResult[] {
  const base = { id: 'E1', kind: 'etf' as const }
  if (!reps || reps.length === 0) return [{ ...base, title: '예시 ETF', status: 'FAIL', note: '자산군 카드의 예시 ETF(rep-row)를 찾지 못함' }]
  return reps.map((rep): CheckResult => {
    const title = `예시 ETF ${rep.asset} · ${rep.name} ${rep.code}`
    const page = parsePct(rep.changeText)
    if (!rep.code) return { ...base, title, status: 'FAIL', actual: rep.changeText, note: '코드 없음' }
    const symbol = repSymbol(rep.code)
    if (page === null) return { ...base, title, status: 'FAIL', actual: rep.changeText || '없음', note: `페이지 등락을 읽을 수 없음(${symbol})` }
    const ev = evalQuote(ctx, symbol)
    if (ev.state !== 'ok') return { ...base, title, status: notOk(ev), actual: fmtPct(page), note: ev.note }
    const ok = Math.abs(page - ev.changePercent) <= PCT_TOLERANCE
    return { ...base, title, status: ok ? 'PASS' : 'FAIL', expected: fmtPct(ev.changePercent), actual: fmtPct(page), note: `${basis(ev, !ok)} · 허용 ±${PCT_TOLERANCE}%p` }
  })
}

function checkMosaic(tiles: Tile[] | null, ctx: QuoteContext): CheckResult {
  const base = { id: 'E2', kind: 'etf' as const, title: '모자이크 타일 등락 = 시세', expected: `data-pct ±${PCT_TOLERANCE}%p(없으면 색 부호)` }
  if (!tiles) return { ...base, status: 'FAIL', note: '모자이크(data-role="mosaic")를 찾지 못함' }
  let checked = 0
  let noTicker = 0
  let byColor = 0
  const mismatches: string[] = []
  const sourceFails: string[] = []
  const skipNotes = new Map<string, number>()
  for (const t of tiles) {
    if (!t.ticker) {
      noTicker++
      continue
    }
    const ev = evalQuote(ctx, t.ticker)
    if (ev.state === 'skip') {
      const key = ev.note.replace(/\([^)]*\)$/, '').replace(/현재 시세\([^)]*\)/, '현재 시세')
      skipNotes.set(key, (skipNotes.get(key) ?? 0) + 1)
      continue
    }
    if (ev.state === 'fail') {
      sourceFails.push(ev.note)
      continue
    }
    checked++
    if (t.pct !== null) {
      if (Math.abs(t.pct - ev.changePercent) > PCT_TOLERANCE) mismatches.push(`${t.ticker} ${fmtPct(t.pct)} ≠ 시세 ${fmtPct(ev.changePercent)}`)
    } else {
      byColor++
      const sign = colorSign(t.fill)
      if (!sign || !colorConsistent(sign, ev.changePercent)) mismatches.push(`${t.ticker} ${sign ? SIGN_KO[sign] : t.fill} ≠ 시세 ${fmtPct(ev.changePercent)}`)
    }
  }
  const notes: string[] = []
  if (sourceFails.length) notes.push(`시세 문제 ${sourceFails.length}개: ${[...new Set(sourceFails)].slice(0, 3).join(' · ')}`)
  for (const [note, n] of skipNotes) notes.push(`SKIP ${n}개: ${note}`)
  if (byColor) notes.push(`${byColor}개는 data-pct 없음 — 색 부호로 판정`)
  if (noTicker) notes.push(`data-ticker 없는 타일 ${noTicker}개 — 대조 불가`)
  const status: CheckStatus = mismatches.length || sourceFails.length ? 'FAIL' : checked > 0 ? 'PASS' : 'SKIP'
  const listed = mismatches.slice(0, MAX_LISTED).join('; ') + (mismatches.length > MAX_LISTED ? ` 외 ${mismatches.length - MAX_LISTED}개` : '')
  return {
    ...base,
    status,
    actual: mismatches.length ? `불일치 ${mismatches.length}개/${checked}개: ${listed}` : `${checked}개 대조, 불일치 0개`,
    note: notes.length ? notes.join(' · ') : undefined,
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────────

interface PageSpec { kind: ReportKind; url: string; ids: string[]; titles: string[] }

function pageSpec(kind: ReportKind, base: string, date: string): PageSpec {
  return kind === 'market'
    ? { kind, url: `${base}/reports/${date}.html`, ids: ['M1', 'M2', 'M3', 'M4', 'M5'], titles: ['줄무늬 맨 끝 = 직전 한국 거래일', '줄무늬 맨 끝 등락 = 코스피 직전 거래일 시세', '핵심 지표', '제목·카드·요약의 지수 등락 수치', 'og:image·og:title'] }
    : { kind, url: `${base}/etf-reports/${date}.html`, ids: ['E1', 'E2', 'E3', 'E4'], titles: ['예시 ETF', '모자이크 타일 등락 = 시세', '제목·요약의 지수 등락 수치', 'og:image·og:title'] }
}

export async function runPublishedChecks(opts: PublishedCheckOptions): Promise<CheckResult[]> {
  const { date } = opts
  const base = (opts.base ?? DEFAULT_BASE).replace(/\/+$/, '')
  const kinds = opts.kinds ?? ['market', 'etf']
  const today = opts.today ?? kstToday()
  const retry = { attempts: 3, baseMs: opts.retryBaseMs ?? 1000, sleep: opts.sleep ?? realSleep }

  // 한국 휴장일 — 파이프라인이 리포트를 만들지 않는 날(check-delivery와 같은 기준). 경보 금지.
  const cal = getMarketCalendarInfo(date)
  if (cal.krStatus !== 'open') {
    return kinds.map((kind) => ({
      id: kind === 'market' ? 'M0' : 'E0', kind, status: 'SKIP' as const, title: '발행 여부',
      note: `한국 휴장(${cal.krHolidayName ?? '주말'}) — 리포트 없음`,
    }))
  }

  // 1) 페이지 — 3번까지(오류·200 아님 모두 다시 시도)
  const pages = new Map<ReportKind, { spec: PageSpec; html: string | null; error: string | null }>()
  for (const kind of kinds) {
    const spec = pageSpec(kind, base, date)
    try {
      const html = await withRetry(async () => {
        const res = await opts.fetchPage(spec.url)
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
        return res.body
      }, retry)
      pages.set(kind, { spec, html, error: null })
    } catch (e) {
      pages.set(kind, { spec, html: null, error: `${errText(e)}(${retry.attempts}회 시도)` })
    }
  }

  // 2) 시세 — 필요한 종목을 모아 한 번에(빠진 종목은 한 번 더 묻는다)
  const market = pages.get('market')?.html ?? null
  const etf = pages.get('etf')?.html ?? null
  const reps = etf ? parseReps(etf) : null
  const tiles = etf ? parseMosaic(etf) : null
  const symbols = new Set<string>(Object.values(CLAIM_INDEX_SYMBOLS))
  for (const r of reps ?? []) if (r.code) symbols.add(repSymbol(r.code))
  for (const t of tiles ?? []) if (t.ticker) symbols.add(t.ticker)
  const quotes = new Map<string, QuoteSnapshot>()
  let quoteError: string | null = null
  if (market || etf) {
    try {
      for (const q of await withRetry(() => opts.fetchQuotes([...symbols]), retry)) quotes.set(q.symbol, q)
      const missing = [...symbols].filter((s) => !quotes.has(s))
      if (missing.length) {
        for (const q of await opts.fetchQuotes(missing).catch(() => [] as QuoteSnapshot[])) quotes.set(q.symbol, q)
      }
    } catch (e) {
      quoteError = `${errText(e)}(${retry.attempts}회 시도)`
    }
  }
  const ctx: QuoteContext = {
    date, today, quotes, quoteError,
    krExpected: getPrevTradingDay(date, 'kr'),
    usExpected: getPrevTradingDay(date, 'us'),
  }
  const indexEvals: Record<string, QuoteEval> = {}
  for (const [label, symbol] of Object.entries(CLAIM_INDEX_SYMBOLS)) indexEvals[label] = evalQuote(ctx, symbol)
  const fetchPng = (url: string) => withRetry(async () => {
    const res = await opts.fetchPage(url, { binary: true })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    return res
  }, retry).catch((e) => ({ status: 0, contentType: errText(e), body: '' }))

  // 3) 검사
  const results: CheckResult[] = []
  for (const kind of kinds) {
    const page = pages.get(kind)!
    if (page.html === null) {
      page.spec.ids.forEach((id, i) => results.push({ id, kind, status: 'FAIL', title: page.spec.titles[i], note: `페이지를 가져오지 못함: ${page.spec.url} — ${page.error}` }))
      continue
    }
    const html = page.html
    if (kind === 'market') {
      const stripes = parseStripes(html)
      results.push(checkStripeDate(stripes, date))
      results.push(checkStripeValue(stripes, evalQuote(ctx, '^KS11')))
      results.push(...checkKeyIndicators(parseKeyIndicators(html), ctx))
      const card = opts.marketCardLine?.trim()
      const texts = [{ source: '제목', text: h1Text(html) ?? '' }, ...(card ? [{ source: '카드', text: card }] : []), ...summaryTexts(html).map((text) => ({ source: '요약', text }))]
      results.push(checkIndexClaims('M4', 'market', texts, indexEvals, card ? [] : ['카드 한 줄: 데이터 인덱스(data/reports-index.json)에 없어 확인 불가']))
      results.push(await checkMeta('M5', 'market', html, page.spec.url, date, fetchPng))
    } else {
      results.push(...checkReps(reps, ctx))
      results.push(checkMosaic(tiles, ctx))
      const texts = [{ source: '제목', text: h1Text(html) ?? '' }, ...summaryTexts(html).map((text) => ({ source: '요약', text }))]
      const e3 = checkIndexClaims('E3', 'etf', texts, indexEvals, ['카드 한 줄: PNG에만 있고 텍스트로 저장되지 않아 확인 불가'])
      results.push({ ...e3, title: '제목·요약의 지수 등락 수치' })
      results.push(await checkMeta('E4', 'etf', html, page.spec.url, date, fetchPng))
    }
  }
  return results
}

// ── CLI 도우미 ───────────────────────────────────────────────────────────

export function parseCliArgs(argv: string[], today: string): { date: string; base: string; kinds: ReportKind[] } {
  let date = today
  let base = DEFAULT_BASE
  let kinds: ReportKind[] = ['market', 'etf']
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--date' || flag === '--base' || flag === '--kind') {
      if (value === undefined) throw new Error(`${flag} 값이 없습니다`)
      i++
      if (flag === '--date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--date는 YYYY-MM-DD 여야 합니다: ${value}`)
        date = value
      } else if (flag === '--base') {
        if (!/^https?:\/\//.test(value)) throw new Error(`--base는 http(s) 주소여야 합니다: ${value}`)
        base = value.replace(/\/+$/, '')
      } else {
        if (value === 'all') kinds = ['market', 'etf']
        else if (value === 'market' || value === 'etf') kinds = [value]
        else throw new Error(`--kind는 market|etf|all 중 하나입니다: ${value}`)
      }
    } else {
      throw new Error(`알 수 없는 인자: ${flag} (사용법: check-published.ts [--date YYYY-MM-DD] [--base URL] [--kind market|etf|all])`)
    }
  }
  return { date, base, kinds }
}

export function formatLine(r: CheckResult): string {
  const parts = [`${r.status.padEnd(4)} ${r.id} [${r.kind}] ${r.title}`]
  if (r.expected !== undefined) parts.push(`expected ${r.expected}`)
  if (r.actual !== undefined) parts.push(`actual ${r.actual}`)
  if (r.note) parts.push(r.note.replace(/\s*\n\s*/g, ' '))
  return parts.join(' | ')
}

// GitHub workflow command 이스케이프(값: % \r \n, 속성: 추가로 : ,)
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

export function errorAnnotation(r: CheckResult): string {
  const body = [r.title, r.expected !== undefined ? `expected ${r.expected}` : '', r.actual !== undefined ? `actual ${r.actual}` : '', r.note ?? '']
    .filter(Boolean).join(' | ')
  return `::error title=${escapeProperty(`발행물 검사 ${r.id} (${r.kind})`)}::${escapeData(body)}`
}

export function formatStepSummary(results: CheckResult[], ctx: { date: string; base: string }): string {
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
  const fails = results.filter((r) => r.status === 'FAIL').length
  const lines = [
    `### ${fails ? '⚠️' : '✅'} 발행물 정확성 검사 ${ctx.date} — FAIL ${fails} · PASS ${results.filter((r) => r.status === 'PASS').length} · SKIP ${results.filter((r) => r.status === 'SKIP').length}`,
    '',
    `대상: ${ctx.base}`,
    '',
    '| 상태 | 검사 | 종류 | 항목 | 기대 | 실제 | 비고 |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.status} | ${r.id} | ${r.kind} | ${cell(r.title)} | ${cell(r.expected)} | ${cell(r.actual)} | ${cell(r.note)} |`),
    '',
  ]
  return lines.join('\n')
}
