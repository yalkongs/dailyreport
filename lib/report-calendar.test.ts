import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportCalendar } from "./report-calendar";

// 11-26 마켓: 미국 캘린더가 빈 날 모델이 "11/27 추수감사절 휴장"을 지어냈다(실제 11/26).
test("미국 캘린더가 비어도 휴장일·한국 일정을 날짜순으로 코드가 만든다(11-26)", () => {
  const rows = buildReportCalendar("2026-11-26", [], [
    { date: "2026-11-26", category: "bok_mpb", name: "한국은행 금통위 기준금리 발표", importance: 5, time: "10:00", confirmed: true },
    { date: "2026-11-30", category: "industrial", name: "산업활동동향", importance: 3, time: "08:00", confirmed: true },
    { date: "2026-12-01", category: "other", name: "추정 일정", importance: 4, confirmed: false },
  ]);
  assert.deepEqual(rows.map((r) => `${r.date} ${r.country} ${r.event}`), [
    "11/26 미국 추수감사절 — 미국 증시 휴장",
    "11/26 한국 한국은행 금통위 기준금리 발표 · 10:00 KST",
    "11/30 한국 산업활동동향 · 08:00 KST",
  ]);
});

test("지난 일정·중요도 3 미만은 빼고, 미국 지표는 한국시간 날짜로", () => {
  const rows = buildReportCalendar("2026-12-01", [
    { date: "2026-11-30", kstDate: "2026-11-30", country: "미국", event: "지난 지표", importance: 5, time: "22:30" },
    { date: "2026-12-01", kstDate: "2026-12-02", country: "미국", event: "ISM", importance: 4, time: "00:00" },
    { date: "2026-12-03", country: "미국", event: "사소한 지표", importance: 2 },
  ], []);
  assert.deepEqual(rows.map((r) => `${r.date} ${r.event}`), ["12/2 ISM · 00:00 KST"]);
});
