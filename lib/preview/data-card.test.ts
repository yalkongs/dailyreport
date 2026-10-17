import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diverging, renderStripesSvg, buildMosaicTiles, renderMosaicSvg, fitText, renderMarketCardSvg, renderEtfCardSvg, cardDateLabel } from './data-card'

test('연속 색: 보합·중간·최대, 방향', () => {
  assert.equal(diverging(0.05), '#E7EAEE')
  assert.equal(diverging(-9), '#0B3A8C')
  assert.equal(diverging(9), '#A50E0E')
  assert.notEqual(diverging(1), diverging(3)) // 연속
  assert.match(diverging(-2), /^#[0-9A-F]{6}$/)
})

test('스트라이프: 거래일 수만큼 줄, 마지막 아래 ▼, 빈 입력은 중립 띠', () => {
  const s = renderStripesSvg([{ date: '2026-10-14', pct: -0.44 }, { date: '2026-10-15', pct: -7.57 }], 1080, 560, { marker: true })
  assert.equal((s.match(/data-session=/g) ?? []).length, 2)
  assert.match(s, /data-marker="today"/)
  assert.match(s, /fill="#0B3A8C"/)
  const empty = renderStripesSvg([], 1080, 560)
  assert.match(empty, /fill="#E7EAEE"/)
})

test('모자이크 타일: 레버리지·인버스 제외, 자산군 순서 후 등락순, 주제 테마 강조', () => {
  const q = (ticker: string, name: string, market: 'KR' | 'US', p: number) => ({ ticker, name, market, changePercent: p })
  const tiles = buildMosaicTiles([
    q('122630.KS', 'KODEX 레버리지', 'KR', -16), q('252670.KS', 'KODEX 200선물인버스2X', 'KR', 15),
    q('069500.KS', 'KODEX 200', 'KR', -8.2), q('091160.KS', 'KODEX 반도체', 'KR', -11.9),
    q('SPY', 'SPDR S&P 500', 'US', 0.3), q('SOXX', 'iShares Semiconductor', 'US', -0.9), q('XXX', '결측', 'US', null as unknown as number),
  ], '반도체')
  assert.deepEqual(tiles.map(t => t.ticker), ['069500.KS', '091160.KS', 'SPY', 'SOXX'])
  assert.deepEqual(tiles.filter(t => t.featured).map(t => t.ticker), ['091160.KS', 'SOXX'])
  const svg = renderMosaicSvg(tiles, 1080, 600)
  assert.match(svg, />Korea</); assert.match(svg, />USA</)
  assert.equal((svg.match(/data-featured="1"/g) ?? []).length, 2)
})

test('fitText: 넘치면 글자를 줄이고, 최소 크기에서도 넘치면 overflow', () => {
  const ok = fitText('코스피 급락 다음 날, 미 증시는 숨 고르기', [94, 80, 72], 3, 936)
  assert.equal(ok.overflow, false); assert.ok(ok.lines.length <= 3); assert.equal(ok.size, 94)
  const long = fitText('가'.repeat(80), [94, 80, 72], 3, 936)
  assert.equal(long.overflow, true)
})

test('Market 카드: 규격·위쪽 테두리·로고 원본 크롭·숫자 없음·날짜', () => {
  const svg = renderMarketCardSvg({ date: '2026-10-16', headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', line: '해외 충격보다 국내 수급 부담이 더 컸습니다', sessions: [{ date: '2026-10-15', pct: -7.57 }] })
  assert.match(svg, /width="1080" height="1350"/)
  assert.match(svg, /data-role="top-border"/)
  assert.doesNotMatch(svg, /data-role="bottom-bar"/)
  assert.match(svg, /viewBox="65 231 871 564"/)
  assert.match(svg, /Daily Market/); assert.match(svg, /10\.16 금/)
  assert.doesNotMatch(svg, /[+\-−]\d+(\.\d+)?%/)
  assert.equal(cardDateLabel('2026-10-16'), '10.16 금')
})

test('ETF 카드: Korea/USA, 갖고 있다면 라벨, 불릿 없음', () => {
  const svg = renderEtfCardSvg({ date: '2026-10-16', headline: '반도체 ETF, 미국보다 훨씬 크게 빠졌다', holdingLabel: '반도체를 갖고 있다면', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다', tiles: [] })
  assert.match(svg, /ETF Today/); assert.match(svg, /반도체를 갖고 있다면/)
  assert.doesNotMatch(svg, /data-role="bullet"/)
})
