import YahooFinance from "yahoo-finance2";
import type {
  MarketIndex,
  ForexData,
  CommodityData,
  BondData,
  CryptoData,
  MarketDataCollection,
  HistoricalComparison,
} from "./types";

// --- KST 시간 유틸리티 ---
const KST_OFFSET = 9 * 60 * 60 * 1000;

/** UTC Date를 KST 날짜 문자열(YYYY-MM-DD)로 변환 */
function toKSTDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET);
  return kst.toISOString().split("T")[0];
}

/** UTC Date를 KST ISO 문자열로 변환 (예: 2026-04-13T07:00:00+09:00) */
export function toKSTString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET);
  const iso = kst.toISOString().replace("Z", "");
  return iso.slice(0, 19) + "+09:00";
}

const KOREA_INDICES = [
  { symbol: "^KS11", name: "KOSPI", nameKo: "코스피" },
  { symbol: "^KQ11", name: "KOSDAQ", nameKo: "코스닥" },
];

const US_INDICES = [
  { symbol: "^GSPC", name: "S&P 500", nameKo: "S&P 500" },
  { symbol: "^IXIC", name: "NASDAQ", nameKo: "나스닥" },
  { symbol: "^DJI", name: "Dow Jones", nameKo: "다우존스" },
];

const EUROPE_INDICES = [
  { symbol: "^GDAXI", name: "DAX", nameKo: "DAX (독일)" },
  { symbol: "^FTSE", name: "FTSE 100", nameKo: "FTSE 100 (영국)" },
  { symbol: "^STOXX", name: "STOXX 600", nameKo: "STOXX 600 (유럽)" },
];

const JAPAN_INDICES = [
  { symbol: "^N225", name: "Nikkei 225", nameKo: "닛케이 225" },
];

const CHINA_INDICES = [
  { symbol: "000001.SS", name: "Shanghai Composite", nameKo: "상해종합" },
  { symbol: "^HSI", name: "Hang Seng", nameKo: "항셍" },
];

const FOREX_PAIRS = [
  { symbol: "KRW=X", name: "USD/KRW", nameKo: "원/달러" },
  { symbol: "JPY=X", name: "USD/JPY", nameKo: "엔/달러" },
  { symbol: "CNY=X", name: "USD/CNY", nameKo: "위안/달러" },
  { symbol: "EURUSD=X", name: "EUR/USD", nameKo: "유로/달러" },
  { symbol: "DX-Y.NYB", name: "DXY", nameKo: "달러인덱스" },
];

const COMMODITIES = [
  { symbol: "CL=F", name: "WTI Crude Oil", nameKo: "WTI 원유" },
  { symbol: "BZ=F", name: "Brent Crude Oil", nameKo: "브렌트유" },
  { symbol: "GC=F", name: "Gold", nameKo: "금" },
  { symbol: "SI=F", name: "Silver", nameKo: "은" },
];

const BONDS = [
  { symbol: "^TNX", name: "US 10Y Treasury", nameKo: "미국 10년물" },
  { symbol: "^FVX", name: "US 5Y Treasury", nameKo: "미국 5년물" },
  { symbol: "^IRX", name: "US 13W Treasury", nameKo: "미국 13주물" },
  { symbol: "^TYX", name: "US 30Y Treasury", nameKo: "미국 30년물" },
];

const CRYPTO = [
  { symbol: "BTC-USD", name: "Bitcoin", nameKo: "비트코인" },
  { symbol: "ETH-USD", name: "Ethereum", nameKo: "이더리움" },
];

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function fetchQuote(
  symbol: string
): Promise<{
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
}> {
  try {
    const quote = await yahooFinance.quote(symbol);
    return {
      price: quote.regularMarketPrice ?? null,
      change: quote.regularMarketChange ?? null,
      changePercent: quote.regularMarketChangePercent ?? null,
      previousClose: quote.regularMarketPreviousClose ?? null,
    };
  } catch {
    return { price: null, change: null, changePercent: null, previousClose: null };
  }
}

async function fetchIndices(
  configs: { symbol: string; name: string; nameKo: string }[]
): Promise<{ data: MarketIndex[]; errors: string[] }> {
  const errors: string[] = [];
  const data: MarketIndex[] = [];

  for (const config of configs) {
    const quote = await fetchQuote(config.symbol);
    if (quote.price === null) {
      errors.push(`${config.nameKo}(${config.symbol}) 데이터 수집 실패`);
    }
    data.push({ ...config, ...quote });
  }
  return { data, errors };
}

async function fetchForex(
  configs: { symbol: string; name: string; nameKo: string }[]
): Promise<{ data: ForexData[]; errors: string[] }> {
  const errors: string[] = [];
  const data: ForexData[] = [];

  for (const config of configs) {
    const quote = await fetchQuote(config.symbol);
    if (quote.price === null) {
      errors.push(`${config.nameKo}(${config.symbol}) 데이터 수집 실패`);
    }
    data.push({
      ...config,
      rate: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
    });
  }
  return { data, errors };
}

async function fetchCommodities(
  configs: { symbol: string; name: string; nameKo: string }[]
): Promise<{ data: CommodityData[]; errors: string[] }> {
  const errors: string[] = [];
  const data: CommodityData[] = [];

  for (const config of configs) {
    const quote = await fetchQuote(config.symbol);
    if (quote.price === null) {
      errors.push(`${config.nameKo}(${config.symbol}) 데이터 수집 실패`);
    }
    data.push({ ...config, ...quote });
  }
  return { data, errors };
}

async function fetchBonds(
  configs: { symbol: string; name: string; nameKo: string }[]
): Promise<{ data: BondData[]; errors: string[] }> {
  const errors: string[] = [];
  const data: BondData[] = [];

  for (const config of configs) {
    const quote = await fetchQuote(config.symbol);
    if (quote.price === null) {
      errors.push(`${config.nameKo}(${config.symbol}) 데이터 수집 실패`);
    }
    data.push({
      ...config,
      yield: quote.price,
      change: quote.change,
    });
  }
  return { data, errors };
}

async function fetchCrypto(
  configs: { symbol: string; name: string; nameKo: string }[]
): Promise<{ data: CryptoData[]; errors: string[] }> {
  const errors: string[] = [];
  const data: CryptoData[] = [];

  for (const config of configs) {
    const quote = await fetchQuote(config.symbol);
    if (quote.price === null) {
      errors.push(`${config.nameKo}(${config.symbol}) 데이터 수집 실패`);
    }
    data.push({ ...config, ...quote });
  }
  return { data, errors };
}

function getKoreanDayOfWeek(date: Date): string {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[date.getDay()];
}

function getEffectiveDate(): { now: Date; dateStr: string } {
  const testDate = process.env.TEST_DATE; // YYYY-MM-DD
  if (testDate) {
    const [y, m, d] = testDate.split("-").map(Number);
    const now = new Date(y, m - 1, d, 6, 0, 0); // 06:00 KST
    return { now, dateStr: testDate };
  }
  const now = new Date();
  return { now, dateStr: toKSTDateString(now) };
}

/** VIX 수집 — context-data.ts에서 호출 */
export async function collectVix(): Promise<{ value: number; change: number; changePercent: number } | undefined> {
  try {
    const quote = await fetchQuote("^VIX");
    if (quote.price != null) {
      return {
        value: quote.price,
        change: quote.change ?? 0,
        changePercent: quote.changePercent ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** 과거 시계열 비교 데이터 수집 — 핵심 지표 6개 */
const HISTORICAL_SYMBOLS = [
  { symbol: "^KS11", nameKo: "코스피" },
  { symbol: "^GSPC", nameKo: "S&P 500" },
  { symbol: "^IXIC", nameKo: "나스닥" },
  { symbol: "KRW=X", nameKo: "원/달러" },
  { symbol: "CL=F", nameKo: "WTI 원유" },
  { symbol: "GC=F", nameKo: "금" },
];

export async function collectHistoricalData(): Promise<HistoricalComparison[]> {
  const results: HistoricalComparison[] = [];
  const now = new Date();

  for (const item of HISTORICAL_SYMBOLS) {
    try {
      const currentQuote = await fetchQuote(item.symbol);
      if (currentQuote.price == null) continue;

      const comparison: HistoricalComparison = {
        symbol: item.symbol,
        nameKo: item.nameKo,
        current: currentQuote.price,
      };

      // 1주, 1개월, 3개월, 1년 전 데이터
      const periods: { key: keyof HistoricalComparison; daysAgo: number }[] = [
        { key: "oneWeekAgo", daysAgo: 7 },
        { key: "oneMonthAgo", daysAgo: 30 },
        { key: "threeMonthsAgo", daysAgo: 90 },
        { key: "oneYearAgo", daysAgo: 365 },
      ];

      for (const period of periods) {
        try {
          const pastDate = new Date(now);
          pastDate.setDate(pastDate.getDate() - period.daysAgo);
          const futureDate = new Date(pastDate);
          futureDate.setDate(futureDate.getDate() + 5); // 주말/휴일 대비

          const history = await yahooFinance.chart(item.symbol, {
            period1: pastDate,
            period2: futureDate,
            interval: "1d",
          });

          const quotes = history.quotes;
          if (quotes && quotes.length > 0) {
            const close = quotes[0].close;
            if (close != null) {
              (comparison as unknown as Record<string, unknown>)[period.key] = +close.toFixed(2);
            }
          }
        } catch {
          // 개별 기간 실패는 무시
        }
      }

      results.push(comparison);
    } catch {
      // 개별 심볼 실패는 무시
    }
  }

  return results;
}

export async function collectAllMarketData(): Promise<MarketDataCollection> {
  const { now, dateStr } = getEffectiveDate();
  if (process.env.TEST_DATE) {
    console.log(`🧪 테스트 모드: 날짜=${dateStr}, 시간=06:00`);
  }
  const allErrors: string[] = [];

  console.log("📊 시장 데이터 수집 시작...");

  const [korea, us, europe, japan, china, forex, commodities, bonds, crypto] =
    await Promise.all([
      fetchIndices(KOREA_INDICES),
      fetchIndices(US_INDICES),
      fetchIndices(EUROPE_INDICES),
      fetchIndices(JAPAN_INDICES),
      fetchIndices(CHINA_INDICES),
      fetchForex(FOREX_PAIRS),
      fetchCommodities(COMMODITIES),
      fetchBonds(BONDS),
      fetchCrypto(CRYPTO),
    ]);

  allErrors.push(
    ...korea.errors,
    ...us.errors,
    ...europe.errors,
    ...japan.errors,
    ...china.errors,
    ...forex.errors,
    ...commodities.errors,
    ...bonds.errors,
    ...crypto.errors
  );

  console.log(`✅ 데이터 수집 완료 (에러: ${allErrors.length}건)`);
  if (allErrors.length > 0) {
    console.log("⚠️ 수집 실패 항목:", allErrors.join(", "));
  }

  return {
    collectedAt: toKSTString(now),
    date: dateStr,
    dayOfWeek: getKoreanDayOfWeek(now),
    koreaStocks: korea.data,
    usStocks: us.data,
    europeStocks: europe.data,
    japanStocks: japan.data,
    chinaStocks: china.data,
    forex: forex.data,
    commodities: commodities.data,
    bonds: bonds.data,
    crypto: crypto.data,
    collectionErrors: allErrors,
  };
}
