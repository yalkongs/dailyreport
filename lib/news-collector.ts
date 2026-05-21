/**
 * 뉴스 헤드라인 수집기 — Google News RSS + 연합뉴스 RSS
 * 정규식 기반 XML 파싱 (DOMParser 불가, 외부 라이브러리 불필요)
 *
 * Phase 1.5 (2026-05-21): 한국 시장 가중 + 신선도 처리.
 * - 기존 3개 일반 피드 → 7개 (한국 대형주 기업 이벤트·수급·증시·환율금리
 *   + 미국 증시 + 연합뉴스 wire 2종).
 * - 48시간 초과 기사 제외 (stale news 차단). 신선 기사 부족 시 72h 확장.
 * - publishedHoursAgo 주입 + 최신순 정렬.
 * - 피드 병렬 수집 (7개 순차 시 최대 70초 → 병렬 ~10초).
 * - 같은 source 가 결과를 독점하지 않도록 라운드로빈 선별.
 *
 * 배경: 2026-05-21 삼성전자 노사 협상 타결이 당일 한국 증시를 크게 움직였으나
 * 기존 일반 키워드 피드("stock market economy")로는 특정 기업 이벤트를 잡지
 * 못했음. 한국 고객·한국 시장이 주 타겟이므로 한국 시장 뉴스 포착을 강화.
 */

import { fetchTextWithTimeout } from "./fetch-utils";
import type { NewsHeadline } from "./types";

function googleNewsKo(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
}
function googleNewsEn(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
}

const FEEDS: { url: string; category: NewsHeadline["category"]; source: string }[] = [
  // 1. 대형주 기업 이벤트 — 삼성전자·SK하이닉스·현대차 등 시총 상위.
  //    지수를 직접 움직이는 기업 이벤트(실적·파업·공시)를 직격.
  {
    url: googleNewsKo("삼성전자 OR SK하이닉스 OR 현대차"),
    category: "korea",
    source: "Google News 대형주",
  },
  // 2. 수급 — 외국인·기관 매매. 한국 장 방향의 핵심 동인.
  {
    url: googleNewsKo("코스피 외국인 기관 순매수"),
    category: "korea",
    source: "Google News 수급",
  },
  // 3. 코스피·코스닥 동향
  {
    url: googleNewsKo("코스피 코스닥 증시"),
    category: "korea",
    source: "Google News 증시",
  },
  // 4. 환율·금리
  {
    url: googleNewsKo("원달러 환율 한국은행 기준금리"),
    category: "economy",
    source: "Google News 환율금리",
  },
  // 5. 미국 증시 간밤 (해외 선행)
  {
    url: googleNewsEn("US stock market"),
    category: "global",
    source: "Google News US",
  },
  // 6. 연합뉴스 경제 wire — 인덱싱 지연 적은 한국 wire 서비스
  {
    url: "https://www.yna.co.kr/rss/economy.xml",
    category: "economy",
    source: "연합뉴스 경제",
  },
  // 7. 연합뉴스 마켓+ wire — 실시간 마켓 기사, 가장 빠른 갱신
  {
    url: "https://www.yna.co.kr/rss/market.xml",
    category: "economy",
    source: "연합뉴스 마켓",
  },
];

const MAX_PER_FEED = 5;
const MAX_AGE_HOURS = 48;
const FALLBACK_MAX_AGE_HOURS = 72;
const TOP_N = 12;          // 프롬프트에 전달할 최종 뉴스 수 (프롬프트 비대화 방지)
const MAX_PER_SOURCE = 3;  // 한 피드가 결과를 독점하지 않도록

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hoursSince(pubDate: string | undefined): number | undefined {
  if (!pubDate) return undefined;
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function parseRssItems(xml: string, source: string, category: NewsHeadline["category"]): NewsHeadline[] {
  const items: NewsHeadline[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/);
    const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);

    const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
    if (!title) continue;

    const pubDate = pubDateMatch?.[1]?.trim();
    items.push({
      title: decodeEntities(title),
      source,
      category,
      pubDate,
      publishedHoursAgo: hoursSince(pubDate),
    });

    if (items.length >= MAX_PER_FEED) break;
  }

  return items;
}

export async function collectNews(): Promise<NewsHeadline[]> {
  // Phase 1.5: 7개 피드 병렬 수집 (순차 시 최대 70초 소요 방지).
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const xml = await fetchTextWithTimeout(feed.url, { timeoutMs: 10000 });
      return parseRssItems(xml, feed.source, feed.category);
    })
  );

  // 수집 결과 평탄화 + 제목 기반 중복 제거
  const seen = new Set<string>();
  const raw: NewsHeadline[] = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        const key = item.title.toLowerCase().slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          raw.push(item);
        }
      }
    } else {
      console.log(`  ⚠️ ${FEEDS[idx].source} RSS 수집 실패: ${(r.reason as Error)?.message ?? r.reason}`);
    }
  });

  // 48h 초과 기사 제외 (날짜 미상은 보존 — wire 일부는 pubDate 누락 가능).
  // 신선 기사가 8건 미만이면 72h 로 확장 (주말·공휴일 대응).
  const withinWindow = (max: number) =>
    raw.filter((n) => n.publishedHoursAgo === undefined || n.publishedHoursAgo <= max);
  const fresh = withinWindow(MAX_AGE_HOURS);
  const filtered = fresh.length >= 8 ? fresh : withinWindow(FALLBACK_MAX_AGE_HOURS);

  // 최신순 정렬 (publishedHoursAgo 오름차순, 날짜 미상은 뒤로)
  const sorted = filtered.sort(
    (a, b) => (a.publishedHoursAgo ?? 9999) - (b.publishedHoursAgo ?? 9999)
  );

  // 같은 source 가 TOP_N 을 독점하지 않도록 라운드로빈 선별
  const perSource = new Map<string, number>();
  const selected: NewsHeadline[] = [];
  for (const item of sorted) {
    if (selected.length >= TOP_N) break;
    const used = perSource.get(item.source) ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    perSource.set(item.source, used + 1);
    selected.push(item);
  }

  return selected;
}
