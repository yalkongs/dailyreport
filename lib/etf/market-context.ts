// lib/market-context.ts
import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
import type { IndexQuote, MacroContext } from './types'
import { fetchJson } from './fetcher'

const MACRO_TICKERS: Record<keyof Omit<MacroContext, 'fearGreed' | 'moveIndex' | 'usdKrwChangePercent'>, string> = {
  usdKrw: 'KRW=X',
  dxy: 'DX-Y.NYB',
  vix: '^VIX',
  us10y: '^TNX',
  wti: 'CL=F',
  gold: 'GC=F',
}

export async function collectMacroContext(): Promise<MacroContext> {
  const tickerEntries = Object.entries(MACRO_TICKERS) as [keyof Omit<MacroContext, 'fearGreed' | 'moveIndex' | 'usdKrwChangePercent'>, string][]
  const tickers = tickerEntries.map(([, t]) => t)

  const [quoteResults, fearGreedResult, moveResult] = await Promise.allSettled([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Promise.allSettled(tickers.map(t => yahooFinance.quote(t, {}, { validateResult: false }) as Promise<any>)),
    collectFearGreed(),
    collectMoveIndex(),
  ])

  const quoteValues = quoteResults.status === 'fulfilled' ? quoteResults.value : []

  const getValue = (index: number): number | null => {
    const r = quoteValues[index]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r?.status === 'fulfilled' ? ((r.value as any)?.regularMarketPrice ?? null) : null
  }

  const getChangePercent = (index: number): number | null => {
    const r = quoteValues[index]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = r?.status === 'fulfilled' ? (r.value as any)?.regularMarketChangePercent : null
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  // GC=F (Gold Futures) is quoted in USD/troy oz — no unit conversion needed
  // GC=F continuous contract may show spot price; verify against GLD NAV if discrepancy persists
  const gold = getValue(5)

  return {
    usdKrw: getValue(0),
    usdKrwChangePercent: getChangePercent(0),
    dxy: getValue(1),
    vix: getValue(2),
    us10y: getValue(3),
    wti: getValue(4),
    gold,
    moveIndex: moveResult.status === 'fulfilled' ? moveResult.value : null,
    fearGreed: fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null,
  }
}

// Fear & Greed: alternative.me (free, no auth required)
// Note: this is based on crypto market sentiment, used as a proxy
async function collectFearGreed(): Promise<number | null> {
  try {
    const data = await fetchJson<{ data: Array<{ value: string }> }>(
      'https://api.alternative.me/fng/?limit=1',
      {},
      8000
    )
    const score = data?.data?.[0]?.value
    return score ? parseFloat(score) : null
  } catch {
    return null
  }
}

async function collectMoveIndex(): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote('^MOVE', {}, { validateResult: false })
    return (quote?.regularMarketPrice as number | undefined) ?? null
  } catch {
    return null
  }
}

// C01 (2026-10-16): 실제 지수 시세 — ETF 등락을 지수 등락으로 부르던 오서술 방지용.
// 코스피·코스닥은 직전 한국 장, 미국 지수는 간밤 미국 장 기준이다(아침 발행 시점).
export const INDEX_SYMBOLS: ReadonlyArray<{ symbol: string; nameKo: string }> = [
  { symbol: '^KS11', nameKo: '코스피' },
  { symbol: '^KQ11', nameKo: '코스닥' },
  { symbol: '^GSPC', nameKo: 'S&P500' },
  { symbol: '^IXIC', nameKo: '나스닥' },
  { symbol: '^DJI', nameKo: '다우' },
  { symbol: '^SOX', nameKo: '필라델피아 반도체지수' },
]

// 시세의 거래일 — 해당 시장 현지 날짜(미국 지수 마감은 한국시간으로 다음 날 새벽이라 KST로 찍으면 하루 밀린다).
export function sessionDate(epochLike: unknown, timeZone: string): string | null {
  const d = epochLike instanceof Date ? epochLike
    : typeof epochLike === 'number' ? new Date(epochLike < 1e12 ? epochLike * 1000 : epochLike)
    : null
  if (!d || Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function collectIndexQuotes(): Promise<IndexQuote[]> {
  const results = await Promise.allSettled(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    INDEX_SYMBOLS.map(i => yahooFinance.quote(i.symbol, {}, { validateResult: false }) as Promise<any>),
  )
  return INDEX_SYMBOLS.map((i, idx) => {
    const r = results[idx]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = r.status === 'fulfilled' ? r.value : null
    const price = typeof q?.regularMarketPrice === 'number' ? q.regularMarketPrice : null
    const changePercent = typeof q?.regularMarketChangePercent === 'number' && Number.isFinite(q.regularMarketChangePercent)
      ? q.regularMarketChangePercent : null
    return { symbol: i.symbol, nameKo: i.nameKo, price, changePercent, asOf: sessionDate(q?.regularMarketTime, /^\^K[SQ]/.test(i.symbol) ? 'Asia/Seoul' : 'America/New_York') }
  }).filter(q => q.price !== null && q.changePercent !== null)
}
