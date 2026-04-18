// lib/market-context.ts
import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
import type { MacroContext } from './types'
import { fetchJson } from './fetcher'

const MACRO_TICKERS: Record<keyof Omit<MacroContext, 'fearGreed' | 'moveIndex'>, string> = {
  usdKrw: 'KRW=X',
  dxy: 'DX-Y.NYB',
  vix: '^VIX',
  us10y: '^TNX',
  wti: 'CL=F',
  gold: 'GC=F',
}

export async function collectMacroContext(): Promise<MacroContext> {
  const tickerEntries = Object.entries(MACRO_TICKERS) as [keyof Omit<MacroContext, 'fearGreed' | 'moveIndex'>, string][]
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

  // GC=F (Gold Futures) is quoted in USD/troy oz — no unit conversion needed
  // GC=F continuous contract may show spot price; verify against GLD NAV if discrepancy persists
  const gold = getValue(5)

  return {
    usdKrw: getValue(0),
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
