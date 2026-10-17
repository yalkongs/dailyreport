// lib/source-links.test.ts
// C09 (2026-10-16 감사): 10편 모두 뉴스 원문으로 이동하는 링크가 없었다(Market은 URL 수집 자체가 없음).
// 출처 목록은 입력으로 받은 뉴스 일부이며 본문 주장과 1:1 인용이 아님을 밝힌다. 생성 내부 용어는 노출하지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems } from "./news-collector";
import { renderReport } from "./report-renderer";
import { renderMorningHtml } from "./etf/renderer";
import type { MarketDataCollection, ReportContent } from "./types";
import type { CollectedData, MorningReport } from "./etf/types";

test("Market RSS: 기사 링크를 보존하고 http(s)가 아니면 버린다", () => {
  const xml = `<rss><channel>
    <item><title>기사 A</title><link>https://www.yna.co.kr/view/AKR1</link><pubDate>Thu, 15 Oct 2026 21:00:00 GMT</pubDate></item>
    <item><title><![CDATA[기사 B]]></title><link><![CDATA[javascript:alert(1)]]></link></item>
  </channel></rss>`;
  const items = parseRssItems(xml, "연합뉴스 경제", "economy");
  assert.equal(items[0].url, "https://www.yna.co.kr/view/AKR1");
  assert.equal(items[1].url, undefined);
});

const CONTENT: ReportContent = {
  cover: { headline: "t", subline: "s" }, summary: { yesterday: "y", today: "t", myAssets: "m" }, cardLine: { kind: "watch", text: "c" },
  bigStory: { content: [] }, watchPoints: [], compass: [], soWhat: [], calendar: [], closingMessage: "c",
};
const MDATA: MarketDataCollection = {
  collectedAt: "2026-10-16T07:00:00+09:00", date: "2026-10-16", dayOfWeek: "금",
  koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
};

test("Market 리포트: 참고한 뉴스 목록에 원문 링크(이스케이프), 고지보다 앞", () => {
  const html = renderReport(CONTENT, MDATA, [], undefined, [
    { title: "금리 <동결> 전망", source: "연합뉴스 경제", url: "https://www.yna.co.kr/view/AKR1?a=1&b=2" },
    { title: "링크 없는 기사", source: "Google News" },
  ]);
  assert.match(html, /참고한 뉴스/);
  assert.match(html, /<a href="https:\/\/www\.yna\.co\.kr\/view\/AKR1\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">금리 &lt;동결&gt; 전망<\/a>/);
  assert.match(html, /링크 없는 기사/);
  assert.ok(html.indexOf("참고한 뉴스") < html.indexOf("투자 유의사항 및 법적 고지"));
  assert.doesNotMatch(renderReport(CONTENT, MDATA, []), /class="source-list"/);
});

test("ETF 리포트: 출처 제목에 원문 링크, '전략에 사용한' 대신 참고 뉴스, 생성 내부 용어 미노출", () => {
  const report = {
    cover: { headline: "h", subline: "s" }, overnightBrief: { narrative: "n", krImpact: "k" },
    usEtfHighlights: { topMover: { ticker: "SPY", reason: "r" }, bottomMover: { ticker: "SPY", reason: "r" }, sectorNarrative: "s" },
    todayWatch: { items: [] }, closingLine: "c", narrativeNotes: { bigPicture: "큰 그림 본문입니다." },
  } as MorningReport;
  const data = {
    reportType: "morning", date: "2026-10-16", quotes: [], flows: [], investorFlows: [], analysisLens: "변동성국면", narrativeAngle: "환율_양면성",
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
    news: [{ title: "반도체 ETF 거래 급증", source: "연합뉴스", publishedAt: "2026-10-16T06:00:00+09:00", url: "https://www.yna.co.kr/view/AKR2" }],
  } as CollectedData;
  const html = renderMorningHtml(report, data);
  assert.match(html, /<a class="source-link" href="https:\/\/www\.yna\.co\.kr\/view\/AKR2"[^>]*>반도체 ETF 거래 급증<\/a>/);
  assert.doesNotMatch(html, /전략에 사용한 뉴스 출처/);
  assert.doesNotMatch(html, /서사 앵글|분석 렌즈/);
});
