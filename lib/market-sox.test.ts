// spec: docs/superpowers/specs/2026-11-13-market-sox-design.md — 마켓 파이프라인에 필라델피아 반도체지수 편입.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HISTORICAL_SYMBOLS, collectionFailureCounts } from './market-data'
import { OPTIONAL_SYMBOLS } from './optional-symbols'
import { analyzeSideways } from './sideways-detector'
import { renderReport, pickKeyIndicators } from './report-renderer'
import type { MarketDataCollection, MarketIndex } from './types'

const idx = (symbol: string, nameKo: string, changePercent: number | null, price: number | null = 100): MarketIndex =>
  ({ symbol, name: nameKo, nameKo, price, change: 0, changePercent, previousClose: 100 })

function data(over: Partial<MarketDataCollection> = {}): MarketDataCollection {
  return {
    collectedAt: '2026-11-27T06:40:00+09:00', date: '2026-11-27', dayOfWeek: '금',
    koreaStocks: [idx('^KS11', '코스피', 0.1), idx('^KQ11', '코스닥', 0.1)],
    usStocks: [idx('^GSPC', 'S&P 500', 0.1), idx('^IXIC', '나스닥', 0.1), idx('^DJI', '다우존스', 0.1), idx('^SOX', '필라델피아 반도체지수', -7.88)],
    europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
    ...over,
  } as MarketDataCollection
}

test('수집 목록: ^SOX 가 미국 지수·과거 비교에 같은 이름으로 있다', () => {
  const src = fs.readFileSync('lib/market-data.ts', 'utf8')
  assert.match(src, /symbol: "\^SOX", name: "PHLX Semiconductor", nameKo: "필라델피아 반도체지수"/)
  assert.ok(HISTORICAL_SYMBOLS.some(h => h.symbol === '^SOX' && h.nameKo === '필라델피아 반도체지수'))
  assert.ok(OPTIONAL_SYMBOLS.has('^SOX'))
})

test('수집 실패율 가드: ^SOX 는 분자·분모에서 빠진다(다른 항목 13/26 실패 + SOX 실패 → 통과)', () => {
  const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => idx(`${p}${i}`, `${p}${i}`, 0))
  const d = data({ europeStocks: many(21, 'E') }) // 코스피·코스닥 2 + 미국 3 + 유럽 21 = 26 (SOX 제외)
  d.collectionErrors = [...Array.from({ length: 13 }, (_, i) => `E${i}(E${i}) 데이터 수집 실패`), '필라델피아 반도체지수(^SOX) 데이터 수집 실패']
  const { total, failed } = collectionFailureCounts(d)
  assert.equal(total, 26)
  assert.equal(failed, 13)
  assert.ok(!(failed > total * 0.5))
})

test('횡보장 판정: ^SOX 의 큰 변동이 전체 지표 판정을 흔들지 않는다', () => {
  const withSox = analyzeSideways(data())
  const without = analyzeSideways(data({ usStocks: data().usStocks.filter(s => s.symbol !== '^SOX') }))
  assert.equal(withSox.isSideways, without.isSideways)
  assert.equal(withSox.avgAbsChange, without.avgAbsChange)
})

test('펼쳐 보기: 반도체지수 카드가 다우 뒤에 · 핵심 지표 3칸은 그대로', () => {
  const content = {
    cover: { headline: '제목', subline: '부제' },
    summary: { yesterday: 'a', today: 'b', myAssets: 'c' }, cardLine: { kind: 'cause', text: 't' },
    bigStory: { content: [{ type: 'paragraph', text: '본문' }] }, watchPoints: [], compass: [], soWhat: [], calendar: [], closingMessage: '',
  } as never
  const html = renderReport(content, data(), [], 'normal', [], [])
  const dow = html.indexOf('다우존스')
  const sox = html.indexOf('필라델피아 반도체지수')
  assert.ok(dow > 0 && sox > dow, '다우 뒤에 반도체지수')
  assert.ok(!pickKeyIndicators(data()).some(i => i.label.includes('반도체')))
})

test('첫 화면 시장 요약: 스냅샷 순회에서 ^SOX 제외(9칸 유지)', () => {
  const src = fs.readFileSync('scripts/run.ts', 'utf8')
  assert.match(src, /for \(const idx of data\.usStocks\) if \(!OPTIONAL_SYMBOLS\.has\(idx\.symbol\)\) addIndex\(idx\)/)
})

test('프롬프트: 업종 등락 짐작 금지 원칙', () => {
  const src = fs.readFileSync('lib/claude-client.ts', 'utf8')
  assert.match(src, /대표 지수가 올랐다고 업종도 올랐다고 짐작하지 말 것/)
})
