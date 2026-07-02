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
  // Tier A A1 (2026-07-02): 국제 AI·반도체 시그널 — 한국 반도체(삼성·SK하이닉스)를
  //   움직이는 해외 벨웨더·정책·메모리 리서치. 국내 피드만으론 못 잡던 채널.
  // 8. 반도체 벨웨더 — NVIDIA·TSMC·Micron·HBM 실적/가이던스/수요
  {
    url: googleNewsEn("NVIDIA OR TSMC OR Micron HBM AI chip"),
    category: "semiconductor",
    source: "Google News 반도체벨웨더",
  },
  // 9. 반도체 정책·공급망 — 미국 수출규제·칩법 등
  {
    url: googleNewsEn("semiconductor export control chip"),
    category: "semiconductor",
    source: "Google News 반도체정책",
  },
  // 10. 메모리·HBM 리서치 — TrendForce 등(공개 RSS 부재 → Google News 인덱스로 대체)
  {
    url: googleNewsEn("TrendForce memory HBM DRAM price"),
    category: "semiconductor",
    source: "Google News 메모리리서치",
  },
];

// Tier A A1: description 이 실질 기사 리드를 담는 소스만 snippet 발췌.
// (Google News description 은 링크 마크업뿐이라 무가치 → 제외.)
const SNIPPET_SOURCES = new Set(["연합뉴스 경제", "연합뉴스 마켓"]);
const SNIPPET_MAX_LEN = 240;
const MIN_SEMICONDUCTOR = 2; // 국제 반도체 뉴스 최소 노출 보장(신선도에 밀리지 않도록)

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
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function hoursSince(pubDate: string | undefined): number | undefined {
  if (!pubDate) return undefined;
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

// Tier A A1: RSS description 을 프롬프트용 짧은 리드로 정리(HTML 제거·엔티티 디코드·길이 컷).
function cleanSnippet(raw: string): string {
  const noTags = raw.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(noTags).replace(/\s+/g, " ").trim();
  if (decoded.length <= SNIPPET_MAX_LEN) return decoded;
  return decoded.slice(0, SNIPPET_MAX_LEN).trim() + "…";
}

export function parseRssItems(xml: string, source: string, category: NewsHeadline["category"]): NewsHeadline[] {
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
    const item: NewsHeadline = {
      title: decodeEntities(title),
      source,
      category,
      pubDate,
      publishedHoursAgo: hoursSince(pubDate),
    };

    // 실질 요약 소스만 description 발췌(그 외 소스는 snippet 미설정).
    if (SNIPPET_SOURCES.has(source)) {
      const descMatch = itemXml.match(
        /<description><!\[CDATA\[([\s\S]*?)\]\]>|<description>([\s\S]*?)<\/description>/
      );
      const rawDesc = (descMatch?.[1] || descMatch?.[2] || "").trim();
      const cleaned = rawDesc ? cleanSnippet(rawDesc) : "";
      if (cleaned) item.snippet = cleaned;
    }

    items.push(item);

    if (items.length >= MAX_PER_FEED) break;
  }

  return items;
}

// Tier A A1: 신선도순 정렬된 뉴스에서 최종 선별.
// 1차로 국제 반도체 최소 minSemiconductor 건 예약(신선도에 밀려 탈락하는 것 방지),
// 2차로 기존 라운드로빈(source 독점 방지)으로 topN 까지 채움.
export function selectBalanced(
  sorted: NewsHeadline[],
  opts: { topN: number; maxPerSource: number; minSemiconductor: number }
): NewsHeadline[] {
  const { topN, maxPerSource, minSemiconductor } = opts;
  const perSource = new Map<string, number>();
  const selected: NewsHeadline[] = [];
  const picked = new Set<NewsHeadline>();

  const tryPick = (item: NewsHeadline): boolean => {
    if (selected.length >= topN || picked.has(item)) return false;
    const used = perSource.get(item.source) ?? 0;
    if (used >= maxPerSource) return false;
    perSource.set(item.source, used + 1);
    selected.push(item);
    picked.add(item);
    return true;
  };

  // 1차: 국제 반도체 최소 예약
  let reserved = 0;
  for (const item of sorted) {
    if (reserved >= minSemiconductor || selected.length >= topN) break;
    if (item.category === "semiconductor" && tryPick(item)) reserved++;
  }

  // 2차: 신선도순 라운드로빈으로 잔여 채움
  for (const item of sorted) {
    if (selected.length >= topN) break;
    tryPick(item);
  }

  return selected;
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

  // 국제 반도체 최소 예약 + source 독점 방지 라운드로빈 선별
  return selectBalanced(sorted, {
    topN: TOP_N,
    maxPerSource: MAX_PER_SOURCE,
    minSemiconductor: MIN_SEMICONDUCTOR,
  });
}
