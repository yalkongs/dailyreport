// lib/etf-data.ts
import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
import type { EtfQuote, EtfFlow, InvestorFlow } from './types'
import { ALL_ETF_UNIVERSE, US_ETF_UNIVERSE } from './universe'
import { fetchJson } from './fetcher'

interface KrxEtfDailyTradeRow {
  BAS_DD: string
  ISU_CD: string
  ISU_NM: string
  TDD_CLSPRC: string
  CMPPREVDD_PRC: string
  FLUC_RT: string
  NAV: string
  ACC_TRDVOL: string
  ACC_TRDVAL: string
  MKTCAP: string
  INVSTASST_NETASST_TOTAMT: string
  IDX_IND_NM: string
  OBJ_STKPRC_IDX: string
  FLUC_RT_IDX: string
}

interface KrxEtfDailyTrade {
  date: string
  ticker: string
  name: string
  close: number | null
  change: number | null
  changePercent: number | null
  nav: number | null
  volume: number | null
  tradingValue: number | null
  marketCap: number | null
  netAssetTotal: number | null
  underlyingIndexName: string | null
  underlyingIndexClose: number | null
  underlyingIndexChangePercent: number | null
  premiumDiscount: number | null
  dailyIndexGap: number | null
}

function parseKrxNumber(value: string | undefined): number | null {
  if (!value || value === '-') return null
  const n = Number(value.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function formatKrxDate(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
}

function recentKrxDates(days = 8): string[] {
  const out: string[] = []
  const base = new Date()
  for (let i = 0; i < days; i += 1) {
    const d = new Date(base)
    d.setDate(base.getDate() - i)
    out.push(formatKrxDate(d))
  }
  return out
}

function mapKrxEtfDailyTrade(row: KrxEtfDailyTradeRow): KrxEtfDailyTrade {
  const close = parseKrxNumber(row.TDD_CLSPRC)
  const nav = parseKrxNumber(row.NAV)
  const changePercent = parseKrxNumber(row.FLUC_RT)
  const underlyingIndexChangePercent = parseKrxNumber(row.FLUC_RT_IDX)
  return {
    date: row.BAS_DD,
    ticker: `${row.ISU_CD}.KS`,
    name: row.ISU_NM,
    close,
    change: parseKrxNumber(row.CMPPREVDD_PRC),
    changePercent,
    nav,
    volume: parseKrxNumber(row.ACC_TRDVOL),
    tradingValue: parseKrxNumber(row.ACC_TRDVAL),
    marketCap: parseKrxNumber(row.MKTCAP),
    netAssetTotal: parseKrxNumber(row.INVSTASST_NETASST_TOTAMT),
    underlyingIndexName: row.IDX_IND_NM || null,
    underlyingIndexClose: parseKrxNumber(row.OBJ_STKPRC_IDX),
    underlyingIndexChangePercent,
    premiumDiscount: close !== null && nav !== null && nav !== 0 ? ((close - nav) / nav) * 100 : null,
    dailyIndexGap: changePercent !== null && underlyingIndexChangePercent !== null
      ? changePercent - underlyingIndexChangePercent
      : null,
  }
}

export async function collectKrxOpenApiEtfDailyTrades(): Promise<Map<string, KrxEtfDailyTrade>> {
  const authKey = process.env.KRX_AUTH_KEY
  const result = new Map<string, KrxEtfDailyTrade>()
  if (!authKey) {
    console.warn('[etf-data] KRX_AUTH_KEY 미설정 — KRX OpenAPI ETF 일별매매정보 건너뜀')
    return result
  }

  const url = 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd'
  for (const basDd of recentKrxDates()) {
    try {
      const data = await fetchJson<{ OutBlock_1?: KrxEtfDailyTradeRow[] }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: authKey,
        },
        body: JSON.stringify({ basDd }),
      })

      const rows = data?.OutBlock_1 ?? []
      if (rows.length === 0) continue
      for (const row of rows) {
        const mapped = mapKrxEtfDailyTrade(row)
        result.set(mapped.ticker, mapped)
      }
      console.log(`[etf-data] KRX OpenAPI ETF 일별매매정보: ${basDd}, ${rows.length}건`)
      break
    } catch (e) {
      console.error(`[etf-data] KRX OpenAPI ETF 일별매매정보 실패: ${basDd}`, e)
    }
  }

  return result
}

// Yahoo Finance로 ETF 시세 수집 (10개씩 배치)
export async function collectYahooQuotes(): Promise<EtfQuote[]> {
  const universeMap = new Map(ALL_ETF_UNIVERSE.map(e => [e.ticker, e]))
  const tickers = ALL_ETF_UNIVERSE.map(e => e.ticker)
  const results: EtfQuote[] = []
  const BATCH_SIZE = 10

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async ticker => {
        const etfDef = universeMap.get(ticker)
        if (!etfDef) return null
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const quote = await yahooFinance.quote(ticker, {}, { validateResult: false }) as any
          if (!quote) return null
          return {
            ticker,
            name: etfDef.name,
            market: etfDef.market,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
            volume: quote.regularMarketVolume ?? null,
            aum: quote.totalAssets ?? null,
            nav: null,
            premiumDiscount: null,
            trackingError: null,
            prev20AvgVolume: quote.averageVolume ?? null,
          } satisfies EtfQuote
        } catch (e) {
          console.error(`[etf-data] Yahoo 수집 실패: ${ticker}`, e)
          return null
        }
      })
    )
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      }
    }
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }
  return results
}

// KRX — NAV, 괴리율, 추적오차
export async function collectKrxNavData(): Promise<
  Map<string, { nav: number; premiumDiscount: number; trackingError: number }>
> {
  const openApiMap = await collectKrxOpenApiEtfDailyTrades()
  if (openApiMap.size > 0) {
    return new Map([...openApiMap].map(([ticker, row]) => [ticker, {
      nav: row.nav ?? 0,
      premiumDiscount: row.premiumDiscount ?? 0,
      trackingError: 0,
    }]))
  }

  return collectLegacyKrxNavData()
}

async function collectLegacyKrxNavData(): Promise<
  Map<string, { nav: number; premiumDiscount: number; trackingError: number }>
> {
  const result = new Map<string, { nav: number; premiumDiscount: number; trackingError: number }>()
  const url = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'

  for (const trdDd of recentKrxDates()) {
    const body = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT04301',
      locale: 'ko_KR',
      trdDd,
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
    })

    try {
      const data = await fetchJson<{
        output: Array<{ ISU_CD: string; NAV: string; DIVRG_RT: string; TRK_ERR: string }>
      }>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (!data?.output || data.output.length === 0) continue

      for (const row of data.output) {
        const ticker = `${row.ISU_CD}.KS`
        result.set(ticker, {
          nav: parseKrxNumber(row.NAV) ?? 0,
          premiumDiscount: parseKrxNumber(row.DIVRG_RT) ?? 0,
          trackingError: parseKrxNumber(row.TRK_ERR) ?? 0,
        })
      }
      console.log(`[etf-data] KRX legacy NAV: ${trdDd}, ${data.output.length}건`)
      break
    } catch (e) {
      console.error(`[etf-data] KRX NAV 수집 실패: ${trdDd}`, e)
    }
  }

  return result
}

// KRX — 투자자별 매매동향
export async function collectKrxInvestorFlows(): Promise<InvestorFlow[]> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const results: InvestorFlow[] = []

  try {
    const url = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
    const body = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT04601',
      locale: 'ko_KR',
      trdDd: today,
      share: '1',
      money: '1',
    })

    const data = await fetchJson<{
      output: Array<{
        ISU_CD: string
        FRGN_NET_BUY: string
        ORG_NET_BUY: string
        INDV_NET_BUY: string
      }>
    }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!data?.output) return results

    for (const row of data.output) {
      const ticker = `${row.ISU_CD}.KS`
      results.push({
        ticker,
        foreign: parseFloat(row.FRGN_NET_BUY?.replace(/,/g, '') || '0'),
        institution: parseFloat(row.ORG_NET_BUY?.replace(/,/g, '') || '0'),
        retail: parseFloat(row.INDV_NET_BUY?.replace(/,/g, '') || '0'),
        consecutiveForeignSell: 0, // KRX API 미제공 — analyzer.ts에서 alert-log 기반으로 계산
      })
    }
  } catch (e) {
    console.error('[etf-data] KRX 투자자 수집 실패', e)
  }

  return results
}

// Yahoo Finance — 미국 ETF AUM 수집 (StockAnalysis API 폐쇄 대안)
// flowDaily/flowWeekly = null, flowMonthly = totalAssets(AUM, USD)로 활용
export async function collectUsEtfFlows(): Promise<EtfFlow[]> {
  const BATCH_SIZE = 10
  const results: EtfFlow[] = []

  for (let i = 0; i < US_ETF_UNIVERSE.length; i += BATCH_SIZE) {
    const batch = US_ETF_UNIVERSE.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async etf => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summary = await (yahooFinance as any).quoteSummary(etf.ticker, {
            modules: ['defaultKeyStatistics'],
          }) as { defaultKeyStatistics?: { totalAssets?: number } }
          const aum = summary?.defaultKeyStatistics?.totalAssets ?? null
          return { ticker: etf.ticker, flowDaily: null, flowWeekly: null, flowMonthly: aum }
        } catch {
          return { ticker: etf.ticker, flowDaily: null, flowWeekly: null, flowMonthly: null }
        }
      })
    )
    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { ticker: '', flowDaily: null, flowWeekly: null, flowMonthly: null })
    }
    if (i + BATCH_SIZE < US_ETF_UNIVERSE.length) {
      await new Promise(res => setTimeout(res, 200))
    }
  }

  return results.filter(r => r.ticker !== '')
}

// 메인 수집 함수 — Yahoo + KRX 병합
export async function collectAllEtfData(): Promise<{
  quotes: EtfQuote[]
  flows: EtfFlow[]
  investorFlows: InvestorFlow[]
}> {
  const [quotesResult, krxOpenApiResult, investorFlowsResult, flowsResult] = await Promise.allSettled([
    collectYahooQuotes(),
    collectKrxOpenApiEtfDailyTrades(),
    collectKrxInvestorFlows(),
    collectUsEtfFlows(),
  ])

  const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value : []
  const krxMap = krxOpenApiResult.status === 'fulfilled' ? krxOpenApiResult.value : new Map<string, KrxEtfDailyTrade>()
  const krxNavFallbackMap = krxMap.size === 0
    ? await collectLegacyKrxNavData()
    : new Map<string, { nav: number; premiumDiscount: number; trackingError: number }>()

  // KRX OpenAPI 데이터를 국내 ETF quotes에 병합하고, OpenAPI가 비면 legacy NAV로 보강한다.
  const mergedQuotes = quotes.map(q => {
    const krx = krxMap.get(q.ticker)
    if (krx) {
      return {
        ...q,
        name: krx.name || q.name,
        price: krx.close ?? q.price,
        change: krx.change ?? q.change,
        changePercent: krx.changePercent ?? q.changePercent,
        volume: krx.volume ?? q.volume,
        aum: krx.netAssetTotal ?? q.aum,
        nav: krx.nav,
        premiumDiscount: krx.premiumDiscount,
        trackingError: q.trackingError,
        tradingValue: krx.tradingValue,
        marketCap: krx.marketCap,
        underlyingIndexName: krx.underlyingIndexName,
        underlyingIndexClose: krx.underlyingIndexClose,
        underlyingIndexChangePercent: krx.underlyingIndexChangePercent,
        dailyIndexGap: krx.dailyIndexGap,
      }
    }
    const nav = krxNavFallbackMap.get(q.ticker)
    if (nav) {
      return {
        ...q,
        nav: nav.nav,
        premiumDiscount: nav.premiumDiscount,
        trackingError: nav.trackingError,
      }
    }
    return q
  })

  return {
    quotes: mergedQuotes,
    flows: flowsResult.status === 'fulfilled' ? flowsResult.value : [],
    investorFlows: investorFlowsResult.status === 'fulfilled' ? investorFlowsResult.value : [],
  }
}
