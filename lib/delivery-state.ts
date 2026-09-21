// lib/delivery-state.ts
// 리포트가 구독자에게 발송됐는지를 리포트 커밋의 commit status로 추적하기 위한 순수 함수.
// spec: docs/superpowers/specs/2026-09-21-backup-and-delivery-recovery-design.md
//
// 원칙: 중복 발송 금지가 최우선. 결과 불명(pending·error)은 자동 재발송하지 않는다.

export type ReportKind = "market" | "etf";
export type TelegramStatus = "pending" | "success" | "failure" | "error" | null;
export type DeliveryAction = "send" | "skip" | "unknown";

/** 이 날짜보다 이른 리포트는 status가 없어도 재발송하지 않는다 — 이 기능 이전 발송분엔 status가 없다. */
export const DELIVERY_TRACKING_SINCE = "2026-09-22";

export function statusContext(kind: ReportKind): string {
  return `telegram/${kind}`;
}

/** 워크플로의 commit 메시지와 일치해야 한다 (daily-report.yml "Commit and push" step). */
export function reportCommitPrefix(kind: ReportKind, date: string): string {
  return kind === "market" ? `Daily Market Report - ${date} (KST)` : `ETF Daily Report - ${date} (KST)`;
}

export function kstDayStartIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}

export function findReportCommit(
  commits: { sha: string; message: string }[],
  kind: ReportKind,
  date: string,
): string | null {
  const prefix = reportCommitPrefix(kind, date);
  return commits.find((c) => c.message.startsWith(prefix))?.sha ?? null;
}

const KNOWN_STATES = new Set(["pending", "success", "failure", "error"]);

export function pickTelegramStatus(
  statuses: { context: string; state: string }[],
  kind: ReportKind,
): TelegramStatus {
  const hit = statuses.find((s) => s.context === statusContext(kind));
  if (!hit) return null;
  return KNOWN_STATES.has(hit.state) ? (hit.state as TelegramStatus) : "error";
}

export function decideDelivery(input: {
  date: string;
  reportSha: string | null;
  telegramStatus: TelegramStatus;
  /** 이 실행이 방금 리포트를 생성·push했다 — 아직 발송됐을 수 없는 정상 경로 */
  justGenerated: boolean;
  forceResend: boolean;
  dryRun: boolean;
}): { action: DeliveryAction; reason: string } {
  const { date, reportSha, telegramStatus, justGenerated, forceResend, dryRun } = input;
  if (dryRun) return { action: "skip", reason: "dry_run" };
  if (!reportSha) return { action: "skip", reason: "오늘 리포트 커밋 없음(휴장 또는 생성 실패)" };
  if (forceResend) return { action: "send", reason: "resend_telegram_only — 사람의 명시적 재발송" };
  if (justGenerated) return { action: "send", reason: "방금 생성한 리포트 — 발송" };
  if (telegramStatus === "success") return { action: "skip", reason: "이미 발송됨(status=success)" };
  if (telegramStatus === "pending" || telegramStatus === "error") {
    return { action: "unknown", reason: `발송 결과 불명(status=${telegramStatus}) — 자동 재발송하지 않음` };
  }
  if (date < DELIVERY_TRACKING_SINCE) {
    return { action: "skip", reason: `발송 추적 기준일(${DELIVERY_TRACKING_SINCE}) 이전 리포트 — status 없음은 미발송을 뜻하지 않음` };
  }
  return {
    action: "send",
    reason: telegramStatus === "failure" ? "Telegram이 거부함(status=failure) — 재발송" : "발송 기록 없음 — 발송",
  };
}

export function classifyTelegramResponse(body: string): { state: "success" | "failure" | "error"; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { state: "error", detail: `응답이 JSON이 아님: ${body.slice(0, 120)}` };
  }
  const r = parsed as { ok?: unknown; error_code?: unknown; description?: unknown };
  if (r && r.ok === true) return { state: "success", detail: "ok:true" };
  if (r && r.ok === false) {
    return { state: "failure", detail: `ok:false ${String(r.error_code ?? "")} ${String(r.description ?? "")}`.trim() };
  }
  return { state: "error", detail: `ok 필드 없음: ${body.slice(0, 120)}` };
}

const ANOMALY_LABELS: Record<string, string> = {
  premiumDiscount: "괴리율",
  trackingError: "추적오차",
  volumeSpike: "거래량",
  consecutiveSell: "매도",
};

/** "괴리율 2/거래량 1/매도 1" 형태. 0건은 제외, 없으면 빈 문자열. */
export function formatAnomalyBreakdown(breakdown: Record<string, number> | undefined): string {
  return Object.entries(breakdown ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${ANOMALY_LABELS[type] ?? type} ${count}`)
    .join("/");
}
