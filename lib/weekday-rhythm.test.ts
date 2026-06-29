import { test } from "node:test";
import assert from "node:assert/strict";
import { describeWeekdayRhythm, getWeekdayRole } from "./weekday-rhythm";

test("월요일 market 리듬: 주말뉴스를 '오늘 원인'이 아니라 '개장 시 변수'로", () => {
  const block = describeWeekdayRhythm("monday_setup", "market");
  assert.match(block, /개장 시|관전 포인트|이번 주/);   // 전방위 프레이밍
  assert.doesNotMatch(block, /주말 뒤 시작/);            // 옛 인과 유도 제거
});

test("월요일 etf 리듬: overnight 설계와 정합 — 현행 유지(주말 해외 흐름)", () => {
  const block = describeWeekdayRhythm("monday_setup", "etf");
  assert.match(block, /주말/);
});

test("getWeekdayRole: 2026-06-29는 monday_setup", () => {
  assert.equal(getWeekdayRole("2026-06-29"), "monday_setup");
});
