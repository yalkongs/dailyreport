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

// 2026-10-31: 웹 검색 캐시가 10월 CPI를 11/2(confirmed:true)로 저장 — 공식 보도계획은 11/3(화).
test("공식 보도계획: 검색 결과의 CPI 날짜를 공식 일정으로 교체", async () => {
  const { applyKostatOfficialPlan } = await import("./kr-macro-calendar");
  const searched: KrMacroEvent[] = [
    { date: "2026-11-02", category: "cpi", name: "한국 소비자물가지수(CPI) 발표 — 2026년 10월", importance: 5, confirmed: true },
    { date: "2026-11-02", category: "trade", name: "수출입 동향 발표 — 2026년 10월", importance: 3, confirmed: true },
    { date: "2026-11-05", category: "other", name: "소비자물가 관련 설명", importance: 2 },
  ];
  const out = applyKostatOfficialPlan(searched, "2026-11-01", "2026-11-15");
  assert.deepEqual(out.map((e) => [e.date, e.category]), [
    ["2026-11-02", "trade"],
    ["2026-11-03", "cpi"],
    ["2026-11-11", "employment"],
  ]);
  const cpi = out.find((e) => e.category === "cpi")!;
  assert.equal(cpi.confirmed, true);
  assert.equal(cpi.time, "08:00");
  assert.match(cpi.name, /소비자물가동향 발표 — 2026년 10월/);
});

test("공식 보도계획: 범위 밖 공식 일정은 넣지 않는다", async () => {
  const { applyKostatOfficialPlan } = await import("./kr-macro-calendar");
  assert.deepEqual(applyKostatOfficialPlan([], "2026-11-04", "2026-11-10"), []);
});

test("공식 보도계획: 해외 지표·다른 국내 통계는 카테고리가 겹쳐도 남긴다", async () => {
  const { applyKostatOfficialPlan } = await import("./kr-macro-calendar");
  const others: KrMacroEvent[] = [
    { date: "2026-11-06", category: "employment", name: "미국 고용보고서(비농업 고용·실업률) 발표", importance: 3 },
    { date: "2026-11-12", category: "cpi", name: "미국 소비자물가지수(CPI) 발표", importance: 4 },
    { date: "2026-11-24", category: "other", name: "한국은행 소비자동향조사", importance: 2 },
    { date: "2026-11-25", category: "employment", name: "사업체노동력조사 발표", importance: 2 },
  ];
  const out = applyKostatOfficialPlan(others, "2026-11-04", "2026-11-10");
  assert.deepEqual(out.map((e) => e.name), others.map((e) => e.name));
});

test("공식 보도계획: 연도 경계 — 대상 월이 표에 있으면 다음 해 날짜의 검색 결과도 교체, 없으면 유지", async () => {
  const { applyKostatOfficialPlan } = await import("./kr-macro-calendar");
  const searched: KrMacroEvent[] = [
    { date: "2027-01-05", category: "cpi", name: "2026년 12월 소비자물가동향", importance: 5, confirmed: true },
    { date: "2027-01-13", category: "employment", name: "2026년 12월 및 연간 고용동향", importance: 4, confirmed: true },
  ];
  const out = applyKostatOfficialPlan(searched, "2026-12-28", "2027-01-15");
  assert.deepEqual(out.map((e) => [e.date, e.category]), [
    ["2026-12-30", "industrial"],
    ["2026-12-31", "cpi"],
    ["2027-01-13", "employment"],
  ]);
});
