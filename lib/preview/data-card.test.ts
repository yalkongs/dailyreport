import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import {
  diverging, renderStripesSvg, buildMosaicTiles, renderMosaicSvg, fitText, renderMarketCardSvg, renderEtfCardSvg, cardDateLabel,
  cardTextFits, measureTextPx, glyphAdvanceEm, CARD_TEXT_RULES,
} from './data-card'

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

// ── 보정 라운드: 실측 글자 폭·균형 줄바꿈·넘침 처리 ─────────────────────────────

test('fitText 실측 폭: 승인 시안대로 Market 제목은 2줄 균형, 줄 폭은 한 줄 한도 안', () => {
  const r = fitText('코스피 급락 다음 날, 미 증시는 숨 고르기', [94, 80, 72], 3, 936)
  assert.deepEqual(r, { size: 94, lines: ['코스피 급락 다음 날,', '미 증시는 숨 고르기'], overflow: false })
  for (const line of r.lines) assert.ok(measureTextPx(line, r.size, 'title') <= 936)
  // 실제 Pretendard ExtraBold 94px·자간 -2px에서 시안의 첫 줄 폭은 약 717px
  assert.ok(Math.abs(measureTextPx('코스피 급락 다음 날,', 94, 'title') - 717) < 6)
})

test('fitText 실측 폭: ETF 샘플 제목은 88px 2줄(영문 대문자·쉼표 폭 포함)', () => {
  const r = fitText('반도체 ETF, 미국보다 훨씬 크게 빠졌다', [88, 80, 72], 3, 936)
  assert.deepEqual(r, { size: 88, lines: ['반도체 ETF, 미국보다', '훨씬 크게 빠졌다'], overflow: false })
})

test('fitText 실측 폭: 한 줄 문구(Bold·자간 -1)는 58px 2줄, 줄 길이가 같으면 윗줄이 긴 쪽', () => {
  // 시안은 손으로 끊은 줄이라 길이가 같은 두 끊기 중 어느 쪽을 쓸지는 규칙으로 정한다(윗줄이 긴 쪽).
  const a = fitText('해외 충격보다 국내 수급 부담이 더 컸습니다', [58, 52, 48], 2, 936, 'line')
  assert.deepEqual(a, { size: 58, lines: ['해외 충격보다 국내 수급', '부담이 더 컸습니다'], overflow: false })
  const b = fitText('반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다', [58], 2, 936, 'line')
  assert.equal(b.size, 58); assert.equal(b.overflow, false); assert.equal(b.lines.length, 2)
  for (const line of b.lines) assert.ok(measureTextPx(line, 58, 'line') <= 936)
})

test('fitText: 최소 줄 수를 유지하고 모든 줄이 한도 안에 든다', () => {
  // 한 줄에 단어 둘이 못 들어가는 긴 단어 3개 → 3줄이 최소, 각 줄은 한 단어
  const r = fitText('가나다라마바사아자 차카타파하가나다라마 바사아자차카타파하가', [94], 3, 936)
  assert.equal(r.overflow, false); assert.equal(r.lines.length, 3)
  // 2줄이면 두 줄 모두 한도 안
  const two = fitText('가나다라마바사아자 차카 타파하가나다라마 바사', [94], 3, 936)
  assert.equal(two.lines.length, 2)
  assert.ok(Math.max(...two.lines.map(l => measureTextPx(l, 94, 'title'))) <= 936)
})

// Pretendard OTF(hmtx·cmap)를 직접 읽어 data-card.ts에 넣어 둔 글자 폭 표와 대조한다.
function readAdvances(file: string): (cp: number) => number | null {
  const b = fs.readFileSync(file)
  const tables: Record<string, number> = {}
  const n = b.readUInt16BE(4)
  for (let i = 0; i < n; i++) tables[b.toString('ascii', 12 + i * 16, 16 + i * 16)] = b.readUInt32BE(20 + i * 16)
  const upm = b.readUInt16BE(tables['head'] + 18)
  const numHM = b.readUInt16BE(tables['hhea'] + 34)
  const cmap = tables['cmap']
  let sub = -1
  let fmt = 0
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const off = cmap + b.readUInt32BE(cmap + 8 + i * 8)
    const f = b.readUInt16BE(off)
    if (f === 12 || (f === 4 && fmt !== 12)) { sub = off; fmt = f }
  }
  const gid = (cp: number): number => {
    if (fmt === 12) {
      for (let i = 0; i < b.readUInt32BE(sub + 12); i++) {
        const g = sub + 16 + i * 12
        if (cp >= b.readUInt32BE(g) && cp <= b.readUInt32BE(g + 4)) return b.readUInt32BE(g + 8) + cp - b.readUInt32BE(g)
      }
      return 0
    }
    const segX2 = b.readUInt16BE(sub + 6)
    const endO = sub + 14
    const startO = endO + segX2 + 2
    const deltaO = startO + segX2
    const rangeO = deltaO + segX2
    for (let i = 0; i < segX2; i += 2) {
      if (cp > b.readUInt16BE(endO + i)) continue
      const s = b.readUInt16BE(startO + i)
      if (cp < s) return 0
      const ro = b.readUInt16BE(rangeO + i)
      const d = b.readInt16BE(deltaO + i)
      if (ro === 0) return (cp + d) & 0xffff
      const g = b.readUInt16BE(rangeO + i + ro + (cp - s) * 2)
      return g === 0 ? 0 : (g + d) & 0xffff
    }
    return 0
  }
  return cp => {
    const g = gid(cp)
    return g === 0 ? null : b.readUInt16BE(tables['hmtx'] + 4 * Math.min(g, numHM - 1)) / upm
  }
}

test('글자 폭 표: 글꼴 파일(Pretendard ExtraBold·Bold)의 실제 진행폭과 일치', () => {
  const dir = path.resolve(__dirname, '../../assets/fonts')
  for (const [file, weight] of [['Pretendard-ExtraBold.otf', 800], ['Pretendard-Bold.otf', 700]] as const) {
    const adv = readAdvances(path.join(dir, file))
    for (let cp = 0x20; cp <= 0x7e; cp++) {
      const real = adv(cp)
      assert.ok(real !== null, `${file} U+${cp.toString(16)} 없음`)
      assert.ok(Math.abs(glyphAdvanceEm(String.fromCodePoint(cp), weight) - real) < 0.001, `${file} ${String.fromCodePoint(cp)}`)
    }
    for (const ch of ['가', '힣', '코', '긁', 'ㄱ']) {
      assert.ok(Math.abs(glyphAdvanceEm(ch, weight) - (adv(ch.codePointAt(0)!) as number)) < 0.001, `${file} ${ch}`)
    }
    for (const ch of ['·', '…', '‘', '’', '“', '”', '–', '—', '×', '→']) {
      assert.ok(Math.abs(glyphAdvanceEm(ch, weight) - (adv(ch.codePointAt(0)!) as number)) < 0.001, `${file} ${ch}`)
    }
    assert.ok(Math.abs(glyphAdvanceEm('％', weight) - (adv(0xff05) as number)) < 0.001)
  }
})

test('cardTextFits: 렌더러와 같은 규칙으로 통과·사유를 알려 준다', () => {
  assert.deepEqual(cardTextFits('market', { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', line: '해외 충격보다 국내 수급 부담이 더 컸습니다' }), { ok: true, reasons: [] })
  assert.deepEqual(cardTextFits('etf', { headline: '반도체 ETF, 미국보다 훨씬 크게 빠졌다', holdingLabel: '반도체를 갖고 있다면', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다' }), { ok: true, reasons: [] })
  const bad = cardTextFits('market', { headline: '가'.repeat(80), line: '나'.repeat(60) })
  assert.equal(bad.ok, false)
  assert.equal(bad.reasons.length, 2)
  assert.match(bad.reasons[0], /headline/); assert.match(bad.reasons[1], /line/)
  const noLabel = cardTextFits('etf', { headline: '반도체 ETF', line: '한 줄', holdingLabel: ' ' })
  assert.equal(noLabel.ok, false); assert.match(noLabel.reasons.join(), /holdingLabel/)
  const longLabel = cardTextFits('etf', { headline: '반도체 ETF', line: '한 줄', holdingLabel: '가'.repeat(30) })
  assert.equal(longLabel.ok, false)
  // ETF 제목 규칙: 88·80px은 2줄까지, 3줄은 72px에서만
  assert.deepEqual(CARD_TEXT_RULES.etf.title.map(s => [s.size, s.maxLines]), [[88, 2], [80, 2], [72, 3]])
  assert.deepEqual(CARD_TEXT_RULES.market.title.map(s => s.size), [94, 80, 72])
})

// SVG 안 모든 <text>의 아래쪽(baseline + 글자 내림 0.25em)의 최댓값
function maxTextBottom(svg: string): number {
  let max = 0
  for (const m of svg.matchAll(/<text [^>]*?\by="([\d.]+)"[^>]*?font-size="(\d+)"/g)) {
    max = Math.max(max, Number(m[1]) + 0.25 * Number(m[2]))
  }
  return max
}

test('넘침: 렌더러는 줄 수를 지키고 마지막 줄을 …로 줄이며 카드 밖으로 그리지 않는다', () => {
  const warn = mock.method(console, 'warn', () => {})
  try {
    const long = '가나다라마바사아자차카타파하 '.repeat(12)
    const market = renderMarketCardSvg({ date: '2026-10-19', headline: long, line: long, sessions: [] })
    assert.ok(maxTextBottom(market) <= 1350, `market bottom ${maxTextBottom(market)}`)
    assert.equal((market.match(/<text [^>]*font-weight="800"/g) ?? []).length, 3)    // 제목 3줄 한도
    assert.equal((market.match(/…<\/text>/g) ?? []).length, 2)                       // 제목·한 줄 각각 말줄임
    const etf = renderEtfCardSvg({ date: '2026-10-19', headline: long, holdingLabel: '가'.repeat(30), line: long, tiles: [] })
    assert.ok(maxTextBottom(etf) <= 1350, `etf bottom ${maxTextBottom(etf)}`)
    assert.equal((etf.match(/<text [^>]*font-weight="800"/g) ?? []).length, 3)
    assert.equal((etf.match(/…<\/text>/g) ?? []).length, 3)                          // 제목·라벨·한 줄
    assert.ok(warn.mock.callCount() >= 5)
  } finally {
    warn.mock.restore()
  }
})

test('3줄 제목 밀어내기: Market 94px·ETF 72px 3줄이어도 본문이 카드 안에 있다', () => {
  const words = '가나다라마바사아자 차카타파하가나다라마 바사아자차카타파하가'
  const sub = '가나다라마바사아자차카 타파하가나다라마바사'
  assert.equal(cardTextFits('market', { headline: words, line: sub }).ok, true)
  const market = renderMarketCardSvg({ date: '2026-10-19', headline: words, line: sub, sessions: [] })
  assert.equal((market.match(/<text [^>]*font-weight="800"/g) ?? []).length, 3)
  assert.match(market, /font-size="94"/)
  assert.ok(maxTextBottom(market) <= 1350, `market bottom ${maxTextBottom(market)}`)
  const etf = renderEtfCardSvg({ date: '2026-10-19', headline: words, holdingLabel: '반도체를 갖고 있다면', line: sub, tiles: [] })
  assert.equal((etf.match(/<text [^>]*font-weight="800"/g) ?? []).length, 3)
  assert.match(etf, /font-size="72"/)
  assert.ok(maxTextBottom(etf) <= 1350, `etf bottom ${maxTextBottom(etf)}`)
  // 밀어내기: 라벨 상단은 제목 하단 + 54px 이상
  const labelY = Number(/data-role="holding-label" x="72" y="([\d.]+)"/.exec(etf)![1])
  assert.ok(labelY - 0.952 * 46 >= 767 + 3 * 72 * 1.2 + 54 - 0.01)
})

test('XML 이스케이프: 제목·한 줄·라벨의 & < >가 그대로 SVG에 들어가지 않는다', () => {
  const market = renderMarketCardSvg({ date: '2026-10-19', headline: 'S&P 500 <급락> 이후', line: 'A&B "인용" 확인', sessions: [] })
  assert.match(market, /S&amp;P 500 &lt;급락&gt; 이후/)
  assert.match(market, /A&amp;B &quot;인용&quot; 확인/)
  assert.doesNotMatch(market, /S&P 500/); assert.doesNotMatch(market, /<급락>/)
  const etf = renderEtfCardSvg({ date: '2026-10-19', headline: 'R&D <ETF>', holdingLabel: 'R&D를 갖고 있다면', line: 'a<b', tiles: [] })
  assert.match(etf, /R&amp;D &lt;ETF&gt;/); assert.match(etf, /R&amp;D를 갖고 있다면/); assert.match(etf, /a&lt;b/)
  assert.doesNotMatch(etf, /R&D/)
})
