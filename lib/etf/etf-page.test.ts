// lib/etf/etf-page.test.ts
// 2026-10-17 아침 리포트 개편 — ETF Today 새 페이지 구성(spec 3.2).
// 브리프 테스트에서 두 곳을 고쳤다: 등락 부호는 기존 렌더러 표기(ASCII '-')도 받는다(Ruling 2),
// 'S&P'는 escapeHtml을 거쳐 'S&amp;P'로 렌더된다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMorningHtml } from './renderer'
import { reportPreviewDescription } from './report-preview'
import type { CollectedData, EtfQuote, MorningReport } from './types'

const q = (ticker: string, name: string, pct: number) => ({ ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1000, aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null }) as EtfQuote
const data = { reportType: 'morning', date: '2026-10-16', flows: [], investorFlows: [], news: [], analysisLens: '',
  quotes: [q('069500.KS', 'KODEX 200', -8.21), q('091160.KS', 'KODEX 반도체', -11.94), q('SPY', 'SPDR S&P 500', 0.28)],
  macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null } } as CollectedData
const report: MorningReport = {
  cover: { headline: '반도체 ETF, 미국보다 훨씬 크게 빠졌다', subline: '부제' },
  summary: { overseas: '미국 대형주 보합, 반도체만 약세', domestic: '전일 급락, 변동성 매우 큼', focus: '반도체 ETF 개장 30분 거래대금' },
  assetCards: [{ key: 'kr-semi', ifHolding: '개장 30분 거래대금이 전일 같은 시간보다 늘면 과잉 하락 되돌림 신호로 볼 수 있습니다', ifConsidering: '급락 다음 날은 변동폭이 커 확인 조건부터 봅니다' },
               { key: 'kr-large', ifHolding: 'a', ifConsidering: 'b' }],
  todayChecks: [{ time: '09:00~09:30', what: '반도체 ETF 거래대금', baseline: '전일 같은 시간', invalidation: '줄면 되돌림 가설 보류' },
                { time: '10:00', what: 'w', baseline: 'b', invalidation: 'i' }, { time: '15:30', what: 'w', baseline: 'b', invalidation: 'i' }],
  card: { key: 'kr-semi', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다' },
}

test('ETF 새 구성: 순서, 자산군 카드 숫자는 코드 렌더, 예시 표기, 옛 섹션 없음, 고지 마지막', () => {
  const html = renderMorningHtml(report, data)
  const order = ['data-section="masthead"', 'data-section="summary"', 'data-section="asset-cards"', 'data-section="today-checks"', 'data-section="details"', '투자 유의사항 및 법적 고지']
  const idx = order.map(k => html.indexOf(k)); idx.forEach((v, i) => assert.ok(v >= 0, order[i]))
  assert.deepEqual([...idx].sort((a, b) => a - b), idx)
  assert.match(html, /KODEX 반도체[^<]*<\/[^>]+>[\s\S]{0,200}[−-]11\.94%/) // 코드가 렌더한 등락
  assert.match(html, /예시/)
  for (const gone of ['Decision Frame', 'Characters In The Story', 'ETF군별 전략 지도', 'Domestic ETF Action Board', '규칙 점수', '확신도']) assert.ok(!html.includes(gone), gone)
  assert.match(html, />Korea</)
  assert.match(html, /property="og:site_name" content="iM뱅크"/)
  assert.ok(html.lastIndexOf('투자 유의사항 및 법적 고지') > html.indexOf('data-section="details"'))
})

test('모델이 빠뜨린 자산군 슬롯도 숫자만 있는 카드로 나온다', () => {
  const html = renderMorningHtml(report, data) // report.assetCards 에 us-equity 없음, data 에 SPY 있음
  assert.match(html, /data-asset="us-equity"/)
  assert.match(html, /SPDR S&amp;P 500/)
})

test('레버리지·인버스 주의는 해당 필드가 있을 때만', () => {
  assert.doesNotMatch(renderMorningHtml(report, data), /data-section="tactical"/)
  assert.match(renderMorningHtml({ ...report, tacticalWarning: '레버리지 −16%, 인버스 +15%' }, data), /data-section="tactical"/)
})

// ─── 보강: 마지막 축소판(Ruling 10)이 내보낼 수 있는 모양도 깨지지 않게 ─────────────

function assetCard(html: string, key: string): string {
  const start = html.indexOf(`data-asset="${key}"`)
  assert.ok(start >= 0, `${key} 카드`)
  const next = html.indexOf('data-asset="', start + 1)
  const end = next >= 0 ? next : html.indexOf('data-section="today-checks"', start)
  return html.slice(start, end)
}

test('숫자만 있는 카드: 대표 ETF·예시·등락만, 문장 칸은 없다', () => {
  const card = assetCard(renderMorningHtml(report, data), 'us-equity')
  assert.match(card, /예시/)
  assert.match(card, /\+0\.28%/)
  assert.doesNotMatch(card, /갖고 있다면|새로 본다면/)
  const semi = assetCard(renderMorningHtml(report, data), 'kr-semi')
  assert.match(semi, /갖고 있다면/)
  assert.match(semi, /새로 본다면/)
})

test('확인 항목이 1~2개여도, 자산군 카드가 비어도 렌더된다', () => {
  const thin: MorningReport = { ...report, assetCards: [], todayChecks: report.todayChecks.slice(0, 1) }
  const html = renderMorningHtml(thin, data)
  assert.match(html, /data-section="today-checks"/)
  assert.equal((html.match(/class="check-item"/g) ?? []).length, 1)
  for (const key of ['kr-semi', 'kr-large', 'us-equity']) assert.match(html, new RegExp(`data-asset="${key}"`))
})

test('상단에 AI 작성 시각·데이터 수 메타 줄이 없다', () => {
  const html = renderMorningHtml(report, data)
  const top = html.slice(0, html.indexOf('data-section="summary"'))
  assert.doesNotMatch(top, /생성 시각|생성 \d|ETF 시세: \d|뉴스: \d/)
  assert.match(top, /iM뱅크 AI Analyst/)
  assert.match(top, /ETF Today/)
  assert.match(top, /어제 분석한 ETF 등락\(Korea·USA, 레버리지·인버스 제외\)/)
})

test('펼쳐 보기 표: 국내·미국 ETF 등락과 추정 거래대금(가격×거래량)', () => {
  const html = renderMorningHtml(report, data)
  const details = html.slice(html.indexOf('data-section="details"'), html.indexOf('</details>'))
  assert.match(details, /KODEX 200/)
  assert.match(details, /SPDR S&amp;P 500/)
  assert.match(details, /-8\.21%/)
  assert.match(details, /100,000원/) // 100원 × 1,000주
  assert.match(details, /\$100,000/) // $100 × 1,000주
})

test('데이터 기준: 전일 종가, NAV·괴리율은 주문 전 장중 iNAV 확인', () => {
  const html = renderMorningHtml(report, data)
  assert.match(html, /전일 종가 기준/)
  assert.match(html, /NAV·괴리율은 주문 전 장중 iNAV 확인/)
})

test('og:description = 해외 신호 · 오늘 핵심(90자 이내)', () => {
  const html = renderMorningHtml(report, data)
  assert.match(html, /property="og:description" content="미국 대형주 보합, 반도체만 약세 · 반도체 ETF 개장 30분 거래대금"/)
  const long = reportPreviewDescription('2026-10-16', { overseas: '가'.repeat(60), focus: '나'.repeat(60) })
  assert.ok(Array.from(long).length <= 90, long)
  assert.match(reportPreviewDescription('2026-10-16'), /2026-10-16/) // 요약이 없으면 날짜 기반 기본 문구(page.tsx 폴백)
})
