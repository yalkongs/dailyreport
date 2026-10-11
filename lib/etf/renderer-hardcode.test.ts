import { test } from "node:test";
import assert from "node:assert/strict";
import { inferEtfTag } from "./renderer";
import type { EtfQuote } from "./types";
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
  assert.notEqual(inferEtfTag(quote("999990.KS", "ACME 은행금융")), "원자재");
  assert.notEqual(inferEtfTag(quote("999991.KS", "ACME 금리플러스")), "원자재");
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
