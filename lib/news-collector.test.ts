import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems, selectBalanced } from "./news-collector";
import type { NewsHeadline } from "./types";

// --- parseRssItems: snippet 발췌 (Tier A A1) ---

test("parseRssItems: 화이트리스트 소스(연합)는 description을 snippet으로 발췌·HTML 제거", () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[삼성전자 노사 협상 타결]]></title>
      <description><![CDATA[(서울=연합뉴스) 기자 = 삼성전자가 노사 협상을 <b>타결</b>했다고 &apos;공식&apos; 밝혔다.]]></description>
      <pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml, "연합뉴스 경제", "economy");
  assert.equal(items.length, 1);
  assert.ok(items[0].snippet, "snippet이 설정되어야 함");
  assert.match(items[0].snippet!, /삼성전자가 노사 협상을/);
  assert.match(items[0].snippet!, /밝혔다/);
  assert.doesNotMatch(items[0].snippet!, /<b>/, "HTML 태그는 제거되어야 함");
  assert.doesNotMatch(items[0].snippet!, /&apos;|&amp;/, "엔티티는 디코드되어야 함");
});

test("parseRssItems: 화이트리스트 밖 소스(Google News)는 description 있어도 snippet 미설정", () => {
  const xml = `<rss><channel>
    <item>
      <title>Micron beats on HBM demand</title>
      <description>&lt;a href="https://news.google.com/x"&gt;link markup only&lt;/a&gt;</description>
      <pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml, "Google News 반도체벨웨더", "semiconductor");
  assert.equal(items.length, 1);
  assert.equal(items[0].snippet, undefined, "화이트리스트 밖 소스는 snippet 없어야 함");
});

test("parseRssItems: snippet 240자 초과 시 컷 + 말줄임", () => {
  const longDesc = "가".repeat(400);
  const xml = `<rss><channel>
    <item><title>t</title><description><![CDATA[${longDesc}]]></description><pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate></item>
  </channel></rss>`;
  const items = parseRssItems(xml, "연합뉴스 마켓", "economy");
  assert.ok(items[0].snippet!.length <= 241, "240자 + 말줄임(…) 이내");
  assert.match(items[0].snippet!, /…$/);
});

test("parseRssItems: CDATA·엔티티 디코드 회귀", () => {
  const xml = `<rss><channel>
    <item><title>HBM &amp; AI 수요</title><pubDate>Wed, 01 Jul 2026 09:00:00 +0900</pubDate></item>
  </channel></rss>`;
  const items = parseRssItems(xml, "Google News 반도체벨웨더", "semiconductor");
  assert.equal(items[0].title, "HBM & AI 수요");
});

// --- selectBalanced: 국제 반도체 최소 예약 (Tier A A1) ---

function h(title: string, source: string, category: NewsHeadline["category"], hrs: number): NewsHeadline {
  return { title, source, category, publishedHoursAgo: hrs };
}

test("selectBalanced: 반도체가 최신순에서 뒤로 밀려도 최소 2건 예약", () => {
  const sorted: NewsHeadline[] = [
    h("k1", "S1", "korea", 1),
    h("k2", "S1", "korea", 2),
    h("k3", "S2", "korea", 3),
    h("k4", "S3", "economy", 4),
    h("s1", "SEM1", "semiconductor", 50),
    h("s2", "SEM2", "semiconductor", 60),
  ];
  const out = selectBalanced(sorted, { topN: 4, maxPerSource: 3, minSemiconductor: 2 });
  assert.equal(out.length, 4);
  assert.equal(out.filter((x) => x.category === "semiconductor").length, 2, "반도체 2건 보장");
  assert.ok(out.some((x) => x.title === "k1") && out.some((x) => x.title === "k2"), "최신 국내도 채움");
});

test("selectBalanced: maxPerSource 준수 + 반도체 없으면 예약 0으로 무해", () => {
  const sorted: NewsHeadline[] = [
    h("a1", "A", "korea", 1),
    h("a2", "A", "korea", 2),
    h("a3", "A", "korea", 3),
    h("a4", "A", "korea", 4),
    h("b1", "B", "korea", 5),
  ];
  const out = selectBalanced(sorted, { topN: 5, maxPerSource: 3, minSemiconductor: 2 });
  assert.equal(out.filter((x) => x.source === "A").length, 3, "source A는 최대 3건");
  assert.ok(out.some((x) => x.source === "B"));
});
