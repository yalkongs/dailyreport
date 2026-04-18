// lib/analysis-lens.ts
import type { CollectedData } from './types'
import { hasRealFundFlowData } from './morning-strategy'

const ANALYSIS_LENS = [
  '자금흐름',
  '팩터성과',
  '섹터순환',
  '글로벌연동',
  '환율영향',
  '변동성국면',
  '배당관점',
] as const

export function selectAnalysisLens(recentLenses: string[], data?: Pick<CollectedData, 'flows'>): string {
  const recent5 = recentLenses.slice(-5)
  const allowed = data && !hasRealFundFlowData(data)
    ? ANALYSIS_LENS.filter(l => l !== '자금흐름')
    : [...ANALYSIS_LENS]
  const available = allowed.filter(l => !recent5.includes(l))
  const pool = available.length > 0 ? available : allowed
  return pool[Math.floor(Math.random() * pool.length)]
}
