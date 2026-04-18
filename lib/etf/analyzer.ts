// lib/analyzer.ts
import type { Anomaly, EtfQuote, EtfFlow, InvestorFlow } from './types'

export const ANOMALY_RULES = {
  premiumDiscount: { warning: 0.5, alert: 1.0 },
  // aumChange: 전일 AUM 히스토리 필요 — alert-log 연동 후 추가 예정
  trackingError:   { warning: 0.3, alert: 0.5 },
  volumeSpike:     { warning: 3.0, alert: 5.0 },
  consecutiveSell: { warning: 3,   alert: 5 },
} as const

export function detectAnomalies(
  quotes: EtfQuote[],
  flows: EtfFlow[],
  investorFlows: InvestorFlow[]
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const q of quotes) {
    // 괴리율
    if (q.premiumDiscount !== null) {
      const abs = Math.abs(q.premiumDiscount)
      if (abs >= ANOMALY_RULES.premiumDiscount.warning) {
        anomalies.push({
          ticker: q.ticker,
          market: q.market,
          type: 'premiumDiscount',
          value: q.premiumDiscount,
          threshold: ANOMALY_RULES.premiumDiscount.warning,
          severity: abs >= ANOMALY_RULES.premiumDiscount.alert ? 'alert' : 'warning',
        })
      }
    }

    // AUM 급변 (EtfFlow에서 전일 대비 계산 불가 → quotes의 aum과 별도 이력 비교 필요)
    // 현재는 quotes.aum 데이터만 있어 전일비 계산 불가이므로 volumeSpike로 근사 탐지
    // TODO: alert-log에 전일 AUM을 저장하여 비교 로직 추가

    // 추적오차
    if (q.trackingError !== null && q.trackingError >= ANOMALY_RULES.trackingError.warning) {
      anomalies.push({
        ticker: q.ticker,
        market: q.market,
        type: 'trackingError',
        value: q.trackingError,
        threshold: ANOMALY_RULES.trackingError.warning,
        severity: q.trackingError >= ANOMALY_RULES.trackingError.alert ? 'alert' : 'warning',
      })
    }

    // 거래량 급등
    if (q.volume !== null && q.prev20AvgVolume !== null && q.prev20AvgVolume > 0) {
      const ratio = q.volume / q.prev20AvgVolume
      if (ratio >= ANOMALY_RULES.volumeSpike.warning) {
        anomalies.push({
          ticker: q.ticker,
          market: q.market,
          type: 'volumeSpike',
          value: ratio,
          threshold: ANOMALY_RULES.volumeSpike.warning,
          severity: ratio >= ANOMALY_RULES.volumeSpike.alert ? 'alert' : 'warning',
        })
      }
    }
  }

  // 외국인 연속 순매도
  const quoteMap = new Map(quotes.map(q => [q.ticker, q]))
  for (const inv of investorFlows) {
    if (inv.consecutiveForeignSell >= ANOMALY_RULES.consecutiveSell.warning) {
      const q = quoteMap.get(inv.ticker)
      if (q) {
        anomalies.push({
          ticker: inv.ticker,
          market: q.market,
          type: 'consecutiveSell',
          value: inv.consecutiveForeignSell,
          threshold: ANOMALY_RULES.consecutiveSell.warning,
          severity: inv.consecutiveForeignSell >= ANOMALY_RULES.consecutiveSell.alert ? 'alert' : 'warning',
        })
      }
    }
  }

  return anomalies
}
