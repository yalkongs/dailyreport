// lib/etf/domestic-stress.test.ts
// C06 (2026-10-16 감사): 미국 ETF·VIX 중심 점수만으로 국내 급락일(KODEX 200 -8.21%)에
// '위험자산 선호, 공격 접근'을 최상단 결론으로 내던 문제.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMorningStrategyInput } from './morning-strategy'
import { renderMorningHtml } from './renderer'
import type { CollectedData, EtfQuote, MorningReport } from './types'

function q(ticker: string, changePercent: number): EtfQuote {
  return {
    ticker, name: ticker, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent, volume: 1,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote
}

function data(kodex200: number): CollectedData {
  return {
    reportType: 'morning', date: '2026-10-16', flows: [], investorFlows: [], news: [], analysisLens: '',
    quotes: [q('SPY', 1.2), q('QQQ', 1.6), q('IWM', 1.4), q('HYG', 0.4), q('069500.KS', kodex200)],
    macro: { usdKrw: 1380, dxy: 100, vix: 14, moveIndex: null, us10y: 4.2, fearGreed: null, wti: null, gold: null },
  } as CollectedData
}

test('미국 위험선호 + 국내 급락: 최상단 결론은 공격이 아니고 국내 급락을 밝힌다', () => {
  const s = buildMorningStrategyInput(data(-8.21))
  assert.equal(s.regime.label, 'risk_on') // 미국 국면 판정 자체는 유지
  assert.notEqual(s.executiveSummary.tacticalStance, '공격')
  assert.match(s.executiveSummary.title, /국내/)
  assert.match(s.executiveSummary.title, /-8\.21%/)
  assert.match(s.regime.summary, /국내/)
})

test('국내 급락이 아니면 기존 판단 유지', () => {
  const s = buildMorningStrategyInput(data(0.4))
  assert.equal(s.executiveSummary.tacticalStance, '공격')
})

// 2026-10-17 개편(spec 3.2): 국내 급락일 판단(C06)은 화면에서 빼고 문장 생성 기준으로만 쓴다 —
// 규칙 점수·확신도·Decision Frame(공격/방어 결론 패널)은 페이지에 나오지 않는다.
test('렌더: 규칙 점수·확신도·시장 태도 결론은 화면에 표시하지 않는다', () => {
  const report: MorningReport = {
    cover: { headline: 'h', subline: 's' }, summary: { overseas: 'o', domestic: 'd', focus: 'f' },
    assetCards: [], todayChecks: [], card: { key: 'kr-large', line: 'c' },
  }
  const html = renderMorningHtml(report, data(-8.21))
  assert.doesNotMatch(html, /확신도/)
  assert.doesNotMatch(html, /규칙 점수/)
  assert.doesNotMatch(html, /Decision Frame|시장 태도/)
})
