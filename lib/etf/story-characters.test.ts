import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectStoryCharacters,
  checkCharacterProseConsistency,
} from "./story-characters";
import type { EtfQuote, MorningReport } from "./types";

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

function reportWithCharacters(chars: MorningReport["narrativeNotes"]): MorningReport {
  return { narrativeNotes: chars } as unknown as MorningReport;
}

test("일치 검출: 산문이 카드 ETF명을 담으면 통과(위반 없음)", () => {
  const report = reportWithCharacters({
    characters: {
      primary: "KODEX 반도체(091160)가 오늘의 주인공입니다.",
      gate: "TIGER 미국나스닥100(133690)은 환율 게이트입니다.",
      alternative: "TIGER 국채3년(114820)은 대안입니다.",
      warning: "KODEX 레버리지(122630)는 과열 경계 대상입니다.",
    },
  } as MorningReport["narrativeNotes"]);
  const violations = checkCharacterProseConsistency(report, QUOTES);
  assert.equal(violations.length, 0);
});

test("불일치 검출: 카드 나스닥100 ↔ 산문 S&P500 (7/21 실사례)", () => {
  const report = reportWithCharacters({
    characters: {
      primary: "KODEX 반도체(091160)가 오늘의 주인공입니다.",
      gate: "TIGER 미국S&P500(360750)은 환율 게이트입니다.", // 카드는 나스닥100인데 산문은 S&P500
      alternative: "TIGER 미국MSCI리츠(182480)는 대안입니다.", // 카드는 국채인데 산문은 리츠
      warning: "KODEX 레버리지(122630)는 경계 대상입니다.",
    },
  } as MorningReport["narrativeNotes"]);
  const violations = checkCharacterProseConsistency(report, QUOTES);
  assert.equal(violations.length, 2);
});

test("6자리 코드만 있어도 통과(공백 변형 흡수)", () => {
  const report = reportWithCharacters({
    characters: {
      primary: "091160 종목이 강세입니다.", // 코드만
      gate: "TIGER미국나스닥100 흐름을 봅니다.", // 공백 제거된 이름
    },
  } as MorningReport["narrativeNotes"]);
  const violations = checkCharacterProseConsistency(report, QUOTES);
  assert.equal(violations.length, 0);
});

test("narrativeNotes 없으면 검사 skip (Tier 1 fallback 경로)", () => {
  const report = { narrativeNotes: undefined } as unknown as MorningReport;
  const violations = checkCharacterProseConsistency(report, QUOTES);
  assert.equal(violations.length, 0);
});
