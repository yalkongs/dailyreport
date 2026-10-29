// lib/etf/etf-page.test.ts
// 2026-10-17 아침 리포트 개편 — ETF Today 새 페이지 구성(spec 3.2).
// 브리프 테스트에서 두 곳을 고쳤다: 등락 부호는 기존 렌더러 표기(ASCII '-')도 받는다(Ruling 2),
// 'S&P'는 escapeHtml을 거쳐 'S&amp;P'로 렌더된다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMorningHtml } from './renderer'
import { reportPreviewDescription, reportPreviewTitle } from './report-preview'
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

test('펼쳐 보기 표: 거래량 0(장 시작 전 Yahoo 값)은 0원이 아니라 "-"로 보인다', () => {
  const zeroData = { ...data, quotes: data.quotes.map(x => ({ ...x, volume: 0 })) }
  const html = renderMorningHtml(report, zeroData)
  const details = html.slice(html.indexOf('data-section="details"'), html.indexOf('</details>'))
  assert.doesNotMatch(details, />0원</)
  assert.doesNotMatch(details, />\$0</)
  assert.match(details, /<td class="num">-<\/td>/)
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

// ─── Fix round 1 (Ruling 20·21, 리뷰 보강) ─────────────────────────────────────

test('머리글 날짜는 Market과 같은 "2026년 10월 16일 금요일" 형식', () => {
  const html = renderMorningHtml(report, data)
  const top = html.slice(html.indexOf('data-section="masthead"'), html.indexOf('</header>'))
  assert.match(top, /2026년 10월 16일 금요일/)
  assert.doesNotMatch(top, /2026-10-16/)
})

test('세 줄 요약 상자는 Market과 같은 구조(summary-box · summary-list · 라벨 칸), 별도 제목 줄 없음', () => {
  const html = renderMorningHtml(report, data)
  const start = html.indexOf('data-section="summary"')
  const box = html.slice(start, html.indexOf('</section>', start))
  assert.match(html, /<section class="summary-box" data-section="summary" aria-label="세 줄 요약">/)
  assert.match(box, /<ul class="summary-list">/)
  for (const label of ['해외 신호', '국내 상태', '오늘 핵심']) assert.match(box, new RegExp(`<span class="summary-label">${label}</span><span class="summary-text">`))
  assert.doesNotMatch(box, /section-title/)
})

test('제목 h1은 text-wrap: balance', () => {
  assert.match(renderMorningHtml(report, data), /\.cover h1 \{[^}]*text-wrap: balance/)
})

test('렌더 결과는 같은 입력에 같은 출력(생성 시각 pill 없음)', () => {
  const a = renderMorningHtml(report, data)
  assert.equal(renderMorningHtml(report, data), a)
  assert.doesNotMatch(a, /생성 \d{4}-/)
  assert.match(a, /기준일 2026-10-16/)
})

test('페이지 모자이크 강조는 카드와 같은 슬롯(card.key)의 구성원 타일', () => {
  const featured = (r: MorningReport) => [...renderMorningHtml(r, data).matchAll(/data-featured="1" data-ticker="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(featured(report), ['091160.KS'])                                    // kr-semi
  assert.deepEqual(featured({ ...report, card: { ...report.card, key: 'kr-large' } }), ['069500.KS'])
  assert.deepEqual(featured({ ...report, card: { ...report.card, key: 'us-equity' } }), ['SPY'])
  assert.deepEqual(featured({ ...report, card: { ...report.card, key: 'bonds' } }), ['091160.KS']) // 슬롯 밖 → 주제 슬롯(kr-semi)
})

test('이스케이프: 요약·카드 문장·확인 항목·주의 문구의 <script>와 따옴표가 그대로 나가지 않는다(og:description 포함)', () => {
  const evil = '<script>alert("x")</script> "따옴표"'
  const r: MorningReport = {
    ...report,
    summary: { overseas: evil, domestic: evil, focus: evil },
    assetCards: [{ key: 'kr-semi', reason: evil, ifHolding: evil, ifConsidering: evil }],
    todayChecks: [{ time: evil, what: evil, baseline: evil, invalidation: evil }],
    tacticalWarning: evil,
  }
  const html = renderMorningHtml(r, data)
  assert.ok(!html.includes('<script'), '<script 태그 없음')
  assert.ok(!html.includes('"따옴표"'), '본문 따옴표는 &quot;')
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/)
  const og = html.match(/<meta property="og:description" content="([^"]*)">/)
  assert.ok(og, 'og:description 속성이 따옴표로 깨지지 않는다')
  assert.doesNotMatch(og[1], /<|>/)
  assert.match(og[1], /&quot;따옴표&quot;/)
})

function dataWith(quotes: EtfQuote[]): CollectedData {
  return { ...data, quotes }
}

test('경계: 시세가 하나도 없으면(슬롯 0개) 자산군 카드·표 없이 렌더, 고지는 맨 끝', () => {
  const html = renderMorningHtml(report, dataWith([]))
  assert.doesNotMatch(html, /data-asset="/)
  assert.doesNotMatch(html, /data-section="asset-cards"/)
  assert.doesNotMatch(html, /data-section="details"/)
  assert.match(html, /data-section="masthead"/)
  assert.ok(html.lastIndexOf('투자 유의사항 및 법적 고지') > html.indexOf('data-section="today-checks"'))
})

test('경계: 미국 시세가 없으면 국내 표만, 국내 시세가 없으면 미국 표만', () => {
  const krOnly = renderMorningHtml(report, dataWith(data.quotes.filter(x => x.market === 'KR')))
  assert.match(krOnly, /국내 ETF · 직전 한국 장/)
  assert.doesNotMatch(krOnly, /미국 ETF · 간밤 미국 장/)
  assert.doesNotMatch(krOnly, /data-asset="us-equity"/)
  const usOnly = renderMorningHtml(report, dataWith(data.quotes.filter(x => x.market === 'US')))
  assert.match(usOnly, /미국 ETF · 간밤 미국 장/)
  assert.doesNotMatch(usOnly, /국내 ETF · 직전 한국 장/)
  assert.match(usOnly, /data-asset="us-equity"/)
  assert.doesNotMatch(usOnly, /data-asset="kr-/)
})

test('og:description: 길면 오늘 핵심은 그대로 두고 해외 신호를 구절 경계에서 줄인다(90자 이내)', () => {
  const overseas = '간밤 미국 대형주는 금리 안정 속에 보합권에서 마감했고, 반도체만 약세를 보이며 장 후반 낙폭을 키웠습니다. 달러는 강세였습니다.'
  const focus = '반도체 ETF 개장 30분 거래대금이 전일 같은 시간보다 늘어나는지가 오늘의 핵심입니다.'
  const d = reportPreviewDescription('2026-10-16', { overseas, focus })
  assert.ok(Array.from(d).length <= 90, `${Array.from(d).length}: ${d}`)
  assert.ok(d.endsWith(` · ${focus}`), d)
  const head = d.slice(0, d.length - ` · ${focus}`.length)
  assert.ok(head.endsWith('…'), head)
  assert.ok(overseas.startsWith(head.slice(0, -1)), head)
  assert.match(head, /(마감했고|보합권에서|금리 안정 속에|대형주는)…$/) // 쉼표·공백 경계에서 자름(어절 중간이 아님)
})

// M6 (Ruling 26): 모자이크 설명·자산군 카드의 고정 라벨 "어제"는 직전 한국 거래일에 맞춘다.
test('고정 라벨: 금요일 발행은 어제, 월요일은 지난 금요일, 휴장 다음 날은 직전 거래일', () => {
  const at = (date: string) => renderMorningHtml(report, { ...data, date })
  // 10/12는 한국만 휴장(한글날 10/09) — 미국 직전 거래일(10/09)이 한국(10/08)과 달라 모자이크 설명에 미국 날짜가 붙는다(Ruling 40).
  for (const [date, label, us] of [['2026-10-16', '어제', ''], ['2026-10-19', '지난 금요일', ''], ['2026-10-12', '직전 거래일', ' · 미국은 10/9\\(금\\) 종가']] as const) {
    const html = at(date)
    assert.match(html, new RegExp(`<figcaption>${label} 분석한 ETF 등락\\(Korea·USA, 레버리지·인버스 제외\\)${us}</figcaption>`), date)
    assert.match(html, new RegExp(`aria-label="${label} 분석한 ETF 등락`), date)
    assert.match(html, new RegExp(`<div class="field-label">${label} 움직임</div>`), date)
    assert.match(html, new RegExp(`${label} 많이 움직인 자산군부터 놓았습니다`), date)
    if (label !== '어제') assert.doesNotMatch(html.slice(html.indexOf('<body')), /어제 (분석한|움직임|많이 움직인)/, date)
  }
})

// Ruling 40 (2026-10-20): 미국 직전 거래일이 한국과 다른 날(11/27: 한국 11/26 · 미국 11/25 — 추수감사절)은 미국 숫자가 나오는 곳에
// 미국 날짜를 밝힌다 — 미국 대표 ETF가 있는 자산군 카드, 모자이크 설명(Korea·USA), 펼쳐 보기의 미국 ETF 표 제목. 평일은 오늘과 같다.
test('미국 날짜: 미국 직전 거래일이 한국과 다르면 미국 대표가 있는 카드·모자이크 설명·미국 표 제목에 밝힌다(11/27)', () => {
  const html = renderMorningHtml(report, { ...data, date: '2026-11-27' })
  assert.match(html, /<figcaption>어제 분석한 ETF 등락\(Korea·USA, 레버리지·인버스 제외\) · 미국은 11\/25\(수\) 종가<\/figcaption>/)
  assert.match(html, /aria-label="어제 분석한 ETF 등락\(Korea·USA, 레버리지·인버스 제외\) · 미국은 11\/25\(수\) 종가"/)
  assert.match(assetCard(html, 'us-equity'), /<div class="field-label">어제 움직임 · 미국은 11\/25\(수\) 종가<\/div>/)
  for (const key of ['kr-semi', 'kr-large']) {
    const card = assetCard(html, key)
    assert.match(card, /<div class="field-label">어제 움직임<\/div>/, key)
    assert.doesNotMatch(card, /미국은/, `${key}: 국내 대표만 있는 카드에는 붙이지 않는다`)
  }
  assert.match(html, /미국 ETF · 11\/25\(수\) 미국 장 \(1개\)/)
  assert.doesNotMatch(html, /간밤 미국 장 \(/)
})

test('미국 날짜: 양국 직전 거래일이 같은 평일(화)은 지금과 똑같다 — 미국 날짜를 붙이지 않는다', () => {
  const html = renderMorningHtml(report, { ...data, date: '2026-10-20' })
  assert.match(html, /<figcaption>어제 분석한 ETF 등락\(Korea·USA, 레버리지·인버스 제외\)<\/figcaption>/)
  assert.match(assetCard(html, 'us-equity'), /<div class="field-label">어제 움직임<\/div>/)
  assert.match(html, /미국 ETF · 간밤 미국 장 \(1개\)/)
  assert.doesNotMatch(html.slice(html.indexOf('<body')), /미국은 \d/)
})

test('미국 날짜: 한국만 휴장한 다음 날(10/12)은 미국 날짜가 한국보다 늦다 — 미국 대표 카드에 10/9(금)', () => {
  const html = renderMorningHtml(report, { ...data, date: '2026-10-12' })
  assert.match(assetCard(html, 'us-equity'), /<div class="field-label">직전 거래일 움직임 · 미국은 10\/9\(금\) 종가<\/div>/)
  assert.match(html, /미국 ETF · 10\/9\(금\) 미국 장 \(1개\)/)
})

// M2 (spec §4): og:title = 제목(Market과 같이 접두어 없이). 제목이 비면 날짜 기반 기본값.
test('og:title·twitter:title은 제목 그대로(접두어 없음), 비면 날짜 기본값', () => {
  const html = renderMorningHtml(report, data)
  assert.match(html, /<meta property="og:title" content="반도체 ETF, 미국보다 훨씬 크게 빠졌다">/)
  assert.match(html, /<meta name="twitter:title" content="반도체 ETF, 미국보다 훨씬 크게 빠졌다">/)
  assert.doesNotMatch(html, /iMBank ETF Today ·/)
  assert.equal(reportPreviewTitle('  제목만  '), '제목만')
  assert.equal(reportPreviewTitle('', '2026-10-16 ETF Today'), '2026-10-16 ETF Today')
  const untitled = renderMorningHtml({ ...report, cover: { headline: '', subline: '부제' } }, data)
  assert.match(untitled, /<meta property="og:title" content="2026-10-16 ETF Today">/)
})
