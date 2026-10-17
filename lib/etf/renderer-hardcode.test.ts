import { test } from "node:test";
import assert from "node:assert/strict";
import { inferEtfTag, renderMorningHtml } from "./renderer";
import { mergeKrxIntoQuotes, type KrxEtfDailyTrade } from "./etf-data";
import type { CollectedData, EtfQuote, MorningReport } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_ETF_UNIVERSE } from "./universe";

const RENDERER_SRC = fs.readFileSync(path.join(__dirname, "renderer.ts"), "utf8");

function quote(ticker: string, name: string, market: "KR" | "US" = ticker.endsWith(".KS") ? "KR" : "US"): EtfQuote {
  return {
    ticker, name, market, price: 100, change: 1, changePercent: 1, volume: 1000,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote;
}

test("inferEtfTag: 유니버스 category 우선 — '금융'·'금리'는 원자재가 아니다", () => {
  const cases: Array<[string, string, string]> = [
    ["139270.KS", "TIGER 200 금융", "섹터"],
    ["456610.KS", "TIGER 미국달러SOFR금리액티브(합성)", "채권"],
    ["132030.KS", "KODEX 골드선물(H)", "원자재"],
    ["261220.KS", "KODEX WTI원유선물(H)", "원자재"],
    ["122630.KS", "KODEX 레버리지", "레버리지"],
    ["252670.KS", "KODEX 200선물인버스2X", "인버스"],
    ["390390.KS", "KODEX 미국반도체", "테마"],
    ["394670.KS", "TIGER 글로벌리튬&2차전지SOLACTIVE(합성)", "테마"],
    ["360750.KS", "TIGER 미국S&P500", "해외지수"],
    ["MTUM", "iShares MSCI USA Momentum ETF", "팩터"],
    ["VNQ", "Vanguard Real Estate ETF", "대안"],
    ["GLD", "SPDR Gold Shares ETF", "원자재"],
  ];
  for (const [ticker, name, expected] of cases) {
    assert.equal(inferEtfTag(quote(ticker, name)), expected, `${ticker} ${name}`);
  }
});

test("inferEtfTag: 유니버스 밖 이름의 '금융'·'금리'는 원자재가 아니다", () => {
  assert.equal(inferEtfTag(quote("999990.KS", "ACME 은행금융")), "지수");
  assert.equal(inferEtfTag(quote("999991.KS", "ACME 금리플러스")), "지수");
  assert.equal(inferEtfTag(quote("999992.KS", "ACME 골드")), "원자재");
});

test("소스 스캔: renderer.ts의 티커 리터럴은 전부 유니버스 구성원", () => {
  const universe = new Set(ALL_ETF_UNIVERSE.map(e => e.ticker));
  const NON_TICKER = new Set(["KR", "US", "NAV", "VIX", "WTI"]);
  const found = new Set<string>();
  for (const m of RENDERER_SRC.matchAll(/['"`]([0-9][0-9A-Z]{5}\.KS)['"`]/g)) found.add(m[1]);
  for (const m of RENDERER_SRC.matchAll(/['"`]([A-Z]{2,5})['"`]/g)) if (!NON_TICKER.has(m[1])) found.add(m[1]);
  const outside = [...found].filter(t => !universe.has(t)).sort();
  assert.deepEqual(outside, []);
});

// 위 스캔은 문자열 전체가 티커인 리터럴만 잡는다. 'SOXX·SMH·국내 반도체' 같은 표시용 메타 속
// 옛 티커는 놓치므로, 이번에 제거한 옛 티커·코드를 단어 경계로 한 번 더 막는다.
test("소스 스캔: 제거한 옛 티커가 복합 문자열에도 남지 않는다", () => {
  assert.doesNotMatch(RENDERER_SRC, /\b(SMH|IVV|SCHD|VIG)\b/);
  assert.doesNotMatch(RENDERER_SRC, /\b(379800|379810|381180|453850|476550|429000|458730|233740|251340|364970)\b/);
});

test("소스 스캔: 자금 흐름·배당 문구와 라벨 오버라이드가 없다", () => {
  assert.doesNotMatch(RENDERER_SRC, /자금이[^.'`]{0,10}(몰|쏠|이동)/);
  assert.doesNotMatch(RENDERER_SRC, /자금\s*유[입출]/);
  assert.doesNotMatch(RENDERER_SRC, /순유[입출]/);
  assert.doesNotMatch(RENDERER_SRC, /배당/);
  assert.doesNotMatch(RENDERER_SRC, /ETF_LABEL_OVERRIDES/);
});

const REPORT: MorningReport = {
  cover: { headline: "테스트 제목", subline: "테스트 서브라인" },
  summary: { overseas: "해외 신호", domestic: "국내 상태", focus: "오늘 핵심" },
  assetCards: [],
  todayChecks: [],
  card: { key: "kr-large", line: "마무리" },
};

function data(quotes: EtfQuote[]): CollectedData {
  return {
    reportType: "morning", date: "2026-10-12", quotes, flows: [], investorFlows: [],
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
    news: [], analysisLens: "",
  };
}

function krx(ticker: string, name: string, changePercent: number, indexChange: number, tradingValue: number): KrxEtfDailyTrade {
  return {
    date: "20261008", ticker, name, close: 100, change: 0, changePercent, nav: 100,
    volume: 5000, tradingValue, marketCap: 1, netAssetTotal: 2,
    underlyingIndexName: "기초지수 " + name, underlyingIndexClose: 250, underlyingIndexChangePercent: indexChange,
    premiumDiscount: 0, dailyIndexGap: changePercent - indexChange,
  };
}

// 병합 결과를 그대로 렌더(시세 이름은 티커, KRX 이름으로 채워짐): 국내 1배 2종, 해외 기초지수 1종, 전술 1종
function mergedQuotes(): EtfQuote[] {
  const rows = [
    krx("069500.KS", "KODEX 200", 1.1, 1.1, 9e11),
    krx("139270.KS", "TIGER 200 금융", 1.5, 1.0, 8e11),
    krx("390390.KS", "KODEX 미국반도체", 1.94, 0, 7e11),        // 해외 기초지수
    krx("122630.KS", "KODEX 레버리지", 2.2, 1.1, 6e11),         // 전술
  ];
  const quotes = rows.map(r => quote(r.ticker, r.ticker));
  return mergeKrxIntoQuotes(quotes, new Map(rows.map(r => [r.ticker, r])), "prev-session");
}

// 2026-10-17 개편: 액션 보드·스캐너·전술 경고 보드·매칭표·이슈 카드·히트맵·거시 코너가 사라지고
// 펼쳐 보기 표(국내·미국 ETF 등락·추정 거래대금)로 바뀌었다. 같은 성질(구분 태그, 코드 표기, 금지 문구)을
// 새 구조에서 다시 확인한다. 레버리지·인버스 평균·세션 혼합 금지는 모자이크(lib/preview/data-card.test.ts)가 맡는다.
function detailsTable(html: string): string {
  const start = html.indexOf('data-section="details"');
  assert.ok(start >= 0, "펼쳐 보기 섹션이 렌더되어야 함");
  return html.slice(start, html.indexOf("</details>", start));
}

function rowWith(tableHtml: string, needle: string): string {
  const row = tableHtml.split("<tr>").find(c => c.includes(needle));
  assert.ok(row, `${needle} 행이 있어야 함`);
  return row;
}

// 태그를 걷어낸 화면 글자(속성값 제외)
function visibleText(html: string): string {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");
}

test("렌더 회귀: 펼쳐 보기 표 구분 — TIGER 200 금융은 섹터, 레버리지·인버스는 그대로 표시, 해외 기초지수는 유니버스 category", () => {
  const table = detailsTable(renderMorningHtml(REPORT, data(mergedQuotes())));
  const finance = rowWith(table, "TIGER 200 금융");
  assert.match(finance, /<td class="tag">섹터<\/td>/);
  assert.doesNotMatch(finance, /원자재/);
  assert.match(rowWith(table, "KODEX 레버리지"), /<td class="tag">레버리지<\/td>/);
  assert.doesNotMatch(table, />전술</);
  assert.match(rowWith(table, "KODEX 미국반도체"), /<td class="tag">테마<\/td>/);
  assert.match(rowWith(table, "KODEX 200<"), /<td class="tag">지수<\/td>/);
});

test("렌더 회귀: 국내 ETF는 6자리 코드로 표기하고 .KS 접미사·배당·자금 쏠림 문구는 화면에 없다", () => {
  const html = renderMorningHtml(REPORT, data(mergedQuotes()));
  const table = detailsTable(html);
  assert.match(rowWith(table, "TIGER 200 금융"), /<span class="rep-code">139270<\/span>/);
  const text = visibleText(html);
  assert.doesNotMatch(text, /[0-9][0-9A-Z]{5}\.KS/);
  assert.doesNotMatch(text, /배당/);
  assert.doesNotMatch(text, /자금이 몰리는/);
});

test("렌더 회귀: 시세 이름이 티커 그대로여도 표·카드는 유니버스 이름을 쓴다", () => {
  const html = renderMorningHtml(REPORT, data([quote("069500.KS", "069500.KS"), quote("SPY", "SPY")]));
  const table = detailsTable(html);
  assert.match(rowWith(table, "069500"), /<span class="rep-name">KODEX 200<\/span>/);
  assert.match(rowWith(table, ">SPY<"), /<span class="rep-name">SPDR S&amp;P 500 ETF<\/span>/);
});

test("렌더 회귀: 시세 이름이 티커 그대로여도 레버리지·인버스 구분은 유니버스 이름으로 판정", () => {
  const table = detailsTable(renderMorningHtml(REPORT, data([quote("252670.KS", "252670.KS"), quote("122630.KS", "122630.KS")])));
  assert.match(rowWith(table, "252670"), /<td class="tag">인버스<\/td>/);
  assert.match(rowWith(table, "122630"), /<td class="tag">레버리지<\/td>/);
});
