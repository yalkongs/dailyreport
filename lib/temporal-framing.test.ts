import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketCalendarInfo } from "./market-calendar";
import { buildTemporalFramingBlock } from "./temporal-framing";

test("market 월요일 블록: 지난 금요일 명시 + '오늘 마감' 금지 문구", () => {
  const info = getMarketCalendarInfo("2026-06-29"); // 월
  const block = buildTemporalFramingBlock(info, "market");
  assert.match(block, /개장 전/);
  assert.match(block, /지난 금요일/);
  assert.match(block, /오늘 코스피/);      // "...라고 쓰지 말 것" 금지 지시 포함
  assert.match(block, /비거래일/);          // 갭>1 안내
});

test("market 화요일 블록: 전 거래일/간밤, 갭 경고 없음", () => {
  const info = getMarketCalendarInfo("2026-06-30"); // 화
  const block = buildTemporalFramingBlock(info, "market");
  assert.match(block, /전 거래일/);
  assert.match(block, /간밤/);
  assert.doesNotMatch(block, /비거래일/);
});

test("etf 변형은 경량 — KR 단정 가드는 생략(베이스라인 보유)", () => {
  const info = getMarketCalendarInfo("2026-06-29");
  const block = buildTemporalFramingBlock(info, "etf");
  assert.match(block, /지난 금요일/);       // 갭 보강은 포함
  assert.doesNotMatch(block, /오늘 코스피/); // market 전용 KR 가드는 미포함
});
