// lib/release-time.test.ts
// C03 (2026-10-16 감사): 미국 지표 발표 시각을 한국시간으로 바꾸고 한국 정규장과의 관계를 붙인다.
// (10/14 CPI 08:30 ET = 한국시간 21:30 — ETF가 '오늘 국내 장중 방향을 뒤집는다'고 썼다.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { etToKst, describeKrSession } from "./release-time";

test("ET → KST: 서머타임(EDT) 기간 08:30 ET = 같은 날 21:30 KST", () => {
  assert.deepEqual(etToKst("2026-10-14", "08:30"), { date: "2026-10-14", time: "21:30" });
});

test("ET → KST: 표준시(EST) 기간 08:30 ET = 같은 날 22:30 KST", () => {
  assert.deepEqual(etToKst("2026-11-10", "08:30"), { date: "2026-11-10", time: "22:30" });
});

test("ET → KST: FOMC 14:00 ET는 한국시간 다음 날 새벽", () => {
  assert.deepEqual(etToKst("2026-10-28", "14:00"), { date: "2026-10-29", time: "03:00" });
});

test("한국 정규장 기준 시점 설명", () => {
  assert.equal(describeKrSession("21:30"), "한국 장 마감 후 발표 — 국내 반영은 다음 거래일");
  assert.equal(describeKrSession("03:00"), "한국 개장 전 발표");
  assert.equal(describeKrSession("10:00"), "한국 장중 발표");
  assert.equal(describeKrSession("08:00"), "한국 개장 전 발표");
});

test("ETF 프롬프트: 미국 지표 일정을 한국시간·장 마감 후 표시와 함께 준다", async () => {
  const { buildUsEventsBlock } = await import("./etf/claude-client");
  const block = buildUsEventsBlock([
    { date: "2026-10-14", time: "21:30", kstDate: "2026-10-14", country: "US", event: "Consumer Price Index", importance: 5 },
    { date: "2026-10-20", time: "21:30", kstDate: "2026-10-20", country: "US", event: "Housing Starts", importance: 3 },
  ], "2026-10-14");
  assert.match(block, /\[US\] Consumer Price Index — 10\/14 21:30 KST · 한국 장 마감 후 발표 — 국내 반영은 다음 거래일/);
  assert.doesNotMatch(block, /Housing Starts/); // 오늘~+2일만
  assert.equal(buildUsEventsBlock([], "2026-10-14"), "");
});
