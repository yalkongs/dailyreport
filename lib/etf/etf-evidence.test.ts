import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEtfEvidence } from './etf-evidence'
import type { CollectedData, NewsItem, MacroContext } from './types'

function makeData(news: NewsItem[], recentHeadlines: string[] = []): CollectedData {
  return {
    reportType: 'morning',
    date: '2026-05-29',
    quotes: [],
    flows: [],
    investorFlows: [],
    macro: {} as MacroContext,
    news,
    analysisLens: '변동성국면',
    recentHeadlines,
  }
}
function n(title: string, publishedHoursAgo: number): NewsItem {
  return { title, source: 'x', publishedAt: '', url: 'http://x', publishedHoursAgo }
}

test('strong: 고점수 catalyst + 신선', () => {
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, [])
  assert.equal(r.tier, 'strong')
  assert.equal(r.topCatalystScore, 12) // 신선도+5·기업+3·이벤트(노사·타결)+4
})

test('thin: catalyst 약함(4~6)', () => {
  const r = analyzeEtfEvidence(makeData([n('코스피 외국인 순매수 지속', 1)]), 0, [])
  assert.equal(r.tier, 'thin')
})

test('hollow: minScore 통과 catalyst 0건', () => {
  const r = analyzeEtfEvidence(makeData([n('오늘 서울 날씨 대체로 맑음', 30)]), 0, [])
  assert.equal(r.tier, 'hollow')
})

test('hollow: 뉴스 빈 배열', () => {
  const r = analyzeEtfEvidence(makeData([]), 0, [])
  assert.equal(r.tier, 'hollow')
  assert.equal(r.newsCount, 0)
})

test('hollow: news 소스 실패 (catalyst 있어도)', () => {
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, ['news'])
  assert.equal(r.tier, 'hollow')
})

test('thin: krx-nav 실패면 strong 금지', () => {
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, ['krx-nav'])
  assert.equal(r.tier, 'thin')
})

test('anomalyCount는 tier에 영향 없음(맥락 노출만)', () => {
  const r = analyzeEtfEvidence(makeData([n('오늘 서울 날씨 대체로 맑음', 30)]), 99, [])
  assert.equal(r.tier, 'hollow')
  assert.equal(r.anomalyCount, 99)
})
