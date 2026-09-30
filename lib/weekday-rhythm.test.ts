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

test("etf 월·금 리듬에는 헤드라인 지시가 없다(묶음 3) — 본문 지시는 유지", () => {
  const mon = describeWeekdayRhythm("monday_setup", "etf");
  const fri = describeWeekdayRhythm("friday_recap", "etf");
  assert.doesNotMatch(mon, /헤드라인/);
  assert.doesNotMatch(fri, /헤드라인/);
  assert.doesNotMatch(fri, /X요일/);
  assert.match(mon, /bigPicture/);
  assert.match(fri, /closingLine/);
});

test("market 금요일 리듬은 헤드라인 톤 지시를 유지한다", () => {
  assert.match(describeWeekdayRhythm("friday_recap", "market"), /한 주를 닫는/);
});
