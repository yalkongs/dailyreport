// lib/universe.ts
import type { EtfDefinition } from './types'

export const KR_ETF_UNIVERSE: EtfDefinition[] = [
  // 국내 주식 지수 (10)
  { ticker: '069500.KS', name: 'KODEX 200', market: 'KR', category: '지수' },
  { ticker: '229200.KS', name: 'KODEX 코스닥150', market: 'KR', category: '지수' },
  { ticker: '278540.KS', name: 'KODEX MSCI Korea TR', market: 'KR', category: '지수' },
  { ticker: '102110.KS', name: 'TIGER 200', market: 'KR', category: '지수' },
  { ticker: '252670.KS', name: 'KODEX 200선물인버스2X', market: 'KR', category: '지수' },
  { ticker: '122630.KS', name: 'KODEX 레버리지', market: 'KR', category: '지수' },
  { ticker: '148020.KS', name: 'KODEX KRX300', market: 'KR', category: '지수' },
  { ticker: '091160.KS', name: 'KODEX 반도체', market: 'KR', category: '섹터', theme: '반도체' },
  { ticker: '091180.KS', name: 'KODEX 은행', market: 'KR', category: '섹터' },
  { ticker: '102960.KS', name: 'KODEX 자동차', market: 'KR', category: '섹터' },
  // 국내 섹터 (15)
  { ticker: '305720.KS', name: 'KODEX 2차전지산업', market: 'KR', category: '섹터', theme: '2차전지' },
  { ticker: '261060.KS', name: 'KODEX 헬스케어', market: 'KR', category: '섹터' },
  { ticker: '228790.KS', name: 'TIGER 화학', market: 'KR', category: '섹터' },
  { ticker: '157490.KS', name: 'TIGER 소프트웨어', market: 'KR', category: '섹터', theme: 'AI' },
  { ticker: '139290.KS', name: 'TIGER 미디어컨텐츠', market: 'KR', category: '섹터' },
  { ticker: '323410.KS', name: 'TIGER 2차전지테마', market: 'KR', category: '섹터', theme: '2차전지' },
  { ticker: '364970.KS', name: 'TIGER KRX반도체', market: 'KR', category: '섹터', theme: '반도체' },
  { ticker: '139270.KS', name: 'TIGER 200 IT', market: 'KR', category: '섹터' },
  { ticker: '227550.KS', name: 'TIGER 200 건설', market: 'KR', category: '섹터' },
  { ticker: '139220.KS', name: 'TIGER 200 에너지화학', market: 'KR', category: '섹터' },
  { ticker: '139240.KS', name: 'TIGER 200 금융', market: 'KR', category: '섹터' },
  { ticker: '395160.KS', name: 'KODEX K-방산', market: 'KR', category: '섹터', theme: '방산' },
  { ticker: '091230.KS', name: 'TIGER 200 소재', market: 'KR', category: '섹터' },
  { ticker: '227540.KS', name: 'TIGER 200 생활소비재', market: 'KR', category: '섹터' },
  { ticker: '139260.KS', name: 'TIGER 200 중공업', market: 'KR', category: '섹터' },
  // 국내 테마 (10)
  { ticker: '364980.KS', name: 'TIGER AI코리아그로스', market: 'KR', category: '테마', theme: 'AI' },
  { ticker: '458730.KS', name: 'KODEX K-로봇', market: 'KR', category: '테마', theme: '로봇' },
  { ticker: '266160.KS', name: 'KODEX 리츠', market: 'KR', category: '테마', theme: '리츠' },
  { ticker: '381180.KS', name: 'TIGER 글로벌리튬&2차전지', market: 'KR', category: '테마', theme: '2차전지' },
  { ticker: '453810.KS', name: 'TIGER 조선TOP10', market: 'KR', category: '테마', theme: '조선' },
  { ticker: '441680.KS', name: 'KODEX 미국반도체MV', market: 'KR', category: '테마', theme: '반도체' },
  { ticker: '385510.KS', name: 'TIGER K게임', market: 'KR', category: '테마' },
  { ticker: '461270.KS', name: 'KODEX 원자력', market: 'KR', category: '테마', theme: '원자력' },
  { ticker: '395750.KS', name: 'TIGER AI반도체핵심소재', market: 'KR', category: '테마', theme: 'AI' },
  { ticker: '463050.KS', name: 'TIGER 방산&우주', market: 'KR', category: '테마', theme: '방산' },
  // 국내 채권·대안 (10)
  { ticker: '114820.KS', name: 'KODEX 국고채3년', market: 'KR', category: '채권' },
  { ticker: '148070.KS', name: 'KOSEF 국고채10년', market: 'KR', category: '채권' },
  { ticker: '182480.KS', name: 'TIGER 단기통안채', market: 'KR', category: '채권' },
  { ticker: '130680.KS', name: 'TIGER 미국채10년선물', market: 'KR', category: '채권' },
  { ticker: '139230.KS', name: 'TIGER 국채3년', market: 'KR', category: '채권' },
  { ticker: '132030.KS', name: 'KODEX 골드선물(H)', market: 'KR', category: '대안', theme: '금' },
  { ticker: '261270.KS', name: 'KODEX WTI원유선물(H)', market: 'KR', category: '대안' },
  { ticker: '292150.KS', name: 'TIGER 미국달러단기채권액티브', market: 'KR', category: '채권' },
  { ticker: '357870.KS', name: 'TIGER 미국달러SOFR금리', market: 'KR', category: '채권' },
  { ticker: '329200.KS', name: 'TIGER 미국채30년스트립', market: 'KR', category: '채권' },
  // 해외 지수 국내 상장 (5)
  { ticker: '360750.KS', name: 'TIGER 미국S&P500', market: 'KR', category: '해외지수' },
  { ticker: '133690.KS', name: 'TIGER 미국나스닥100', market: 'KR', category: '해외지수' },
  { ticker: '195930.KS', name: 'TIGER 유로스탁스50', market: 'KR', category: '해외지수' },
  { ticker: '190160.KS', name: 'KODEX 차이나H', market: 'KR', category: '해외지수' },
  { ticker: '241180.KS', name: 'TIGER 일본니케이225', market: 'KR', category: '해외지수' },
]

export const US_ETF_UNIVERSE: EtfDefinition[] = [
  // 시장 지수 (8)
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', market: 'US', category: '지수' },
  { ticker: 'QQQ', name: 'Invesco NASDAQ-100 ETF', market: 'US', category: '지수' },
  { ticker: 'VTI', name: 'Vanguard Total Market ETF', market: 'US', category: '지수' },
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', market: 'US', category: '지수' },
  { ticker: 'IWM', name: 'iShares Russell 2000 ETF', market: 'US', category: '지수' },
  { ticker: 'DIA', name: 'SPDR Dow Jones ETF', market: 'US', category: '지수' },
  { ticker: 'MDY', name: 'SPDR S&P MidCap 400 ETF', market: 'US', category: '지수' },
  { ticker: 'SCHB', name: 'Schwab US Broad Market ETF', market: 'US', category: '지수' },
  // GICS 섹터 (11)
  { ticker: 'XLK', name: 'Technology Select Sector SPDR', market: 'US', category: '섹터', theme: 'Tech' },
  { ticker: 'XLF', name: 'Financial Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLV', name: 'Health Care Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLE', name: 'Energy Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLI', name: 'Industrial Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLP', name: 'Consumer Staples Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLY', name: 'Consumer Discretionary Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLB', name: 'Materials Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLC', name: 'Communication Services Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLRE', name: 'Real Estate Select Sector SPDR', market: 'US', category: '섹터' },
  { ticker: 'XLU', name: 'Utilities Select Sector SPDR', market: 'US', category: '섹터' },
  // 팩터 (6)
  { ticker: 'VTV', name: 'Vanguard Value ETF', market: 'US', category: '팩터' },
  { ticker: 'VUG', name: 'Vanguard Growth ETF', market: 'US', category: '팩터' },
  { ticker: 'MTUM', name: 'iShares MSCI USA Momentum ETF', market: 'US', category: '팩터' },
  { ticker: 'VLUE', name: 'iShares MSCI USA Value ETF', market: 'US', category: '팩터' },
  { ticker: 'USMV', name: 'iShares MSCI USA Min Volatility ETF', market: 'US', category: '팩터' },
  { ticker: 'QUAL', name: 'iShares MSCI USA Quality ETF', market: 'US', category: '팩터' },
  // 테마 (10)
  { ticker: 'SOXX', name: 'iShares Semiconductor ETF', market: 'US', category: '테마', theme: '반도체' },
  { ticker: 'ARKK', name: 'ARK Innovation ETF', market: 'US', category: '테마', theme: 'AI' },
  { ticker: 'ICLN', name: 'iShares Global Clean Energy ETF', market: 'US', category: '테마', theme: '클린에너지' },
  { ticker: 'LIT', name: 'Global X Lithium & Battery Tech ETF', market: 'US', category: '테마', theme: '2차전지' },
  { ticker: 'BOTZ', name: 'Global X Robotics & AI ETF', market: 'US', category: '테마', theme: 'AI' },
  { ticker: 'HACK', name: 'ETFMG Prime Cyber Security ETF', market: 'US', category: '테마', theme: 'AI' },
  { ticker: 'IBB', name: 'iShares Biotechnology ETF', market: 'US', category: '테마' },
  { ticker: 'XBI', name: 'SPDR S&P Biotech ETF', market: 'US', category: '테마' },
  { ticker: 'GDX', name: 'VanEck Gold Miners ETF', market: 'US', category: '테마', theme: '금' },
  { ticker: 'CIBR', name: 'First Trust Cybersecurity ETF', market: 'US', category: '테마' },
  // 채권 (8)
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', market: 'US', category: '채권' },
  { ticker: 'AGG', name: 'iShares Core US Aggregate Bond ETF', market: 'US', category: '채권' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', market: 'US', category: '채권' },
  { ticker: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF', market: 'US', category: '채권' },
  { ticker: 'HYG', name: 'iShares iBoxx High Yield Corporate Bond ETF', market: 'US', category: '채권' },
  { ticker: 'LQD', name: 'iShares iBoxx Investment Grade Corporate Bond ETF', market: 'US', category: '채권' },
  { ticker: 'TIP', name: 'iShares TIPS Bond ETF', market: 'US', category: '채권' },
  { ticker: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', market: 'US', category: '채권' },
  // 대안·원자재 (7)
  { ticker: 'GLD', name: 'SPDR Gold Shares ETF', market: 'US', category: '대안', theme: '금' },
  { ticker: 'SLV', name: 'iShares Silver Trust ETF', market: 'US', category: '대안' },
  { ticker: 'USO', name: 'United States Oil Fund ETF', market: 'US', category: '대안' },
  { ticker: 'DBC', name: 'Invesco DB Commodity Index ETF', market: 'US', category: '대안' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate ETF', market: 'US', category: '대안' },
  { ticker: 'BITO', name: 'ProShares Bitcoin ETF', market: 'US', category: '대안' },
  { ticker: 'PDBC', name: 'Invesco Optimum Yield Diversified Commodity ETF', market: 'US', category: '대안' },
]

export const ALL_ETF_UNIVERSE: EtfDefinition[] = [...KR_ETF_UNIVERSE, ...US_ETF_UNIVERSE]

export function getEtfByTicker(ticker: string): EtfDefinition | undefined {
  return ALL_ETF_UNIVERSE.find(e => e.ticker === ticker)
}

export function getEtfsByMarket(market: 'KR' | 'US'): EtfDefinition[] {
  return ALL_ETF_UNIVERSE.filter(e => e.market === market)
}

export function getEtfsByTheme(theme: string): EtfDefinition[] {
  return ALL_ETF_UNIVERSE.filter(e => e.theme === theme)
}
