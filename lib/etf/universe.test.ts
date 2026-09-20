import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_ETF_UNIVERSE, KR_ETF_UNIVERSE } from "./universe";
import { googleFinanceQuoteUrl } from "./etf-links";

// 2026-09-20 거래소 상장 ETF 목록과 전수 대조해 확정한 국내 코드→상품명.
// 04-18 흡수 시점부터 50종 중 35종의 코드가 다른 상품을 가리키고 있었다(예: '364970'은
// TIGER 바이오TOP10인데 'TIGER KRX반도체'로 등록 → 반도체 전략 그룹에 바이오 ETF).
// 코드를 바꿀 때는 반드시 실제 상장 목록으로 확인한 뒤 이 표도 함께 갱신할 것.
const VERIFIED_KR: Record<string, string> = {
  "069500.KS": "KODEX 200",
  "229200.KS": "KODEX 코스닥150",
  "278540.KS": "KODEX MSCI Korea TR",
  "102110.KS": "TIGER 200",
  "252670.KS": "KODEX 200선물인버스2X",
  "122630.KS": "KODEX 레버리지",
  "292190.KS": "KODEX KRX300",
  "091160.KS": "KODEX 반도체",
  "091170.KS": "KODEX 은행",
  "091180.KS": "KODEX 자동차",
  "305720.KS": "KODEX 2차전지산업",
  "266420.KS": "KODEX 헬스케어",
  "117460.KS": "KODEX 에너지화학",
  "157490.KS": "TIGER 소프트웨어",
  "228810.KS": "TIGER 미디어컨텐츠",
  "305540.KS": "TIGER 2차전지테마",
  "396500.KS": "TIGER 반도체TOP10",
  "139260.KS": "TIGER 200 IT",
  "139220.KS": "TIGER 200 건설",
  "139250.KS": "TIGER 200 에너지화학",
  "139270.KS": "TIGER 200 금융",
  "449450.KS": "PLUS K방산",
  "139240.KS": "TIGER 200 철강소재",
  "227560.KS": "TIGER 200 생활소비재",
  "139230.KS": "TIGER 200 중공업",
  "365040.KS": "TIGER AI코리아그로스액티브",
  "445290.KS": "KODEX 로봇액티브",
  "329200.KS": "TIGER 리츠부동산인프라",
  "394670.KS": "TIGER 글로벌리튬&2차전지SOLACTIVE(합성)",
  "494670.KS": "TIGER 조선TOP10",
  "390390.KS": "KODEX 미국반도체",
  "300610.KS": "TIGER K게임",
  "0098F0.KS": "KODEX 원자력SMR",
  "471760.KS": "TIGER AI반도체핵심공정",
  "463250.KS": "TIGER K방산&우주",
  "114260.KS": "KODEX 국고채3년",
  "148070.KS": "KIWOOM 국고채10년",
  "157450.KS": "TIGER 단기통안채",
  "305080.KS": "TIGER 미국채10년선물",
  "114820.KS": "TIGER 국채3년",
  "132030.KS": "KODEX 골드선물(H)",
  "261220.KS": "KODEX WTI원유선물(H)",
  "329750.KS": "TIGER 미국달러단기채권액티브",
  "456610.KS": "TIGER 미국달러SOFR금리액티브(합성)",
  "458250.KS": "TIGER 미국30년국채스트립액티브(합성 H)",
  "360750.KS": "TIGER 미국S&P500",
  "133690.KS": "TIGER 미국나스닥100",
  "195930.KS": "TIGER 유로스탁스50(합성 H)",
  "099140.KS": "KODEX 차이나H",
  "241180.KS": "TIGER 일본니케이225",
};

test("국내 유니버스의 코드·상품명이 검증된 상장 목록과 일치한다", () => {
  const actual = Object.fromEntries(KR_ETF_UNIVERSE.map((e) => [e.ticker, e.name]));
  assert.deepEqual(actual, VERIFIED_KR);
});

test("유니버스에 중복 티커가 없다", () => {
  const tickers = ALL_ETF_UNIVERSE.map((e) => e.ticker);
  assert.equal(new Set(tickers).size, tickers.length);
});

test("국내 티커는 6자리 단축코드(.KS) 형식이다 — 신형 코드는 영문을 포함한다", () => {
  for (const e of KR_ETF_UNIVERSE) {
    assert.match(e.ticker, /^[0-9][0-9A-Z]{5}\.KS$/, e.ticker);
  }
});

test("전략 그룹에 고정된 국내 코드는 모두 유니버스에 있고 그룹의 성격과 맞는다", () => {
  const src = fs.readFileSync(path.join(__dirname, "morning-strategy.ts"), "utf8");
  const hardcoded = [...new Set([...src.matchAll(/'([0-9][0-9A-Z]{5}\.KS)'/g)].map((m) => m[1]))];
  assert.ok(hardcoded.length > 0, "morning-strategy.ts에서 국내 코드를 찾지 못했습니다");
  const known = new Set(KR_ETF_UNIVERSE.map((e) => e.ticker));
  for (const t of hardcoded) assert.ok(known.has(t), `유니버스에 없는 코드: ${t}`);

  const groupLine = (needle: string) => src.split("\n").find((l) => l.includes("tickers:") && l.includes(needle)) ?? "";
  assert.match(groupLine("'SOXX'"), /'396500\.KS'/, "반도체 그룹은 TIGER 반도체TOP10(396500)을 써야 한다");
  assert.match(groupLine("'TLT'"), /'114260\.KS'/, "채권 그룹은 KODEX 국고채3년(114260)을 써야 한다");
  assert.match(groupLine("'USO'"), /'261220\.KS'/, "원자재 그룹은 KODEX WTI원유선물(H)(261220)을 써야 한다");
  assert.match(groupLine("'360750.KS'"), /'390390\.KS'/, "해외지수 그룹은 KODEX 미국반도체(390390)를 써야 한다");
});

test("영문이 섞인 신형 코드도 Google Finance 링크가 만들어진다", () => {
  assert.equal(googleFinanceQuoteUrl("0098F0.KS")?.includes("/0098F0:KRX"), true);
  assert.equal(googleFinanceQuoteUrl("069500.KS")?.includes("/069500:KRX"), true);
});
