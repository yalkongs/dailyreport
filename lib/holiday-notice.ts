// lib/holiday-notice.ts
//
// 양국 시장 동시 휴장(dual closed) 시 최소 안내 리포트 렌더링.
// (Phase B — 2026-05-22)
//
// 정상 리포트와 같은 URL 구조(`/reports/{date}`, `/etf-reports/{date}`)로
// 발행되어 워크플로의 Telegram sendPhoto 가 정상 작동. Claude API 호출은
// 일절 하지 않아 비용 절감 + stale data 위장 차단.

import type { MarketCalendarInfo } from "./market-calendar";

export interface HolidayNoticeText {
  headline: string;
  subline: string;
}

/**
 * 양국 휴장 시 헤드라인·서브라인 생성.
 * 둘 다 휴일이지만 휴일명이 양쪽 다 있을 때는 합쳐 표시, 한쪽만 휴일(다른 쪽
 * 주말)이면 휴일명만 표시.
 */
export function getHolidayNoticeText(info: MarketCalendarInfo): HolidayNoticeText {
  const krLabel = info.krHolidayName ?? "주말 휴장";
  const usLabel = info.usHolidayName ?? "주말 휴장";

  const sameHolidayName = info.krHolidayName && info.usHolidayName && info.krHolidayName === info.usHolidayName;

  let headline: string;
  if (sameHolidayName) {
    headline = `오늘은 양국 시장 휴장 — ${info.krHolidayName}`;
  } else if (info.krHolidayName && info.usHolidayName) {
    headline = `오늘은 양국 시장 휴장`;
  } else if (info.krHolidayName) {
    headline = `오늘은 한국 ${info.krHolidayName}, 미국 ${usLabel}`;
  } else if (info.usHolidayName) {
    headline = `오늘은 한국 ${krLabel}, 미국 ${info.usHolidayName}`;
  } else {
    headline = `오늘은 주말 휴장`;
  }

  const krNext = info.krNextTradingDay;
  const usNext = info.usNextTradingDay;
  const nextSameDay = krNext === usNext;
  const nextDayPart = nextSameDay
    ? `다음 영업일은 ${krNext} 입니다.`
    : `다음 영업일 — 한국 ${krNext}, 미국 ${usNext}.`;

  const subline = `${nextDayPart} 정규 리포트는 다음 영업일 오전 06:30 KST에 다시 발행됩니다.`;

  return { headline, subline };
}

/**
 * 최소 휴장 안내 HTML. Market·ETF 공용으로 사용.
 * 동일한 디자인 톤(im-teal)을 유지하되 본문은 한 카드.
 */
export function renderHolidayNoticeHtml(args: {
  date: string;
  reportType: "market" | "etf";
  info: MarketCalendarInfo;
}): string {
  const { date, reportType, info } = args;
  const text = getHolidayNoticeText(info);
  const title = reportType === "market" ? "iM AI Market Report" : "iM AI ETF Report";
  const sectionLabel = reportType === "market" ? "Market Today" : "ETF Today";

  const krRow = info.krStatus === "open"
    ? `<tr><th>한국 (KRX)</th><td><span class="badge open">정상</span></td><td>오늘 정상 개장</td></tr>`
    : `<tr><th>한국 (KRX)</th><td><span class="badge closed">휴장</span></td><td>${info.krHolidayName ?? "주말"} · 직전 영업일 ${info.krPrevTradingDay} · 다음 영업일 ${info.krNextTradingDay}</td></tr>`;
  const usRow = info.usStatus === "open"
    ? `<tr><th>미국 (NYSE)</th><td><span class="badge open">정상</span></td><td>오늘 정상 개장</td></tr>`
    : `<tr><th>미국 (NYSE)</th><td><span class="badge closed">휴장</span></td><td>${info.usHolidayName ?? "주말"} · 직전 영업일 ${info.usPrevTradingDay} · 다음 영업일 ${info.usNextTradingDay}</td></tr>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${title} · ${date} (휴장 안내)</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta property="og:title" content="${escapeHtml(text.headline)}" />
  <meta property="og:description" content="${escapeHtml(text.subline)}" />
  <style>
    :root {
      --im-teal: #008f7f;
      --im-teal-deep: #006d61;
      --ink: #1a2421;
      --soft: #f5fbf9;
      --line: #d6e3df;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Noto Sans KR", sans-serif;
           background: #fafafa; color: var(--ink); margin: 0; padding: 24px; }
    .holiday-card { max-width: 720px; margin: 40px auto; background: #ffffff;
                    border: 1px solid var(--line); border-left: 6px solid var(--im-teal);
                    border-radius: 12px; padding: 36px 32px; box-shadow: 0 12px 28px rgba(0,0,0,0.04); }
    .kicker { font-size: 12px; font-weight: 700; color: var(--im-teal-deep); letter-spacing: 2px; text-transform: uppercase; }
    .headline { font-size: 26px; font-weight: 900; line-height: 1.35; color: var(--ink); margin: 12px 0 14px; }
    .subline { font-size: 15px; line-height: 1.65; color: #4e5a55; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 12px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    th { width: 130px; color: var(--im-teal-deep); font-weight: 700; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge.open { background: #e6f5f1; color: var(--im-teal-deep); }
    .badge.closed { background: #fbeae8; color: #b54232; }
    .footer { margin-top: 28px; font-size: 12px; color: #6b746e; line-height: 1.6; }
    .brand { margin-top: 6px; color: var(--im-teal-deep); font-weight: 700; }
  </style>
</head>
<body>
  <div class="holiday-card">
    <div class="kicker">${sectionLabel} · ${date}</div>
    <h1 class="headline">${escapeHtml(text.headline)}</h1>
    <p class="subline">${escapeHtml(text.subline)}</p>
    <table>
      ${krRow}
      ${usRow}
    </table>
    <div class="footer">
      이 안내는 양국 시장 동시 휴장으로 의미 있는 시장 해설이 어려운 날 자동
      발행됩니다. 다음 영업일 오전 06:30 KST 에 정규 리포트가 다시 시작됩니다.
      <div class="brand">${title}</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
