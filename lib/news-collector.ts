/**
 * 뉴스 헤드라인 수집기 — Google News RSS + 연합뉴스 RSS
 * 정규식 기반 XML 파싱 (DOMParser 불가, 외부 라이브러리 불필요)
 */

import { fetchTextWithTimeout } from "./fetch-utils";
import type { NewsHeadline } from "./types";

const FEEDS: { url: string; category: NewsHeadline["category"]; source: string }[] = [
  {
    url: "https://news.google.com/rss/search?q=stock+market+economy&hl=en&gl=US&ceid=US:en",
    category: "global",
    source: "Google News",
  },
  {
    url: "https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD+%EC%A6%9D%EC%8B%9C+%EA%B2%BD%EC%A0%9C&hl=ko&gl=KR&ceid=KR:ko",
    category: "korea",
    source: "Google News KR",
  },
  {
    url: "https://www.yna.co.kr/rss/economy.xml",
    category: "economy",
    source: "연합뉴스",
  },
];

const MAX_PER_CATEGORY = 5;

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

    // HTML 엔티티 디코딩
    const cleanTitle = title
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    items.push({
      title: cleanTitle,
      source,
      category,
      pubDate: pubDateMatch?.[1]?.trim(),
    });

    if (items.length >= MAX_PER_CATEGORY) break;
  }

  return items;
}

export async function collectNews(): Promise<NewsHeadline[]> {
  const allNews: NewsHeadline[] = [];
  const seen = new Set<string>();

  for (const feed of FEEDS) {
    try {
      const xml = await fetchTextWithTimeout(feed.url, { timeoutMs: 10000 });
      const items = parseRssItems(xml, feed.source, feed.category);

      for (const item of items) {
        // 제목 기반 중복 제거
        const key = item.title.toLowerCase().slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          allNews.push(item);
        }
      }
    } catch (err) {
      console.log(`  ⚠️ ${feed.source} RSS 수집 실패: ${(err as Error).message}`);
    }
  }

  return allNews;
}
