// scripts/check-delivery.ts
// 독립 도착 감시(감사 F06) — 그날(KST) 리포트가 구독자에게 실제로 발송(telegram/<kind>=success)됐는지 확인한다.
//
//   npx tsx scripts/check-delivery.ts market|etf [YYYY-MM-DD]
//
// 한국 휴장일이면 exit 0(파이프라인이 silent skip하는 날 — 경보 금지). 영업일인데 success가 아니면
// exit 1 → .github/workflows/delivery-monitor.yml 실패 → GitHub가 소유자에게 실패 메일을 보낸다.
// 트리거 자체가 빠져 job 실패가 아예 생기지 않는 날(맥미니 다운 등)도 이 감시가 잡는다.
// 리포트 커밋·발송 상태 조회는 scripts/delivery-state.ts의 함수를 그대로 쓴다(같은 커밋, 같은 context).
// 이 스크립트는 읽기만 한다 — 발송·재발송·status 기록을 하지 않는다.
import * as fs from "node:fs";
import { type ReportKind, type TelegramStatus, statusContext } from "../lib/delivery-state";
import { getMarketCalendarInfo, isYearCovered } from "../lib/market-calendar";
import { kstToday, findReportSha, readTelegramStatus } from "./delivery-state";

export type CheckCode =
  | "sent"
  | "holiday"
  | "calendar_missing"
  | "lookup_failed"
  | "no_report"
  | "not_sent"
  | "pending"
  | "error"
  | "failure";

export interface CheckInput {
  kind: ReportKind;
  date: string;
  /** lib/market-calendar.ts에 그 해 한국 휴장 데이터가 있는가 */
  calendarCovered: boolean;
  krOpen: boolean;
  holidayName?: string;
  reportSha: string | null;
  telegramStatus: TelegramStatus;
  lookupError: string | null;
}

export interface CheckResult {
  ok: boolean;
  code: CheckCode;
  message: string;
}

/** 파이프라인(run.ts·run-etf.ts)과 같은 기준 — 한국 시장이 열리는 날만 리포트를 만든다. */
export function calendarFor(date: string): Pick<CheckInput, "calendarCovered" | "krOpen" | "holidayName"> {
  const info = getMarketCalendarInfo(date);
  return {
    calendarCovered: isYearCovered(Number(date.slice(0, 4)), "kr"),
    krOpen: info.krStatus === "open",
    holidayName: info.krHolidayName,
  };
}

/** 순수 판정. 영업일에는 telegram/<kind>=success만 통과다. */
export function decideCheck(i: CheckInput): CheckResult {
  const label = `${i.kind === "market" ? "마켓" : "ETF"} 리포트(${i.date})`;
  const ctx = statusContext(i.kind);
  if (!i.calendarCovered) {
    return {
      ok: false,
      code: "calendar_missing",
      message: `${label}: ${i.date.slice(0, 4)}년 한국 휴장 캘린더 없음 — 파이프라인이 발송을 막습니다. lib/market-calendar.ts에 연도를 추가하십시오.`,
    };
  }
  if (!i.krOpen) {
    return { ok: true, code: "holiday", message: `${label}: 한국 휴장(${i.holidayName ?? "주말"}) — 발송 없음이 정상입니다.` };
  }
  if (i.lookupError) {
    return { ok: false, code: "lookup_failed", message: `${label}: 발송 상태 조회 실패 — ${i.lookupError}` };
  }
  if (!i.reportSha) {
    return {
      ok: false,
      code: "no_report",
      message: `${label}: 리포트 없음 — main에 오늘 자 리포트 커밋이 없습니다(생성 실패 또는 트리거 누락). Actions 실행 기록을 확인하십시오.`,
    };
  }
  const sha = i.reportSha.slice(0, 7);
  switch (i.telegramStatus) {
    case "success":
      return { ok: true, code: "sent", message: `${label}: 발송 완료(${ctx}=success @${sha}).` };
    case null:
      return {
        ok: false,
        code: "not_sent",
        message: `${label}: 미발송 — 리포트 커밋(@${sha})은 있으나 ${ctx} status가 없습니다(배포 대기·자산 확인 실패 또는 발송 단계 미실행). 다음 실행이 자동 발송하거나, workflow_dispatch(resend_telegram_only=true, only=${i.kind})로 보내십시오.`,
      };
    case "pending":
    case "error":
      return {
        ok: false,
        code: i.telegramStatus,
        message: `${label}: 발송 결과 불명(${ctx} status=${i.telegramStatus} @${sha}) — 자동 재발송하지 않습니다. 구독자 채널을 확인한 뒤 필요하면 workflow_dispatch(resend_telegram_only=true, only=${i.kind})로 수동 재발송하십시오.`,
      };
    case "failure":
      return {
        ok: false,
        code: "failure",
        message: `${label}: 발송 실패(${ctx} status=failure @${sha}) — Telegram이 거부했습니다. 다음 실행이 자동 재발송하지만, 같은 원인(프리뷰 누락 등)이면 반복됩니다. Actions 로그를 확인하십시오.`,
      };
  }
}

async function main(): Promise<void> {
  const [kindArg, dateArg] = process.argv.slice(2);
  if (kindArg !== "market" && kindArg !== "etf") throw new Error(`usage: check-delivery.ts market|etf [YYYY-MM-DD] (받은 값: ${kindArg})`);
  const k: ReportKind = kindArg;
  const date = dateArg ?? kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜는 YYYY-MM-DD 여야 합니다: ${date}`);

  const cal = calendarFor(date);
  let reportSha: string | null = null;
  let telegramStatus: TelegramStatus = null;
  let lookupError: string | null = null;
  // 휴장일·캘린더 미커버면 조회하지 않는다 — 판정에 필요 없고, API 장애로 휴장일에 경보가 나지 않게.
  if (cal.calendarCovered && cal.krOpen) {
    try {
      reportSha = await findReportSha(k, date);
      if (reportSha) telegramStatus = await readTelegramStatus(k, reportSha);
    } catch (e) {
      lookupError = (e as Error).message;
    }
  }

  const r = decideCheck({ kind: k, date, ...cal, reportSha, telegramStatus, lookupError });
  console.log(`check-delivery: kind=${k} date=${date} sha=${reportSha ?? "-"} status=${telegramStatus ?? "none"} → ${r.code}`);
  if (r.ok) {
    console.log(`✅ ${r.message}`);
  } else {
    console.log(`::error title=리포트 도착 감시 (${k})::${r.message}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${r.ok ? "✅" : "⚠️"} ${r.message}\n`);
  }
  if (!r.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[check-delivery] ${(e as Error).message}`);
    process.exit(1);
  });
}
