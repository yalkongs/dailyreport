// lib/etf/krx-session.ts
// KRX OpenAPI 응답이 "직전 한국 거래일" 세션인지 판정한다.
// KRX는 전일 데이터를 익영업일 아침에 게시하므로, 그 전에 조회하면 이틀 전 세션이 온다.
// 그 값을 "전일"로 병합하면 리포트가 하루 어긋난다(2026-09-19 운영 점검).
import { getPrevTradingDay } from "../market-calendar";

export type KrxSession = "prev-session" | "stale" | "none";

export function toKrxBasDd(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

export function expectedKrxBasDd(reportDate: string): string {
  return toKrxBasDd(getPrevTradingDay(reportDate, "kr"));
}

/** rowBasDd 는 요청 변수가 아니라 응답 행의 BAS_DD 여야 한다. */
export function resolveKrxSession(rowBasDd: string | null, reportDate: string): KrxSession {
  if (!rowBasDd) return "none";
  return rowBasDd === expectedKrxBasDd(reportDate) ? "prev-session" : "stale";
}

/** 관측 종료 조건. kstHHMM 은 "HH:MM" (24시간제, 0 패딩). */
export function probeDeadlinePassed(kstHHMM: string, deadline = "09:10"): boolean {
  return kstHHMM >= deadline;
}
