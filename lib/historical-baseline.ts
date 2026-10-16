// lib/historical-baseline.ts
// C05 (2026-10-16 감사): 과거 비교 기준값 선택. 목표 시각 '이전' 마지막 종가를 쓰고 날짜를 보존한다.
// (이전 구현은 목표일 이후 5일 창의 첫 값이라, 휴일이 끼면 이번 주 월요일 종가가 '1주 전'이 됐다.)

export interface DatedClose {
  close: number;
  date: string; // YYYY-MM-DD (Yahoo 일봉 date의 UTC 날짜 — 해당 거래 세션 날짜)
}

export function pickCloseOnOrBefore(
  quotes: ReadonlyArray<{ date: Date; close: number | null | undefined }>,
  target: Date,
): DatedClose | null {
  let best: { date: Date; close: number } | null = null;
  for (const q of quotes) {
    if (q.close == null || !Number.isFinite(q.close)) continue;
    if (q.date.getTime() > target.getTime()) continue;
    if (!best || q.date.getTime() > best.date.getTime()) best = { date: q.date, close: q.close };
  }
  return best ? { close: +best.close.toFixed(2), date: best.date.toISOString().slice(0, 10) } : null;
}

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** now가 속한 주의 월요일 00:00 KST(UTC Date). */
export function weekStartKst(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  const mondayKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceMonday);
  return new Date(mondayKst - KST_OFFSET_MS);
}
