// M6 (Ruling 26): 고정 UI 라벨의 "어제" — 월요일·휴장 다음 날에는 사실이 아니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previousSessionLabel, usPreviousSessionNote } from "./session-label";

test("previousSessionLabel: 직전 한국 거래일이 바로 전날이면 '어제'", () => {
  assert.equal(previousSessionLabel("2026-10-20"), "어제"); // 화 → 월
  assert.equal(previousSessionLabel("2026-10-16"), "어제"); // 금 → 목
});

test("previousSessionLabel: 월요일이고 직전 거래일이 그 주 금요일이면 '지난 금요일'", () => {
  assert.equal(previousSessionLabel("2026-10-19"), "지난 금요일"); // 개편 첫날
});

test("previousSessionLabel: 휴장을 건너뛰면 '직전 거래일' (KR 휴일 달력 사용)", () => {
  assert.equal(previousSessionLabel("2026-10-12"), "직전 거래일"); // 월, 10-09(금) 한글날 → 직전 거래일 10-08(목)
  assert.equal(previousSessionLabel("2026-10-06"), "직전 거래일"); // 화, 10-05(월) 개천절 대체공휴일 → 10-02(금)
  assert.equal(previousSessionLabel("2026-08-18"), "직전 거래일"); // 화, 08-17 광복절 대체공휴일 → 08-14(금)
});

// Ruling 40 (2026-10-20): ETF Today의 미국 ETF 숫자는 미국 직전 거래일 종가다. 미국 직전 거래일이 한국과 다른 날만
// 그 날짜를 밝힌다(미국 휴일 달력 — market-calendar). 같은 날은 null(화면은 오늘과 같다).
test("usPreviousSessionNote: 미국 직전 거래일이 한국과 다르면 '미국은 M/D(요일) 종가'", () => {
  assert.equal(usPreviousSessionNote("2026-11-27"), "미국은 11/25(수) 종가"); // 금, 한국 직전 11-26(목) · 미국은 11-26 추수감사절 휴장
  assert.equal(usPreviousSessionNote("2026-01-20"), "미국은 1/16(금) 종가"); // 화, 한국 직전 01-19(월) · 미국은 01-19 MLK 휴장
  assert.equal(usPreviousSessionNote("2026-10-12"), "미국은 10/9(금) 종가"); // 월, 한국만 10-09 한글날 휴장 → 한국 직전 10-08(목)
});

test("usPreviousSessionNote: 같은 날이면 null — 평일·월요일·미국 휴일 당일 아침", () => {
  assert.equal(usPreviousSessionNote("2026-10-20"), null); // 화, 양국 모두 10-19(월)
  assert.equal(usPreviousSessionNote("2026-10-19"), null); // 월, 양국 모두 10-16(금)
  assert.equal(usPreviousSessionNote("2026-11-26"), null); // 목, 양국 모두 11-25(수) — 미국 추수감사절 장은 아직 열리지 않았다
});
