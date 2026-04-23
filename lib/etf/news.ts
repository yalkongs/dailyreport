// lib/news.ts
import { fetchText } from './fetcher'
import type { NewsItem } from './types'

interface RssSource {
  url: string
  source: string
  limit: number
}

const RSS_SOURCES: RssSource[] = [
  {
    url: 'https://news.google.com/rss/search?q=ETF+fund+flow&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News (EN)',
    limit: 5,
  },
  {
    url: 'https://news.google.com/rss/search?q=ETF+펀드+자금+흐름&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (KO)',
    limit: 5,
  },
  {
    url: 'https://www.yonhapnewstv.co.kr/category/news/economy/feed/',
    source: '연합뉴스',
    limit: 5,
  },
]

// P0 (2026-04-24): 48시간 초과 기사 제외 + publishedHoursAgo 주입.
// 4/23 호르무즈 건처럼 4~6일 전 trending 기사가 "현재 상황"으로 인용되는
// 사고를 방지. 날짜 필터로 충분히 수집되지 않는 경우 상한을 72h로 확장.
const MAX_AGE_HOURS = 48
const FALLBACK_MAX_AGE_HOURS = 72

export async function collectNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(s => fetchRss(s.url, s.source, s.limit))
  )

  const raw = results
    .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(n => ({ ...n, publishedHoursAgo: hoursSince(n.publishedAt) }))

  const withinWindow = (max: number) => raw.filter(n =>
    n.publishedHoursAgo === undefined || n.publishedHoursAgo <= max
  )

  const fresh = withinWindow(MAX_AGE_HOURS)
  // 48h 내 기사가 6건 미만이면 72h로 확장 (주말/공휴일 대응)
  const result = fresh.length >= 6 ? fresh : withinWindow(FALLBACK_MAX_AGE_HOURS)

  // 최신순 정렬 (publishedHoursAgo 오름차순)
  return result.sort((a, b) => (a.publishedHoursAgo ?? 999) - (b.publishedHoursAgo ?? 999))
}

function hoursSince(iso: string): number | undefined {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, (Date.now() - t) / 3_600_000)
}

async function fetchRss(url: string, source: string, limit: number): Promise<NewsItem[]> {
  const xml = await fetchText(url, {}, 8000)
  if (!xml) return []

  const items: NewsItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)

  for (const match of itemMatches) {
    if (items.length >= limit) break
    const block = match[1]
    const title = extractTag(block, 'title')
    const pubDate = extractTag(block, 'pubDate')
    const link = extractTag(block, 'link') || extractTag(block, 'guid')

    if (title && link) {
      items.push({
        title: stripCdata(title),
        source,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        url: stripCdata(link),
      })
    }
  }
  return items
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1].trim() : null
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}
