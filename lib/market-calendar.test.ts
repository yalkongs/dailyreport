import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketCalendarInfo, isYearCovered } from "./market-calendar";

// 2026 KR 휴장일 — 핫픽스 추가분 포함 전수
const KR_CLOSED_2026 = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
  "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09",
  "2026-12-25", "2026-12-31",
];

test("2026 KR 휴장일은 closed_holiday", () => {
  for (const d of KR_CLOSED_2026) {
    assert.equal(getMarketCalendarInfo(d).krStatus, "closed_holiday", `${d} 휴장이어야 함`);
  }
});

test("2026 정상 영업일은 open", () => {
  // 평일·비휴일: 06-02(화), 06-04(목), 06-05(금)
  for (const d of ["2026-06-02", "2026-06-04", "2026-06-05"]) {
    assert.equal(getMarketCalendarInfo(d).krStatus, "open", `${d} 영업일이어야 함`);
  }
});

test("2026 US 휴장일은 usStatus closed_holiday (예: MLK 01-19)", () => {
  assert.equal(getMarketCalendarInfo("2026-01-19").usStatus, "closed_holiday");
});

test("주말은 closed_weekend (양국)", () => {
  // 2026-06-06 토, 06-07 일
  assert.equal(getMarketCalendarInfo("2026-06-06").krStatus, "closed_weekend");
  assert.equal(getMarketCalendarInfo("2026-06-07").usStatus, "closed_weekend");
});

test("isYearCovered: 2026은 양국 모두 true", () => {
  assert.equal(isYearCovered(2026, "kr"), true);
  assert.equal(isYearCovered(2026, "us"), true);
});

test("isYearCovered: 데이터 없는 연도는 false", () => {
  assert.equal(isYearCovered(2099, "kr"), false);
  assert.equal(isYearCovered(2099, "us"), false);
});
