// lib/morning-report-plan.ts
import type { CollectedData, EtfQuote, MorningStrategyInput } from './types'
import { buildMorningStrategyInput } from './morning-strategy'

export interface MorningWatchPlan {
  title: string
  role: 'domestic-open' | 'fx-rates' | 'execution-risk'
  facts: string[]
  instruction: string
}

export interface MorningNarrativePlan {
  centerTopic: string
  coverFacts: string[]
  overnightFacts: string[]
  krImpactFacts: string[]
  sectorFacts: string[]
  todayWatch: MorningWatchPlan[]
}

function findQuote(quotes: EtfQuote[], ticker: string): EtfQuote | undefined {
  return quotes.find(q => q.ticker === ticker)
}

function fmtMove(q: EtfQuote | undefined): string {
  if (!q || q.changePercent === null) return '미확보'
  return `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`
}

function krName(q: EtfQuote | undefined, fallback: string): string {
  if (!q) return fallback
  return `${q.name} (${q.ticker.replace(/\.(KS|KQ)$/i, '')})`
}

export function buildMorningNarrativePlan(
  data: CollectedData,
  strategy: MorningStrategyInput = buildMorningStrategyInput(data)
): MorningNarrativePlan {
  const quotes = data.quotes
  const spy = findQuote(quotes, 'SPY')
  const qqq = findQuote(quotes, 'QQQ')
  const soxx = findQuote(quotes, 'SOXX')
  const tlt = findQuote(quotes, 'TLT')
  const semiconductor = findQuote(quotes, '091160.KS')
  const sp500Kr = findQuote(quotes, '360750.KS')
  const leverage = findQuote(quotes, '122630.KS')

  const preferred = strategy.executiveSummary.preferredGroups.slice(0, 2).join(' · ') || '대표 ETF군'
  const centerTopic = `${strategy.regime.displayName}: ${preferred} 확인`

  // Today Watch 1 지시문 회전 — 매일 같은 "해외 → 국내 거래대금" 프레임
  // 대신 요일마다 다른 관점(외국인 수급 / 섹터 순환 / 거래량 급증 등)을 섞어 다양성 확보.
  const dayOfWeek = new Date(`${data.date}T00:00:00+09:00`).getDay() // 0=Sun..6=Sat
  const domesticOpenInstructions = [
    '해외 선행 지수 대비 국내 반도체 ETF의 장 초반 거래대금이 얼마나 따라오는지 씁니다.',
    '외국인 수급과 국내 주요 ETF 거래 흐름이 어떻게 엇갈리거나 일치하는지 씁니다.',
    '섹터별로 장 초반 자금이 어디로 먼저 몰리는지, 선행 섹터를 한 가지 짚어서 씁니다.',
    '야간 해외 움직임이 국내 개장 가격에 이미 반영됐는지, 갭 크기와 후속 거래량을 함께 씁니다.',
    '해외 선행과 다른 시그널을 내는 국내 ETF가 있다면 그 이유를 한 가지 근거로 씁니다.',
  ]
  const domesticOpenInstruction = domesticOpenInstructions[dayOfWeek % domesticOpenInstructions.length]

  return {
    centerTopic,
    coverFacts: [
      strategy.executiveSummary.title,
      `시장 태도 ${strategy.executiveSummary.tacticalStance}`,
      `확인 우선 ETF군 ${preferred}`,
    ],
    overnightFacts: [
      `SPY ${fmtMove(spy)}`,
      `QQQ ${fmtMove(qqq)}`,
      `SOXX ${fmtMove(soxx)}`,
      `TLT ${fmtMove(tlt)}`,
      `VIX ${data.macro.vix?.toFixed(2) ?? '미확보'}`,
      `US 10Y ${data.macro.us10y?.toFixed(2) ?? '미확보'}%`,
    ],
    krImpactFacts: [
      `USD/KRW ${data.macro.usdKrw?.toLocaleString('ko-KR') ?? '미확보'}`,
      `${krName(semiconductor, '국내 반도체 ETF')} 거래대금`,
      `${krName(sp500Kr, '국내 상장 S&P 500 ETF')} 환율 효과`,
    ],
    sectorFacts: [
      `SOXX ${fmtMove(soxx)}`,
      `QQQ ${fmtMove(qqq)}`,
      `${krName(semiconductor, '국내 반도체 ETF')} 장 초반 거래대금`,
    ],
    todayWatch: [
      {
        title: '국내 개장 확인',
        role: 'domestic-open',
        facts: [`SOXX ${fmtMove(soxx)}`, krName(semiconductor, '국내 반도체 ETF'), '개장 후 30분 거래대금'],
        instruction: domesticOpenInstruction,
      },
      {
        title: '환율/금리 확인',
        role: 'fx-rates',
        facts: [`USD/KRW ${data.macro.usdKrw?.toLocaleString('ko-KR') ?? '미확보'}`, `US 10Y ${data.macro.us10y?.toFixed(2) ?? '미확보'}%`, krName(sp500Kr, '국내 상장 해외 ETF')],
        instruction: '환율과 금리가 추가 편입 판단의 속도를 어떻게 제한하는지 씁니다.',
      },
      {
        title: 'ETF 거래 리스크',
        role: 'execution-risk',
        facts: [krName(leverage, '레버리지 ETF'), 'NAV', '괴리율', '지정가'],
        instruction: '레버리지·인버스와 괴리율 확대 상품의 거래 기준을 씁니다.',
      },
    ],
  }
}
