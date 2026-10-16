// lib/kr-macro-calendar.test.ts
// C03 (2026-10-16 감사): 추정 일정이 '(오늘)' 표시로 확정 당일 변수로 승격되던 문제.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatKrMacroEventLine, isEstimatedKrMacroEvent, type KrMacroEvent } from "./kr-macro-calendar";

const OLD_CACHE_ESTIMATED: KrMacroEvent = {
  date: "2026-10-15", category: "employment", name: "통계청 2026년 9월 고용동향 발표", importance: 4,
  description: "e-나라지표 '일반고용동향' 입력예정일 2026-10-16 기재. 통계청 공표 관행상 매 익월 중순 수요일 발표. 해당 주 발표 추정.",
};

test("옛 캐시의 추정 일정: '(오늘)' 없이 [발표일 추정] 표시", () => {
  assert.equal(isEstimatedKrMacroEvent(OLD_CACHE_ESTIMATED), true);
  const line = formatKrMacroEventLine(OLD_CACHE_ESTIMATED, "2026-10-15");
  assert.doesNotMatch(line, /\(오늘\)/);
  assert.match(line, /\[발표일 추정 — 확정 아님\]/);
  assert.match(line, /^10\/15\(목\)/);
});

test("확정 일정: 오늘이면 '(오늘)'과 발표 시각", () => {
  const e: KrMacroEvent = { date: "2026-10-16", category: "employment", name: "9월 고용동향", importance: 4, confirmed: true, time: "08:00" };
  assert.equal(isEstimatedKrMacroEvent(e), false);
  assert.match(formatKrMacroEventLine(e, "2026-10-16"), /^10\/16\(금\) ★★★★☆ 9월 고용동향 \(오늘\) 08:00 KST/);
});

test("confirmed:false 는 설명과 무관하게 추정", () => {
  assert.equal(isEstimatedKrMacroEvent({ date: "2026-10-22", category: "bok_mpb", name: "금통위", importance: 5, confirmed: false }), true);
});

test("요일 교정: '10월 22일(수)'·'10월 22일 수요일' 형식도 실제 요일(목)로", async () => {
  const { checkAndFixTemporal } = await import("./temporal-consistency");
  const r = checkAndFixTemporal("다음 주 가장 중요한 이벤트는 10월 22일(수) 한국은행 금통위입니다. 10월 22일 수요일 회의.", "2026-10-16");
  assert.equal(r.fixed, "다음 주 가장 중요한 이벤트는 10월 22일(목) 한국은행 금통위입니다. 10월 22일 목요일 회의.");
  assert.equal(r.softFixes.length, 2);
  // 일요일 교정에서 '22일'의 '일'을 건드리지 않는다
  assert.equal(checkAndFixTemporal("10월 25일(토)", "2026-10-16").fixed, "10월 25일(일)");
  // 맞는 요일은 그대로
  assert.equal(checkAndFixTemporal("10월 22일(목)", "2026-10-16").softFixes.length, 0);
});
