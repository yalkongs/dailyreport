// lib/temporal-framing.ts
// 개장 전 브리핑의 '시점 프레이밍' 블록 — market·ETF 공유.
// 지수 데이터가 직전 영업일 종가임을 갭 인지(간밤 vs 지난 금요일)로 명시한다.

import type { MarketCalendarInfo } from "./market-calendar";
import { describeSessionRecency } from "./market-calendar";

/**
 * 양국 정상 거래일에 항상 주입하는 시점 프레이밍.
 * market: KR/US 양쪽 시점 명시 + "오늘 마감" 단정 금지.
 * etf: overnight 베이스라인을 이미 가지므로 갭 보강만(경량).
 */
export function buildTemporalFramingBlock(
  info: MarketCalendarInfo,
  reportType: "market" | "etf"
): string {
  const kr = describeSessionRecency(info.date, info.krPrevTradingDay, "kr");
  const us = describeSessionRecency(info.date, info.usPrevTradingDay, "us");
  const gapWarn = us.gapDays > 1 || kr.gapDays > 1;

  // 캘린더 B (2026-06-30): 미국 단독 휴장(KR 개장)일 때도 이 블록이 단일 시점 소스.
  // run.ts는 KR 휴장이면 생성 전 skip하므로, 생성되는 비정상 상태는 isUsClosedOnly 하나뿐.
  const usHolidayNote = info.isUsClosedOnly
    ? `\n- ⚠️ 오늘 밤 미국 시장은 ${info.usHolidayName ?? "휴일"}로 휴장입니다 — 오늘 밤 새 미국 세션이 없습니다. 미국 데이터는 ${us.phrase} 종가가 최신입니다.`
    : "";

  if (reportType === "etf") {
    // ETF는 시스템 프롬프트가 "발행=개장 전, 전일 국내/간밤 해외"를 이미 명시.
    // 월요일 등 갭 발생 시 '간밤' 오용만 차단.
    const gapLine = gapWarn
      ? `\n- ⚠️ 직전 미국 세션은 ${us.phrase}입니다. "간밤"이 아니라 "${us.phrase}"로 명시하고, 그 사이 뉴스는 "오늘 개장 시 반영될 변수"로 서술하십시오.`
      : "";
    return `\n## ⏰ 시점 기준 (개장 전 브리핑)\n- 미국 데이터: ${us.phrase} 종가. 한국 ETF 데이터: ${kr.phrase} 종가.${usHolidayNote}${gapLine}\n`;
  }

  // market — 베이스라인 프레이밍이 없으므로 상시 명시 + 단정 금지.
  const gapBlock = gapWarn
    ? `\n4. 직전 거래일과 오늘 사이 비거래일(주말·휴일)이 있습니다. 그 사이 발생한 뉴스는 **"오늘 개장 시 반영될 변수 / 이번 주 관전 포인트"**로 서술하고, **직전 종가가 이미 반영한 것처럼 쓰지 마십시오.**`
    : "";
  return `\n## ⏰ 시점 기준 — 개장 전 브리핑 (반드시 반영)
- 이 리포트는 ${info.date}(${koreanDow(info.date)}) **한국 장 개장(09:00) 전**에 작성된 **개장 전 브리핑**입니다.${usHolidayNote}
1. 코스피·코스닥·원/달러 등 **한국 지수 데이터는 ${kr.phrase} 종가**입니다. "오늘 코스피가 X로 마감했다", "서울 장이 열리자마자" 같은 **오늘 세션 단정 금지** — 오늘 한국 장은 아직 시작도 안 했습니다.
2. S&P500·나스닥·다우·VIX·미 10Y 등 **미국 지수 데이터는 ${us.phrase} 종가**입니다.
3. 정확한 표현: "${kr.phrase} 종가 기준", "${us.phrase} 마감 기준".${gapBlock}
`;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function koreanDow(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
