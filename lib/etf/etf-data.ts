// lib/etf-data.ts
import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
import type { EtfQuote, EtfFlow, InvestorFlow } from './types'
import { ALL_ETF_UNIVERSE, US_ETF_UNIVERSE, getEtfByTicker } from './universe'
import { isTacticalEtf } from './story-characters'
import { fetchJson } from './fetcher'
import { resolveKrxSession, expectedKrxBasDd, krxRequestOrder, type KrxSession } from './krx-session'
import { getPrevTradingDay } from '../market-calendar'
import { sessionDate } from './market-context'

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

export interface KrxEtfDailyTrade {
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

export async function collectKrxOpenApiEtfDailyTrades(
  reportDate: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
): Promise<{
  map: Map<string, KrxEtfDailyTrade>
  basDd: string | null
}> {
  const authKey = process.env.KRX_AUTH_KEY
  const map = new Map<string, KrxEtfDailyTrade>()
  if (!authKey) {
    console.warn('[etf-data] KRX_AUTH_KEY 미설정 — KRX OpenAPI ETF 일별매매정보 건너뜀')
    return { map, basDd: null }
  }

  const url = 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd'
  // 직전 거래일을 먼저 요청한다 — 오늘부터 역행하면 월요일에 KRX가 돌려주는 일요일 날짜의
  // 빈 행을 먼저 채택해 stale이 된다(krxRequestOrder 주석 참조).
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  for (const requested of krxRequestOrder(reportDate, today)) {
    try {
      const data = await fetchJson<{ OutBlock_1?: KrxEtfDailyTradeRow[] }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: authKey,
        },
        body: JSON.stringify({ basDd: requested }),
      })

      const rows = data?.OutBlock_1 ?? []
      if (rows.length === 0) continue
      for (const row of rows) {
        const mapped = mapKrxEtfDailyTrade(row)
        map.set(mapped.ticker, mapped)
      }
      // 판정은 요청 날짜가 아니라 응답 행의 기준일로 한다.
      const basDd = rows[0].BAS_DD || null
      console.log(`[etf-data] KRX OpenAPI ETF 일별매매정보: 요청=${requested} 응답 BAS_DD=${basDd}, ${rows.length}건`)
      return { map, basDd }
    } catch (e) {
      console.error(`[etf-data] KRX OpenAPI ETF 일별매매정보 실패: ${requested}`, e)
    }
  }

  return { map, basDd: null }
}

// 06:40 실행(장 시작 전)에는 Yahoo quote의 국내 ETF 거래량이 새 세션 기준 0으로 온다(2026-10-19~ 매일 확인).
// 가격은 직전 거래일 종가이므로, 거래량도 같은 날 일봉에서 채워 추정 거래대금(종가×거래량)이 0원이 되지 않게 한다.
export function needsSessionVolume(market: EtfQuote['market'], volume: number | null): boolean {
  return market === 'KR' && !(typeof volume === 'number' && Number.isFinite(volume) && volume > 0)
}

// 일봉 중 KST 날짜가 sessionKst인 봉의 거래량. 없거나 0·null이면 null — 다른 날 값으로 대신하지 않는다.
// 그 봉의 종가가 quote 가격과 어긋나면(가격이 다른 세션 값) 날짜가 섞이므로 역시 null.
const SESSION_CLOSE_TOLERANCE = 0.005
export function sessionVolumeFromBars(
  bars: ReadonlyArray<{ date: Date; close?: number | null; volume: number | null | undefined }>,
  sessionKst: string,
  price: number | null,
): number | null {
  const hit = bars.find(b => sessionDate(b.date, 'Asia/Seoul') === sessionKst)
  const v = hit?.volume
  if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
  const close = hit?.close
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  if (typeof close !== 'number' || !Number.isFinite(close) || Math.abs(close - price) / price > SESSION_CLOSE_TOLERANCE) return null
  return v
}

async function fetchSessionVolume(ticker: string, sessionKst: string, price: number | null): Promise<number | null> {
  try {
    const at = new Date(`${sessionKst}T00:00:00+09:00`).getTime()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: any = await yahooFinance.chart(ticker, { period1: new Date(at - 7 * 86400000), period2: new Date(at + 2 * 86400000), interval: '1d' })
    return sessionVolumeFromBars(history?.quotes ?? [], sessionKst, price)
  } catch (e) {
    console.error(`[etf-data] Yahoo 일봉 거래량 수집 실패: ${ticker}`, e)
    return null
  }
}

// Yahoo Finance로 ETF 시세 수집 (10개씩 배치)
export async function collectYahooQuotes(
  reportDate: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
): Promise<EtfQuote[]> {
  const krSession = getPrevTradingDay(reportDate, 'kr')
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
          let volume: number | null = quote.regularMarketVolume ?? null
          if (needsSessionVolume(etfDef.market, volume)) volume = await fetchSessionVolume(ticker, krSession, quote.regularMarketPrice ?? null)
          return {
            ticker,
            name: etfDef.name,
            market: etfDef.market,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
            volume,
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

/**
 * KRX 값을 국내 quote에 병합한다. session 이 'prev-session' 일 때만.
 * stale·none 에서는 KRX 값을 하나도 섞지 않는다 — D-1 가격과 D-2 NAV를 섞으면
 * validateData 의 가격/NAV 10% 검증이 리포트를 통째로 중단시키고, 오래된 괴리율이
 * 이상 탐지·"오늘 N개 관측" 문구로 '오늘'의 사실이 된다.
 * prev-session 인데도 국내 NAV가 전부 null일 때만 run-etf 가 'krx-nav' 실패로 기록한다(krxNavFailed, Ruling 22) —
 * 06:40 실행의 stale·none 은 KRX 08:00 게시 전이라 정상이며 실패가 아니다.
 */
export function mergeKrxIntoQuotes(
  quotes: EtfQuote[],
  krxMap: Map<string, KrxEtfDailyTrade>,
  session: KrxSession,
): EtfQuote[] {
  if (session !== 'prev-session') return quotes
  // F09 (2026-10-16 감사): Yahoo에서 빠진 국내 유니버스 종목을 정상 KRX 전일 행으로 복구한다
  // (이전엔 Yahoo에 있는 종목만 순회해 Yahoo 장애 시 KRX가 살아 있어도 국내 시세가 0개였다).
  const present = new Set(quotes.map(q => q.ticker))
  const recovered: EtfQuote[] = []
  for (const [ticker, krx] of krxMap) {
    const def = getEtfByTicker(ticker)
    if (present.has(ticker) || !def || def.market !== 'KR' || krx.close === null || krx.close === undefined) continue
    recovered.push({
      ticker, name: krx.name || def.name, market: 'KR',
      price: null, change: null, changePercent: null, volume: null, aum: null,
      nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
    })
  }
  return [...quotes, ...recovered].map(q => {
    const krx = krxMap.get(q.ticker)
    if (!krx) return q
    const name = krx.name || q.name
    // 지수대비가 의미 없는 경우 비운다(렌더러는 null을 생략):
    // 해외 기초지수는 한국 장과 지수 날짜가 어긋나고, 레버리지·인버스는 배수를 무시한 1배 차이라서.
    const gapMeaningless = getEtfByTicker(q.ticker)?.foreignUnderlying === true || isTacticalEtf({ ...q, name })
    return {
      ...q,
      name,
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
      dailyIndexGap: gapMeaningless ? null : krx.dailyIndexGap,
    }
  })
}

// 메인 수집 함수 — Yahoo + KRX 병합. KRX는 응답 기준일이 직전 한국 거래일일 때만 병합한다.
// (날짜를 알 수 없는 legacy NAV 경로는 2026-09 기준일 가드와 함께 제거 — 날짜 혼합 금지.)
export async function collectAllEtfData(
  reportDate: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
): Promise<{
  quotes: EtfQuote[]
  flows: EtfFlow[]
  investorFlows: InvestorFlow[]
  krx: { basDd: string | null; session: KrxSession }
}> {
  const [quotesResult, krxOpenApiResult, investorFlowsResult, flowsResult] = await Promise.allSettled([
    collectYahooQuotes(reportDate),
    collectKrxOpenApiEtfDailyTrades(reportDate),
    collectKrxInvestorFlows(),
    collectUsEtfFlows(),
  ])

  const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value : []
  const krxResult = krxOpenApiResult.status === 'fulfilled'
    ? krxOpenApiResult.value
    : { map: new Map<string, KrxEtfDailyTrade>(), basDd: null }
  const session = resolveKrxSession(krxResult.basDd, reportDate)
  console.log(
    `[etf-data] KRX BAS_DD=${krxResult.basDd ?? '없음'} 기대=${expectedKrxBasDd(reportDate)} → ${session}` +
    (session === 'prev-session' ? '' : ' — KRX 값을 병합하지 않습니다(국내 NAV·괴리율 없음)'),
  )

  return {
    quotes: mergeKrxIntoQuotes(quotes, krxResult.map, session),
    flows: flowsResult.status === 'fulfilled' ? flowsResult.value : [],
    investorFlows: investorFlowsResult.status === 'fulfilled' ? investorFlowsResult.value : [],
    krx: { basDd: krxResult.basDd, session },
  }
}
