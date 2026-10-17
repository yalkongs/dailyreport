import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_DISCLAIMER_ITEMS, LEGAL_DISCLAIMER_TITLE } from "./legal-disclaimer";
import { renderReport } from "./report-renderer";
import { renderMorningHtml } from "./etf/renderer";
import type { MarketDataCollection, ReportContent } from "./types";
import type { CollectedData, EtfQuote, MorningReport } from "./etf/types";

const MARKET_CONTENT: ReportContent = {
  cover: { headline: "테스트 제목", subline: "테스트 서브라인" },
  summary: { yesterday: "어제 요약", today: "오늘 요약", myAssets: "내 자산 요약" },
  cardLine: { kind: "watch", text: "카드 한 줄" },
  bigStory: { content: [{ type: "paragraph", text: "본문" }] },
  watchPoints: [],
  compass: [],
  soWhat: [],
  calendar: [],
  closingMessage: "마무리",
};

const MARKET_DATA: MarketDataCollection = {
  collectedAt: "2026-10-15T07:00:00+09:00", date: "2026-10-15", dayOfWeek: "목",
  koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [],
  forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
};

const ETF_REPORT: MorningReport = {
  cover: { headline: "테스트 제목", subline: "테스트 서브라인" },
  summary: { overseas: "해외 신호", domestic: "국내 상태", focus: "오늘 핵심" },
  assetCards: [],
  todayChecks: [],
  card: { key: "kr-large", line: "마무리" },
};

const ETF_DATA: CollectedData = {
  reportType: "morning", date: "2026-10-15",
  quotes: [{
    ticker: "069500.KS", name: "KODEX 200", market: "KR", price: 100, change: 1, changePercent: 1, volume: 1000,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote],
  flows: [], investorFlows: [],
  macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
  news: [], analysisLens: "",
};

// 렌더러는 escape해서 넣으므로 비교도 escape된 형태로 한다(「」·는 escape 대상이 아님).
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RENDERED: Array<[string, string]> = [
  ["마켓", renderReport(MARKET_CONTENT, MARKET_DATA, [])],
  ["ETF", renderMorningHtml(ETF_REPORT, ETF_DATA)],
];

test("법적 고지: 두 리포트 모두 제목과 7개 항목을 그대로 렌더", () => {
  assert.equal(LEGAL_DISCLAIMER_ITEMS.length, 7);
  for (const [label, html] of RENDERED) {
    assert.ok(html.includes(escape(LEGAL_DISCLAIMER_TITLE)), `${label}: 고지 제목`);
    for (const item of LEGAL_DISCLAIMER_ITEMS) {
      assert.ok(html.includes(`<li>${escape(item)}</li>`), `${label}: ${item.slice(0, 20)}…`);
    }
  }
});

test("법적 고지: 마켓 리포트의 옛 한 줄 고지는 남지 않는다", () => {
  const market = RENDERED[0][1];
  assert.doesNotMatch(market, /class="disclaimer"/);
  assert.doesNotMatch(market, /투자 권유가 아닙니다\. 투자 판단의 책임은/);
});

test("법적 고지: 리포트의 맨 마지막 내용이다(고지 목록 뒤에 보이는 텍스트 없음)", () => {
  for (const [label, html] of RENDERED) {
    const listEnd = html.indexOf("</ul>", html.lastIndexOf('class="legal-list"'));
    assert.ok(listEnd >= 0, `${label}: 고지 목록`);
    const visibleAfter = html.slice(listEnd)
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    assert.equal(visibleAfter, "", `${label}: 고지 뒤 텍스트`);
  }
});

test("법적 고지: 조문 번호를 인용하지 않는다(개정 시 틀린 인용 방지)", () => {
  for (const item of LEGAL_DISCLAIMER_ITEMS) assert.doesNotMatch(item, /제\s*\d+\s*조/);
});
