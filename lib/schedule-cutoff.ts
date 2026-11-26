// 백업 schedule 시각 가드(2026-11-27). workflow의 gate job이 1차로 막고, 생성 스크립트가 수집 직전에 다시 본다 —
// gate를 08:49에 통과한 실행이 러너 대기·동시성 대기로 개장 뒤에 수집을 시작하는 경우(Codex 지적).
export const SCHEDULE_CUTOFF_HHMM = 850;

export function isLateScheduledRun(eventName: string | undefined, now: Date = new Date()): boolean {
  if (eventName !== "schedule") return false;
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.getUTCHours() * 100 + kst.getUTCMinutes() >= SCHEDULE_CUTOFF_HHMM;
}
