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

// 2026-10-08: 금요일 휴장 뒤 월요일(예: 10-12, KR 직전 거래일=10-08 목)에 "지난 금요일 종가" 고정 문구가
// 시점 블록("지난 목요일(8일)")과 충돌했다. 날짜 단정은 시점 블록 단일 소스로 넘긴다.
test("market 월요일 리듬은 직전 세션 요일을 단정하지 않는다(시점 블록에 위임)", () => {
  const block = describeWeekdayRhythm("monday_setup", "market");
  assert.doesNotMatch(block, /금요일/);
  assert.match(block, /\[시점 기준\] 블록의 직전 거래일 종가/);
  assert.match(block, /주말·휴일 사이/);
});
