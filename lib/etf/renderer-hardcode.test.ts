import { test } from "node:test";
import assert from "node:assert/strict";
import { inferEtfTag } from "./renderer";
import type { EtfQuote } from "./types";

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
  assert.notEqual(inferEtfTag(quote("999990.KS", "ACME 은행금융")), "원자재");
  assert.notEqual(inferEtfTag(quote("999991.KS", "ACME 금리플러스")), "원자재");
  assert.equal(inferEtfTag(quote("999992.KS", "ACME 골드")), "원자재");
});
