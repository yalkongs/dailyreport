import { test } from "node:test";
import assert from "node:assert/strict";
import { selectStoryCharacters } from "./story-characters";
import type { EtfQuote } from "./types";

function krQuote(ticker: string, name: string, changePercent: number | null = 1): EtfQuote {
  return {
    ticker,
    name,
    market: "KR",
    price: 10000,
    change: 100,
    changePercent,
    volume: 1000,
    aum: null,
    nav: null,
    premiumDiscount: null,
    trackingError: null,
    prev20AvgVolume: null,
  };
}

// 7/21 실사례를 본뜬 유니버스: 반도체 primary, 나스닥100 gate 우선, 국채 alternative, 레버리지 warning.
const QUOTES: EtfQuote[] = [
  krQuote("091160.KS", "KODEX 반도체", 2.1),
  krQuote("133690.KS", "TIGER 미국나스닥100", 0.8),
  krQuote("360750.KS", "TIGER 미국S&P500", 0.7),
  krQuote("114820.KS", "TIGER 국채3년", 0.1),
  krQuote("182480.KS", "TIGER 미국MSCI리츠", 0.3),
  krQuote("122630.KS", "KODEX 레버리지", 3.5),
];

test("selectStoryCharacters: 슬롯 배정이 렌더러 규칙과 일치", () => {
  const c = selectStoryCharacters(QUOTES);
  assert.equal(c.primary?.name, "KODEX 반도체");
  assert.equal(c.gate?.name, "TIGER 미국나스닥100"); // 나스닥100 우선
  assert.equal(c.alternative?.name, "TIGER 국채3년"); // 국채 우선
  assert.equal(c.warning?.name, "KODEX 레버리지"); // 레버리지 우선
});

// 2026-10-17 출력 스키마 개편: Characters 산문이 사라져 카드-산문 정합 검사(checkCharacterProseConsistency)와
// 그 테스트 5건을 제거했다. 남아 있는 선택 로직(selectStoryCharacters)의 결정론은 계속 검사한다.
test("selectStoryCharacters: 영문이 섞인 신형 코드(0098F0)도 주인공으로 고른다", () => {
  const quotes = [krQuote("0098F0.KS", "KODEX 원자력SMR", 5.0), ...QUOTES.slice(1)];
  const cards = selectStoryCharacters(quotes);
  assert.equal(cards.primary?.ticker, "0098F0.KS");
});
