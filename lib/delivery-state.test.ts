import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_TRACKING_SINCE,
  statusContext,
  reportCommitPrefix,
  kstDayStartIso,
  findReportCommit,
  pickTelegramStatus,
  decideDelivery,
  classifyTelegramResponse,
  formatAnomalyBreakdown,
} from "./delivery-state";

const DATE = "2026-09-22";
const base = { date: DATE, reportSha: "abc123", justGenerated: false, forceResend: false, dryRun: false };

test("status context와 커밋 메시지 접두어", () => {
  assert.equal(statusContext("market"), "telegram/market");
  assert.equal(statusContext("etf"), "telegram/etf");
  assert.equal(reportCommitPrefix("market", DATE), "Daily Market Report - 2026-09-22 (KST)");
  assert.equal(reportCommitPrefix("etf", DATE), "ETF Daily Report - 2026-09-22 (KST)");
  assert.equal(kstDayStartIso(DATE), "2026-09-22T00:00:00+09:00");
});

test("findReportCommit: 종류·날짜가 맞는 커밋만 고른다", () => {
  const commits = [
    { sha: "e1", message: "ETF Daily Report - 2026-09-22 (KST)" },
    { sha: "m1", message: "Daily Market Report - 2026-09-22 (KST)\n\nbody" },
    { sha: "x1", message: "Merge branch 'feat/x'" },
    { sha: "m0", message: "Daily Market Report - 2026-09-21 (KST)" },
  ];
  assert.equal(findReportCommit(commits, "market", DATE), "m1");
  assert.equal(findReportCommit(commits, "etf", DATE), "e1");
  assert.equal(findReportCommit(commits, "market", "2026-09-23"), null);
});

test("pickTelegramStatus: 해당 context의 상태만, 없으면 null, 모르는 값은 error 취급", () => {
  const statuses = [
    { context: "Vercel", state: "success" },
    { context: "telegram/etf", state: "failure" },
  ];
  assert.equal(pickTelegramStatus(statuses, "etf"), "failure");
  assert.equal(pickTelegramStatus(statuses, "market"), null);
  assert.equal(pickTelegramStatus([{ context: "telegram/market", state: "weird" }], "market"), "error");
});

test("decideDelivery: status 없음·failure → send", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: null }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: "failure" }).action, "send");
});

test("decideDelivery: success → skip (이미 발송된 리포트는 절대 다시 보내지 않는다)", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "success" }).action, "skip");
});

test("decideDelivery: pending·error → unknown (결과 불명은 자동 재발송하지 않는다)", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "pending" }).action, "unknown");
  assert.equal(decideDelivery({ ...base, telegramStatus: "error" }).action, "unknown");
});

test("decideDelivery: 오늘 리포트 커밋이 없으면 skip (휴장·생성 실패)", () => {
  assert.equal(decideDelivery({ ...base, reportSha: null, telegramStatus: null }).action, "skip");
});

test("decideDelivery: dry_run은 무조건 skip", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: null, dryRun: true }).action, "skip");
  assert.equal(decideDelivery({ ...base, telegramStatus: null, dryRun: true, forceResend: true }).action, "skip");
});

test("decideDelivery: 사람의 명시적 재발송(forceResend)은 status와 무관하게 send — 단 리포트 커밋은 있어야 한다", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "success", forceResend: true }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: "pending", forceResend: true }).action, "send");
  assert.equal(decideDelivery({ ...base, reportSha: null, telegramStatus: null, forceResend: true }).action, "skip");
});

test("decideDelivery: 활성화 기준일 이전 리포트는 status가 없어도 재발송하지 않는다 (배포 당일 중복 방지)", () => {
  assert.equal(DELIVERY_TRACKING_SINCE, "2026-09-22");
  const r = decideDelivery({ ...base, date: "2026-09-21", telegramStatus: null });
  assert.equal(r.action, "skip");
  assert.match(r.reason, /기준일/);
});

test("decideDelivery: 이 실행이 방금 생성한 리포트는 기준일과 무관하게 보낸다 (정상 경로)", () => {
  assert.equal(decideDelivery({ ...base, date: "2026-09-21", telegramStatus: null, justGenerated: true }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: null, justGenerated: true, dryRun: true }).action, "skip");
});

test("classifyTelegramResponse: ok:true → success", () => {
  assert.equal(classifyTelegramResponse('{"ok":true,"result":{"message_id":1700}}').state, "success");
});

test("classifyTelegramResponse: ok:false → failure + description", () => {
  const r = classifyTelegramResponse('{"ok":false,"error_code":400,"description":"Bad Request: can\'t parse entities"}');
  assert.equal(r.state, "failure");
  assert.match(r.detail, /400/);
  assert.match(r.detail, /parse entities/);
});

test("classifyTelegramResponse: 빈 응답·JSON 아님·ok 필드 없음 → error (결과 불명)", () => {
  assert.equal(classifyTelegramResponse("").state, "error");
  assert.equal(classifyTelegramResponse("<html>502 Bad Gateway</html>").state, "error");
  assert.equal(classifyTelegramResponse('{"result":1}').state, "error");
});

test("formatAnomalyBreakdown: 기존 워크플로 one-liner와 같은 출력", () => {
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 8 }), "괴리율 8");
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 2, volumeSpike: 1, consecutiveSell: 1 }), "괴리율 2/거래량 1/매도 1");
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 0, trackingError: 3 }), "추적오차 3");
  assert.equal(formatAnomalyBreakdown({ somethingNew: 2 }), "somethingNew 2");
  assert.equal(formatAnomalyBreakdown(undefined), "");
});
