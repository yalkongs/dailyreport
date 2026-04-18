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

export async function collectNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(s => fetchRss(s.url, s.source, s.limit))
  )

  return results
    .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
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
