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

/**
 * KRX 일별매매정보 요청 순서. 직전 거래일을 **먼저** 요청하고, 비어 있을 때만 today 부터 역행한다.
 * 이유: KRX는 금요일 데이터 게시 뒤 주말 날짜 요청에도 값이 빈 행을 돌려준다(2026-09-22 06:45 실행이
 * 일요일 20260920 으로 1171행을 받음). 오늘부터 역행하면 월요일·휴일 다음 날엔 그 빈 행을 먼저 채택해
 * 매번 stale 이 된다. 관측 job(probe-krx-publish)은 직전 거래일을 직접 요청해 월요일에도 전량을 받았다.
 */
export function krxRequestOrder(reportDate: string, today: string, lookbackDays = 8): string[] {
  const expected = expectedKrxBasDd(reportDate);
  const [y, m, d] = today.split("-").map(Number);
  const back: string[] = [];
  for (let i = 0; i < lookbackDays; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    back.push(dt.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return [expected, ...back.filter((b) => b !== expected)];
}
