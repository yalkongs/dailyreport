// lib/session-timeline.ts
//
// 국내 등락과 미국 장의 시간 순서를 코드가 정한다(2026-11-27 설계: docs/superpowers/specs/2026-11-27-session-order-design.md).
// 11-19~26 리포트가 국내 전일 등락을 그보다 뒤에 열린 미국 장·국내 장 마감 뒤 기사로 설명한 오류가 최다였다.

import { getPrevTradingDay, koreanWeekday } from "./market-calendar";

export interface SessionTimeline {
  reportDate: string;
  /** 국내 ETF·코스피 전일 등락의 세션(직전 한국 거래일). */
  krSession: string;
  /** krSession 개장 전에 끝난 미국 장 — 국내 등락의 해외 원인 후보. */
  priorUsSession: string;
  /** 오늘 아침 기준 가장 최근 미국 장(한국시간 오늘 새벽 마감). */
  overnightUsSession: string;
  /** 간밤 미국 장이 국내 장 뒤에 열렸는가(미국 휴장이면 false — 간밤 = 직전 미국 장). */
  overnightAfterKr: boolean;
}

export function buildSessionTimeline(reportDate: string): SessionTimeline {
  const krSession = getPrevTradingDay(reportDate, "kr");
  const priorUsSession = getPrevTradingDay(krSession, "us");
  const overnightUsSession = getPrevTradingDay(reportDate, "us");
  return { reportDate, krSession, priorUsSession, overnightUsSession, overnightAfterKr: overnightUsSession >= krSession };
}

export function mdw(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}(${koreanWeekday(date)})`;
}

/** 국내 장 마감(D_kr 15:30 KST) 시각(ms). */
export function krCloseMs(t: SessionTimeline): number {
  return Date.parse(`${t.krSession}T15:30:00+09:00`);
}

/**
 * 기사 발행 시점이 국내 장 마감 전인지 후인지. 발행 경과 시간을 모르면 "".
 * nowMs = 프롬프트를 만드는 시각(발행 경과 시간의 기준).
 */
export function newsTimingTag(publishedHoursAgo: number | undefined, t: SessionTimeline, nowMs: number): string {
  if (typeof publishedHoursAgo !== "number" || !Number.isFinite(publishedHoursAgo)) return "";
  const published = nowMs - publishedHoursAgo * 3600_000;
  return published > krCloseMs(t) ? "국내 장 마감 후" : "국내 장 마감 전";
}

export interface SessionMove {
  nameKo: string;
  changePercent: number;
}

/** 마켓·ETF 공통 — 세션 날짜와 원인 가능 여부를 적은 줄들. */
export function describeSessionOrder(t: SessionTimeline, priorMoves: SessionMove[] = []): string {
  const fmt = (m: SessionMove) => `${m.nameKo} ${m.changePercent >= 0 ? "+" : ""}${m.changePercent.toFixed(2)}%`;
  const priorFigures = priorMoves.length > 0 ? ` — ${priorMoves.map(fmt).join(", ")}` : "";
  const lines = [
    `- 국내 전일 등락(ETF·코스피) = ${mdw(t.krSession)} 한국 정규장(09:00~15:30).`,
    `- 그 국내 장 **직전** 미국 장 = ${mdw(t.priorUsSession)} 미국 장(한국시간 ${mdw(nextDay(t.priorUsSession))} 새벽 마감)${priorFigures}. 국내 전일 등락의 해외 원인으로 쓸 수 있는 미국 장은 이것뿐입니다.`,
  ];
  if (t.overnightAfterKr) {
    lines.push(
      `- 간밤 미국 장 = ${mdw(t.overnightUsSession)} 미국 장(한국시간 ${mdw(nextDay(t.overnightUsSession))} 새벽 마감) — 국내 장이 끝난 **뒤에** 열렸습니다. 국내 전일 등락의 원인·배경으로 쓰지 말고 오늘 국내 개장에 줄 신호로만 쓰십시오. "간밤 ○○ 급락의 충격을 국내 ETF도 받았다"는 시간 순서가 뒤집힌 문장입니다.`,
    );
  } else {
    lines.push(`- 간밤에는 미국 장이 열리지 않았습니다 — 가장 최근 미국 장이 위의 직전 미국 장(${mdw(t.overnightUsSession)})입니다.`);
  }
  lines.push(`- 뉴스의 [국내 장 마감 후] 기사는 국내 전일 등락의 원인으로 쓰지 마십시오. 오늘 개장 변수로만 씁니다.`);
  return lines.join("\n");
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
