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
    ["122630.KS", "KODEX 레버리지", "전술"],
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

const REPORT = {
  cover: { headline: "테스트 제목", subline: "테스트 서브라인" },
  overnightBrief: { narrative: "간밤 요약", krImpact: "국내 영향" },
  usEtfHighlights: { topMover: { ticker: "SPY", reason: "r" }, bottomMover: { ticker: "SPY", reason: "r" }, sectorNarrative: "섹터" },
  todayWatch: { items: [] },
  closingLine: "마무리",
} as MorningReport;

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

// 병합 결과를 그대로 렌더: 국내 1배 2종(하나는 gap 정확히 0), 해외 기초지수 1종, 전술 1종
function mergedQuotes(): EtfQuote[] {
  const rows = [
    krx("069500.KS", "KODEX 200", 1.1, 1.1, 9e11),            // gap 0 — 표시되어야 함
    krx("139270.KS", "TIGER 200 금융", 1.5, 1.0, 8e11),        // gap 0.5
    krx("390390.KS", "KODEX 미국반도체", 1.94, 0, 7e11),        // 해외 기초지수 — 지수대비 없음
    krx("122630.KS", "KODEX 레버리지", 2.2, 1.1, 6e11),         // 전술 — 지수대비 없음
  ];
  const quotes = rows.map(r => quote(r.ticker, r.ticker));
  return mergeKrxIntoQuotes(quotes, new Map(rows.map(r => [r.ticker, r])), "prev-session");
}

// 섹션 제목부터 다음 섹션 시작 전까지. 섹션 단위로 잘라야 다른 섹션(전략 지도 등)의
// 정상 라벨 때문에 단언이 잘못 통과하지 않는다.
function section(html: string, title: string): string {
  const start = html.indexOf(`<div class="section-title">${title}`);
  assert.ok(start >= 0, `${title} 섹션이 렌더되어야 함`);
  const end = html.indexOf('<div class="section">', start);
  return html.slice(start, end < 0 ? undefined : end);
}

// 같은 섹션 안에서 특정 종목이 들어간 카드/행 하나
function chunkWith(sectionHtml: string, splitter: string, needle: string): string {
  const chunk = sectionHtml.split(splitter).find(c => c.includes(needle));
  assert.ok(chunk, `${needle} 항목이 있어야 함`);
  return chunk;
}

test("렌더 회귀: 액션 보드 지수대비 패널은 국내 1배만, gap 0은 0.00%p로 표시", () => {
  const board = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Domestic ETF Action Board");
  const gapPanel = board.slice(board.indexOf("기초지수 대비"));
  assert.match(gapPanel, /KODEX 200/);
  const kodex200 = chunkWith(gapPanel, '<div class="compact-etf-row">', "(069500)");
  assert.match(kodex200, /0\.00%p/);
  assert.match(gapPanel, /TIGER 200 금융/);
  assert.doesNotMatch(gapPanel, /KODEX 미국반도체/);
});

test("렌더 회귀: 일반 카드 — 해외 기초지수는 지수대비 없음, 금융은 섹터 태그·지수대비 유지", () => {
  const scanner = section(renderMorningHtml(REPORT, data(mergedQuotes())), "KR ETF Market Scanner");
  const foreign = chunkWith(scanner, '<div class="etf-card">', "KODEX 미국반도체");
  assert.doesNotMatch(foreign, /지수대비/);
  const kodex200 = chunkWith(scanner, '<div class="etf-card">', "KODEX 200");
  assert.match(kodex200, /\(069500\)/);
  assert.match(kodex200, /지수대비/);
  assert.match(kodex200, /0\.00%p/);
  const finance = chunkWith(scanner, '<div class="etf-card">', "TIGER 200 금융");
  assert.match(finance, /<span class="etf-tag">섹터<\/span>/);
  assert.doesNotMatch(finance, /원자재/);
  assert.match(finance, /지수대비/);
});

test("렌더 회귀: 전술 경고 보드 — 레버리지 행에 지수대비 없음", () => {
  const tactical = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Tactical ETF Warning Board");
  assert.match(tactical, /KODEX 레버리지/);
  assert.doesNotMatch(tactical, /지수대비/);
});

test("렌더 회귀: 액션 보드 행 태그 — TIGER 200 금융은 섹터", () => {
  const board = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Domestic ETF Action Board");
  const row = chunkWith(board, '<div class="compact-etf-row">', "TIGER 200 금융");
  assert.match(row, /<span class="etf-tag">섹터<\/span>/);
  assert.doesNotMatch(row, /원자재/);
});

test("렌더 회귀: 그룹 시세가 없으면 매칭표·이슈 카드 폴백이 유니버스 이름을 쓴다", () => {
  const html = renderMorningHtml(REPORT, data([quote("069500.KS", "KODEX 200")]));
  const matching = section(html, "상세 글로벌-KR ETF 매칭");
  assert.match(matching, />SOXX iShares Semiconductor ETF<\/a>/);
  assert.match(matching, />TIGER 미국30년국채스트립액티브\(합성 H\) \(458250\)<\/a>/);
  assert.doesNotMatch(matching, />SOXX<\/a>/);
  const issues = section(html, "오늘 이슈별 관찰 ETF");
  assert.match(issues, />SOXX iShares Semiconductor ETF<\/a>/);
  assert.match(issues, />TIGER 미국30년국채스트립액티브\(합성 H\) \(458250\)<\/a>/);
  assert.doesNotMatch(issues, />(SOXX|458250|458250\.KS)<\/a>/);
  assert.doesNotMatch(html, /[0-9][0-9A-Z]{5}\.KS/);
  assert.doesNotMatch(html, /배당/);
  assert.doesNotMatch(html, /자금이 몰리는/);
});
