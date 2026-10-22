// scripts/check-published.ts
// 발행물 정확성 검사(2026-10-23) — 공개된 리포트 페이지를 원천 시세와 대조한다(판정은 lib/published-check.ts).
//
//   npx tsx scripts/check-published.ts [--date YYYY-MM-DD] [--base URL] [--kind market|etf|all]
//   기본: 오늘(KST) · https://dailyreport-eta.vercel.app · all
//
// 검사마다 한 줄(PASS/FAIL/SKIP, 기대·실제)을 찍고, FAIL마다 ::error:: 주석을 남기고, GITHUB_STEP_SUMMARY가 있으면
// 표를 붙인다. FAIL이 하나라도 있으면 exit 1 → .github/workflows/delivery-monitor.yml 실패 → GitHub 실패 메일.
// 읽기 전용 — 공개 페이지 GET과 Yahoo 시세 조회만 한다(비밀 불필요). 카드 한 줄은 저장소의 data/reports-index.json에서 읽는다.
import * as fs from 'node:fs'
import * as path from 'node:path'
import YahooFinance from 'yahoo-finance2'
import {
  errorAnnotation, formatLine, formatStepSummary, kstToday, parseCliArgs, runPublishedChecks,
  type PageResponse, type QuoteSnapshot,
} from '../lib/published-check'

const PAGE_TIMEOUT_MS = 20_000
const QUOTE_CHUNK = 40

async function fetchPage(url: string, opts?: { binary?: boolean }): Promise<PageResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'cache-control': 'no-cache', 'user-agent': 'dailyreport-published-check/1.0' },
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (opts?.binary) {
      await res.arrayBuffer() // 끝까지 받아 응답이 온전한지 확인(본문은 쓰지 않음)
      return { status: res.status, contentType, body: '' }
    }
    return { status: res.status, contentType, body: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 야후 배치 시세(40개씩). 없는 종목은 조용히 빠진다 — 판정 쪽이 "시세 없음" FAIL로 처리. */
async function fetchQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
  const out: QuoteSnapshot[] = []
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const chunk = symbols.slice(i, i + QUOTE_CHUNK)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await yahooFinance.quote(chunk, {}, { validateResult: false })) as any
    const list: unknown[] = Array.isArray(res) ? res : res && typeof res === 'object' ? Object.values(res) : []
    for (const raw of list) {
      const q = raw as Record<string, unknown>
      if (typeof q?.symbol !== 'string') continue
      out.push({
        symbol: q.symbol,
        price: num(q.regularMarketPrice),
        changePercent: num(q.regularMarketChangePercent),
        marketTime: toDate(q.regularMarketTime),
        previousClose: num(q.regularMarketPreviousClose),
      })
    }
  }
  return out
}

/** Market 카드 한 줄 — HTML에는 없다. 같은 커밋의 data/reports-index.json 항목(카드 PNG를 그린 값). */
function readMarketCardLine(date: string): string | null {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'reports-index.json'), 'utf8')) as { reports?: Array<{ date?: string; cardLine?: string }> }
    const line = index.reports?.find((r) => r.date === date)?.cardLine
    return typeof line === 'string' && line.trim() ? line : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const today = kstToday()
  const { date, base, kinds } = parseCliArgs(process.argv.slice(2), today)
  console.log(`check-published: date=${date} base=${base} kind=${kinds.join(',')} (오늘 KST ${today})`)

  const results = await runPublishedChecks({
    date, base, kinds, today, fetchPage, fetchQuotes,
    marketCardLine: kinds.includes('market') ? readMarketCardLine(date) : null,
  })

  for (const r of results) {
    console.log(formatLine(r))
    if (r.status === 'FAIL') console.log(errorAnnotation(r))
  }
  const count = (s: string) => results.filter((r) => r.status === s).length
  console.log(`check-published: FAIL ${count('FAIL')} · PASS ${count('PASS')} · SKIP ${count('SKIP')}`)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatStepSummary(results, { date, base }))
  if (count('FAIL') > 0) process.exitCode = 1
}

if (require.main === module) {
  main().catch((e) => {
    // 검사 자체가 죽어도 조용히 통과하지 않는다 — exit 1(실패 메일).
    console.log(`::error title=발행물 검사 실행 실패::${String((e as Error)?.message ?? e).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`)
    console.error(`[check-published] ${(e as Error)?.stack ?? e}`)
    process.exit(1)
  })
}
