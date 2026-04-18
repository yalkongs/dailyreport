const GOOGLE_FINANCE_BASE_URL = 'https://www.google.com/finance/quote'

const US_GOOGLE_FINANCE_EXCHANGES: Record<string, string> = {
  AGG: 'NYSEARCA',
  ARKK: 'NYSEARCA',
  BITO: 'NYSEARCA',
  BND: 'NASDAQ',
  BOTZ: 'NASDAQ',
  CIBR: 'NASDAQ',
  DBC: 'NYSEARCA',
  DIA: 'NYSEARCA',
  GDX: 'NYSEARCA',
  GLD: 'NYSEARCA',
  HACK: 'NYSEARCA',
  HYG: 'NYSEARCA',
  IBB: 'NASDAQ',
  ICLN: 'NASDAQ',
  IEF: 'NASDAQ',
  IVV: 'NYSEARCA',
  IWM: 'NYSEARCA',
  LIT: 'NYSEARCA',
  LQD: 'NYSEARCA',
  MDY: 'NYSEARCA',
  MTUM: 'BATS',
  PDBC: 'NASDAQ',
  QQQ: 'NASDAQ',
  QUAL: 'BATS',
  SCHB: 'NYSEARCA',
  SCHD: 'NYSEARCA',
  SHY: 'NASDAQ',
  SLV: 'NYSEARCA',
  SMH: 'NASDAQ',
  SOXX: 'NASDAQ',
  SPY: 'NYSEARCA',
  TIP: 'NYSEARCA',
  TLT: 'NASDAQ',
  USMV: 'BATS',
  USO: 'NYSEARCA',
  VIG: 'NYSEARCA',
  VLUE: 'BATS',
  VNQ: 'NYSEARCA',
  VOO: 'NYSEARCA',
  VTI: 'NYSEARCA',
  VTV: 'NYSEARCA',
  VUG: 'NYSEARCA',
  XBI: 'NYSEARCA',
  XLB: 'NYSEARCA',
  XLC: 'NYSEARCA',
  XLE: 'NYSEARCA',
  XLF: 'NYSEARCA',
  XLI: 'NYSEARCA',
  XLK: 'NYSEARCA',
  XLP: 'NYSEARCA',
  XLRE: 'NYSEARCA',
  XLU: 'NYSEARCA',
  XLV: 'NYSEARCA',
  XLY: 'NYSEARCA',
}

export function googleFinanceQuoteUrl(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase()
  const krMatch = normalized.match(/^(\d{6})(?:\.(?:KS|KQ))?$/)
  if (krMatch) return `${GOOGLE_FINANCE_BASE_URL}/${krMatch[1]}:KRX?hl=ko`

  const exchange = US_GOOGLE_FINANCE_EXCHANGES[normalized]
  if (!exchange) return null
  return `${GOOGLE_FINANCE_BASE_URL}/${normalized}:${exchange}?hl=ko`
}
