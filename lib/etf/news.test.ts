import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEtfRssItems, selectBalanced } from './news'
import type { NewsItem } from './types'

// --- parseEtfRssItems: snippet·category (Tier A A1) ---

test('parseEtfRssItems: 화이트리스트 소스(연합)는 snippet 발췌·HTML 제거, category 실림', () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[월성원전 중수 누설 보고]]></title>
      <link>https://ex.com/1</link>
      <description><![CDATA[경북 경주 월성원전 4호기에서 중수가 <p>누설</p>됐다는 보고가 접수됐습니다.]]></description>
      <pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate>
    </item>
  </channel></rss>`
  const items = parseEtfRssItems(xml, '연합뉴스', 'economy', 4)
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'economy')
  assert.ok(items[0].snippet, 'snippet 설정')
  assert.match(items[0].snippet!, /중수가/)
  assert.match(items[0].snippet!, /보고가 접수됐습니다/)
  assert.doesNotMatch(items[0].snippet!, /<p>/)
})

test('parseEtfRssItems: 화이트리스트 밖(Google News)은 snippet 미설정, category는 실림', () => {
  const xml = `<rss><channel>
    <item>
      <title>TSMC raises HBM capex</title>
      <link>https://ex.com/2</link>
      <description>&lt;a&gt;link only&lt;/a&gt;</description>
      <pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate>
    </item>
  </channel></rss>`
  const items = parseEtfRssItems(xml, 'Google News (반도체벨웨더)', 'semiconductor', 2)
  assert.equal(items[0].snippet, undefined)
  assert.equal(items[0].category, 'semiconductor')
})

test('parseEtfRssItems: limit 준수', () => {
  const one = `<item><title>t</title><link>https://ex.com/x</link><pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate></item>`
  const xml = `<rss><channel>${one}${one}${one}</channel></rss>`
  const items = parseEtfRssItems(xml, 'Google News (미증시)', 'global', 2)
  assert.equal(items.length, 2)
})

// --- selectBalanced (ETF): 반도체 최소 예약 ---

function n(title: string, source: string, category: NewsItem['category'], hrs: number): NewsItem {
  return { title, source, category, publishedAt: '2026-07-01T00:00:00Z', url: 'https://ex.com/' + title, publishedHoursAgo: hrs }
}

test('selectBalanced(ETF): 반도체가 뒤로 밀려도 최소 2건 예약', () => {
  const sorted: NewsItem[] = [
    n('k1', 'S1', 'korea', 1),
    n('k2', 'S2', 'korea', 2),
    n('k3', 'S3', 'economy', 3),
    n('k4', 'S4', 'global', 4),
    n('s1', 'SEM1', 'semiconductor', 40),
    n('s2', 'SEM2', 'semiconductor', 50),
  ]
  const out = selectBalanced(sorted, { topN: 4, maxPerSource: 3, minSemiconductor: 2 })
  assert.equal(out.length, 4)
  assert.equal(out.filter(x => x.category === 'semiconductor').length, 2)
})
