// lib/news.ts
import { fetchText } from './fetcher'
import type { NewsItem } from './types'

interface RssSource {
  url: string
  source: string
  limit: number
}

// P2 (2026-04-24): 쿼리 다각화. 기존 일반 키워드("ETF fund flow") 는 trending
// 기사가 상위에 떠 신선도가 낮았음. 5개 영역으로 분산해 각 3건씩 수집한 뒤
// 신선도 + 다양성 기준으로 상위 8건 선별.
const RSS_SOURCES: RssSource[] = [
  // 1) 국내 증시 (코스피/코스닥)
  {
    url: 'https://news.google.com/rss/search?q=%EC%BD%94%EC%8A%A4%ED%94%BC+%EC%BD%94%EC%8A%A4%EB%8B%A5+%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (국내증시)',
    limit: 3,
  },
  // 2) 환율/금리
  {
    url: 'https://news.google.com/rss/search?q=%EC%9B%90%EB%8B%AC%EB%9F%AC+%ED%99%98%EC%9C%A8+%ED%95%9C%EC%9D%80+%EA%B8%B0%EC%A4%80%EA%B8%88%EB%A6%AC&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (환율·금리)',
    limit: 3,
  },
  // 3) 미 증시
  {
    url: 'https://news.google.com/rss/search?q=S%26P500+%EB%82%98%EC%8A%A4%EB%8B%A5+%EB%AF%B8%EA%B5%AD%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (미증시)',
    limit: 3,
  },
  // 4) 정책/지정학 (연준·관세·지정학 리스크)
  {
    url: 'https://news.google.com/rss/search?q=%EC%97%B0%EC%A4%80+FOMC+%EA%B4%80%EC%84%B8+%EC%A7%80%EC%A0%95%ED%95%99&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (정책·지정학)',
    limit: 3,
  },
  // 5) 원자재 (유가·금)
  {
    url: 'https://news.google.com/rss/search?q=%EA%B5%AD%EC%A0%9C%EC%9C%A0%EA%B0%80+%EC%9B%90%EC%9C%A0+%EA%B8%88%EA%B0%92+WTI&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (원자재)',
    limit: 3,
  },
  // 6) 연합뉴스 경제 — 2차 출처로 유지
  {
    url: 'https://www.yonhapnewstv.co.kr/category/news/economy/feed/',
    source: '연합뉴스',
    limit: 4,
  },
]

// P2: 다양성 보장 — 같은 source 가 결과의 절반을 넘지 않도록 분배
const TOP_N = 8
const MAX_PER_SOURCE = 3

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
  const candidates = fresh.length >= 6 ? fresh : withinWindow(FALLBACK_MAX_AGE_HOURS)

  // 최신순 정렬 (publishedHoursAgo 오름차순)
  const sorted = candidates.sort(
    (a, b) => (a.publishedHoursAgo ?? 999) - (b.publishedHoursAgo ?? 999)
  )

  // P2: 같은 source 가 TOP_N 의 절반 이상을 차지하지 않도록 라운드-로빈 선별
  const perSource = new Map<string, number>()
  const selected: NewsItem[] = []
  for (const item of sorted) {
    if (selected.length >= TOP_N) break
    const used = perSource.get(item.source) ?? 0
    if (used >= MAX_PER_SOURCE) continue
    perSource.set(item.source, used + 1)
    selected.push(item)
  }
  return selected
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
