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

// 캘린더 B (2026-06-30): US 단독 휴장 시에도 시점 블록이 KR 개장 전 가드를 유지.
test("market US단독휴장(MLK 월 2026-01-19): KR 개장 전 가드 + US 휴장 맥락 동시", () => {
  const info = getMarketCalendarInfo("2026-01-19"); // 월, MLK(US 휴장)·KR 개장
  assert.equal(info.isUsClosedOnly, true);
  const block = buildTemporalFramingBlock(info, "market");
  assert.match(block, /오늘 밤 새 미국 세션이 없습니다/);  // US 휴일 맥락 흡수
  assert.match(block, /지난 금요일\(2026-01-16\)/);        // KR 데이터 갭 인지(월요일)
  assert.match(block, /오늘 코스피/);                       // KR 개장 전 단정 금지 (잔여 핵심)
});

test("market 정상일(화 06-30)은 US 휴장 맥락 미포함(회귀 가드)", () => {
  const info = getMarketCalendarInfo("2026-06-30");
  const block = buildTemporalFramingBlock(info, "market");
  assert.doesNotMatch(block, /오늘 밤 새 미국 세션이 없습니다/);
});

test("etf US단독휴장: US 휴장 맥락 포함", () => {
  const info = getMarketCalendarInfo("2026-01-19");
  const block = buildTemporalFramingBlock(info, "etf");
  assert.match(block, /미국 세션이 없습니다/);
});

// 캘린더 C (2026-06-30): 24h 상품(환율·원자재·암호화폐)은 종가 아닌 실시간 시세.
test("market: 24h 상품 실시간 안내 + 원/달러를 한국 지수 종가로 안 묶음", () => {
  const block = buildTemporalFramingBlock(getMarketCalendarInfo("2026-06-30"), "market");
  assert.match(block, /24시간/);                 // 24h 상품 실시간 안내
  assert.match(block, /실시간 시세/);
  assert.doesNotMatch(block, /원\/달러 등/);      // 원/달러를 종가 목록에서 제외
});

test("etf: 24h 상품 실시간 안내 포함", () => {
  const block = buildTemporalFramingBlock(getMarketCalendarInfo("2026-06-30"), "etf");
  assert.match(block, /24시간|실시간 시세/);
});
