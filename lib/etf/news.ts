// lib/news.ts
import { fetchText } from './fetcher'
import type { NewsItem } from './types'

type NewsCategory = NonNullable<NewsItem['category']>

interface RssSource {
  url: string
  source: string
  limit: number
  category: NewsCategory
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
    category: 'korea',
  },
  // 2) 환율/금리
  {
    url: 'https://news.google.com/rss/search?q=%EC%9B%90%EB%8B%AC%EB%9F%AC+%ED%99%98%EC%9C%A8+%ED%95%9C%EC%9D%80+%EA%B8%B0%EC%A4%80%EA%B8%88%EB%A6%AC&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (환율·금리)',
    limit: 3,
    category: 'economy',
  },
  // 3) 미 증시
  {
    url: 'https://news.google.com/rss/search?q=S%26P500+%EB%82%98%EC%8A%A4%EB%8B%A5+%EB%AF%B8%EA%B5%AD%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (미증시)',
    limit: 3,
    category: 'global',
  },
  // 4) 정책/지정학 (연준·관세·지정학 리스크)
  {
    url: 'https://news.google.com/rss/search?q=%EC%97%B0%EC%A4%80+FOMC+%EA%B4%80%EC%84%B8+%EC%A7%80%EC%A0%95%ED%95%99&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (정책·지정학)',
    limit: 3,
    category: 'global',
  },
  // 5) 원자재 (유가·금)
  {
    url: 'https://news.google.com/rss/search?q=%EA%B5%AD%EC%A0%9C%EC%9C%A0%EA%B0%80+%EC%9B%90%EC%9C%A0+%EA%B8%88%EA%B0%92+WTI&hl=ko&gl=KR&ceid=KR:ko',
    source: 'Google News (원자재)',
    limit: 3,
    category: 'economy',
  },
  // 6) 연합뉴스 경제 — 2차 출처로 유지
  {
    url: 'https://www.yonhapnewstv.co.kr/category/news/economy/feed/',
    source: '연합뉴스',
    limit: 4,
    category: 'economy',
  },
  // Tier A A1 (2026-07-02): 국제 AI·반도체 시그널 — 삼성·SK하이닉스를 움직이는
  //   해외 벨웨더·정책·메모리 리서치. 국내 피드만으론 못 잡던 채널.
  // 7) 반도체 벨웨더 — NVIDIA·TSMC·Micron·HBM
  {
    url: 'https://news.google.com/rss/search?q=NVIDIA+OR+TSMC+OR+Micron+HBM+AI+chip&hl=en&gl=US&ceid=US:en',
    source: 'Google News (반도체벨웨더)',
    limit: 2,
    category: 'semiconductor',
  },
  // 8) 반도체 정책·공급망 — 미 수출규제·칩법
  {
    url: 'https://news.google.com/rss/search?q=semiconductor+export+control+chip&hl=en&gl=US&ceid=US:en',
    source: 'Google News (반도체정책)',
    limit: 2,
    category: 'semiconductor',
  },
  // 9) 메모리·HBM 리서치 — TrendForce 등(공개 RSS 부재 → Google News 인덱스로 대체)
  {
    url: 'https://news.google.com/rss/search?q=TrendForce+memory+HBM+DRAM+price&hl=en&gl=US&ceid=US:en',
    source: 'Google News (메모리리서치)',
    limit: 2,
    category: 'semiconductor',
  },
]

// P2: 다양성 보장 — 같은 source 가 결과의 절반을 넘지 않도록 분배
const TOP_N = 8
const MAX_PER_SOURCE = 3

// Tier A A1 (2026-07-02): description 이 실질 리드를 담는 소스만 snippet 발췌.
const SNIPPET_SOURCES = new Set(['연합뉴스'])
const SNIPPET_MAX_LEN = 240
const MIN_SEMICONDUCTOR = 2 // 국제 반도체 뉴스 우선 노출(신선도 윈도 내 항목이 있으면 예약; 윈도 밖이면 best-effort)

// P0 (2026-04-24): 48시간 초과 기사 제외 + publishedHoursAgo 주입.
// 4/23 호르무즈 건처럼 4~6일 전 trending 기사가 "현재 상황"으로 인용되는
// 사고를 방지. 날짜 필터로 충분히 수집되지 않는 경우 상한을 72h로 확장.
const MAX_AGE_HOURS = 48
const FALLBACK_MAX_AGE_HOURS = 72

export async function collectNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(s => fetchRss(s.url, s.source, s.limit, s.category))
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

  // 국제 반도체 최소 예약 + source 독점 방지 라운드-로빈 선별
  return selectBalanced(sorted, {
    topN: TOP_N,
    maxPerSource: MAX_PER_SOURCE,
    minSemiconductor: MIN_SEMICONDUCTOR,
  })
}

// Tier A A1: 신선도순 정렬된 뉴스에서 최종 선별.
// 1차로 국제 반도체 최소 minSemiconductor 건 예약, 2차로 라운드로빈으로 topN 까지.
export function selectBalanced(
  sorted: NewsItem[],
  opts: { topN: number; maxPerSource: number; minSemiconductor: number }
): NewsItem[] {
  const { topN, maxPerSource, minSemiconductor } = opts
  const perSource = new Map<string, number>()
  const selected: NewsItem[] = []
  const picked = new Set<NewsItem>()

  const tryPick = (item: NewsItem): boolean => {
    if (selected.length >= topN || picked.has(item)) return false
    const used = perSource.get(item.source) ?? 0
    if (used >= maxPerSource) return false
    perSource.set(item.source, used + 1)
    selected.push(item)
    picked.add(item)
    return true
  }

  let reserved = 0
  for (const item of sorted) {
    if (reserved >= minSemiconductor || selected.length >= topN) break
    if (item.category === 'semiconductor' && tryPick(item)) reserved++
  }

  for (const item of sorted) {
    if (selected.length >= topN) break
    tryPick(item)
  }

  return selected
}

function hoursSince(iso: string): number | undefined {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, (Date.now() - t) / 3_600_000)
}

async function fetchRss(
  url: string,
  source: string,
  limit: number,
  category: NewsCategory
): Promise<NewsItem[]> {
  const xml = await fetchText(url, {}, 8000)
  if (!xml) return []
  return parseEtfRssItems(xml, source, category, limit)
}

// Tier A A1: fetchRss 의 파싱부 — 순수 함수로 분리(단위 테스트 가능).
// description 이 실질 리드를 담는 소스만 snippet 발췌, item 에 category 실음.
export function parseEtfRssItems(
  xml: string,
  source: string,
  category: NewsCategory,
  limit: number
): NewsItem[] {
  const items: NewsItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)

  for (const match of itemMatches) {
    if (items.length >= limit) break
    const block = match[1]
    const title = extractTag(block, 'title')
    const pubDate = extractTag(block, 'pubDate')
    const link = extractTag(block, 'link') || extractTag(block, 'guid')

    if (title && link) {
      const item: NewsItem = {
        title: stripCdata(title),
        source,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        url: stripCdata(link),
        category,
      }
      if (SNIPPET_SOURCES.has(source)) {
        const desc = extractTag(block, 'description')
        const cleaned = desc ? cleanSnippet(stripCdata(desc)) : ''
        if (cleaned) item.snippet = cleaned
      }
      items.push(item)
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

// Tier A A1: description → 프롬프트용 짧은 리드(HTML 제거·엔티티 디코드·길이 컷).
function cleanSnippet(raw: string): string {
  const noTags = raw.replace(/<[^>]+>/g, ' ')
  const decoded = noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (decoded.length <= SNIPPET_MAX_LEN) return decoded
  return decoded.slice(0, SNIPPET_MAX_LEN).trim() + '…'
}
