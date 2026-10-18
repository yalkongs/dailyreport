// M6 (Ruling 26): 고정 UI 라벨의 "어제" — 월요일·휴장 다음 날에는 사실이 아니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previousSessionLabel } from "./session-label";

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
