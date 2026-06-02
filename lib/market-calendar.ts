// lib/market-calendar.ts
//
// 시장 휴일 캘린더 + 양국 시장 상태 판정 모듈.
// (Phase A — 2026-05-22 설계 / 2026 휴일 정적 데이터)
//
// 휴일 정의:
//   - 한국(KRX): 신정·삼일절·어린이날·부처님오신날·추석·한글날·성탄절 등
//     + 대체공휴일 + 토·일 자동 휴장.
//   - 미국(NYSE): New Year's Day·MLK Day·Memorial Day·Independence Day·
//     Thanksgiving·Christmas 등 + 토·일 자동 휴장.
//
// 매년 12월에 다음 해 휴일 목록을 갱신해야 함 (TODO 항목).
// 음력 기반 한국 휴일(설날·추석·부처님오신날)은 매년 양력 날짜가 달라지므로
// 특히 사전 검증 필요.
//
// 순수 함수 모듈. 외부 API 호출 없음. 결정적.

export type MarketStatus = "open" | "closed_holiday" | "closed_weekend";

export interface MarketCalendarInfo {
  date: string;                  // YYYY-MM-DD (KST 기준)
  krStatus: MarketStatus;
  usStatus: MarketStatus;
  krHolidayName?: string;        // ex) "부처님오신날 대체공휴일"
  usHolidayName?: string;        // ex) "Memorial Day"
  krPrevTradingDay: string;      // 한국 직전 영업일
  krNextTradingDay: string;      // 한국 다음 영업일
  usPrevTradingDay: string;      // 미국 직전 영업일
  usNextTradingDay: string;      // 미국 다음 영업일
  // 편의 플래그
  isDualClosed: boolean;         // 양국 모두 휴장
  isKrClosedOnly: boolean;       // 한국만 휴장 (미국은 정상)
  isUsClosedOnly: boolean;       // 미국만 휴장 (한국은 정상)
}

// ─── 2026 휴일 (검증 필요 항목은 주석으로 표시) ────────────

interface Holiday {
  date: string;  // YYYY-MM-DD
  name: string;
}

// 한국 (KRX) 휴일 — 음력/선거/임시공휴일은 계산 불가하므로 매년 연말
// 공식 KRX 휴장 공고로 다음 해를 추가한다. 연 추가 = 아래 맵에 `2027: [...]` 키 추가.
// 데이터 없는 연도는 isYearCovered()가 false → 파이프라인이 exit(1)로 발송을 막는다.
//
// 2026 출처 교차검증: calendarlabs KRX 2026 + 서울경제 2026 증시 휴장 보도.
const KR_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "신정" },
    // 설날: 음력 1/1 = 양력 2026-02-17 (화)
    { date: "2026-02-16", name: "설날 연휴 (전일)" },
    { date: "2026-02-17", name: "설날" },
    { date: "2026-02-18", name: "설날 연휴 (익일)" },
    // 삼일절 3/1 일요일 → 3/2 대체공휴일
    { date: "2026-03-02", name: "삼일절 대체공휴일" },
    { date: "2026-05-01", name: "근로자의 날" },
    { date: "2026-05-05", name: "어린이날" },
    // 부처님오신날: 음력 4/8 = 양력 2026-05-24 (일) → 5/25 대체공휴일
    { date: "2026-05-25", name: "부처님오신날 대체공휴일" },
    { date: "2026-06-03", name: "제9회 전국동시지방선거" },
    { date: "2026-07-17", name: "제헌절" },
    // 광복절 8/15 토요일 → 8/17 대체공휴일
    { date: "2026-08-17", name: "광복절 대체공휴일" },
    // 추석: 음력 8/15 = 양력 2026-09-25 (금). 9/24~26 연휴 (대체 없음 — 토요일은 대체 X)
    { date: "2026-09-24", name: "추석 연휴 (전일)" },
    { date: "2026-09-25", name: "추석" },
    // 개천절 10/3 토요일 → 10/5 대체공휴일
    { date: "2026-10-05", name: "개천절 대체공휴일" },
    { date: "2026-10-09", name: "한글날" },
    { date: "2026-12-25", name: "성탄절" },
    { date: "2026-12-31", name: "KRX 연말 폐장일" },
  ],
};

// 미국 (NYSE) 휴일 — 규칙(n번째 월요일·observed)으로 매년 도출 가능하나,
// 현재는 정적 유지. 연 추가 = `2027: [...]` 키 추가.
const US_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-19", name: "Martin Luther King Jr. Day" },  // 1월 셋째 월요일
    { date: "2026-02-16", name: "Presidents' Day" },              // 2월 셋째 월요일
    { date: "2026-04-03", name: "Good Friday" },                  // Easter 4/5 의 전 금요일
    { date: "2026-05-25", name: "Memorial Day" },                 // 5월 마지막 월요일
    { date: "2026-06-19", name: "Juneteenth" },
    { date: "2026-07-03", name: "Independence Day (observed)" },  // 7/4가 토요일 → 7/3 관측
    { date: "2026-09-07", name: "Labor Day" },                    // 9월 첫 월요일
    { date: "2026-11-26", name: "Thanksgiving" },                 // 11월 넷째 목요일
    { date: "2026-12-25", name: "Christmas" },
    // 조기 폐장(11/27, 12/24)은 종가 있으므로 정상 영업일 처리.
  ],
};

function lookupHoliday(table: Record<number, Holiday[]>, date: string): string | undefined {
  const year = Number(date.slice(0, 4));
  return table[year]?.find(h => h.date === date)?.name;
}

// ─── 날짜 헬퍼 ────────────────────────────────────────

// YYYY-MM-DD → 0(Sun) ~ 6(Sat). UTC 기준이지만 날짜 string 만 보므로 TZ 안전.
function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// YYYY-MM-DD + n일 → YYYY-MM-DD
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ─── 시장 상태 판정 ────────────────────────────────────

function getKrStatus(date: string): { status: MarketStatus; name?: string } {
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { status: "closed_weekend" };
  const name = lookupHoliday(KR_HOLIDAYS, date);
  if (name) return { status: "closed_holiday", name };
  return { status: "open" };
}

function getUsStatus(date: string): { status: MarketStatus; name?: string } {
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { status: "closed_weekend" };
  const name = lookupHoliday(US_HOLIDAYS, date);
  if (name) return { status: "closed_holiday", name };
  return { status: "open" };
}

/**
 * 주어진 시장의 직전 영업일을 찾는다.
 * date 가 영업일이면 그 전 영업일을 반환 (date 본인은 제외).
 */
export function getPrevTradingDay(date: string, market: "kr" | "us"): string {
  const getStatus = market === "kr" ? getKrStatus : getUsStatus;
  let d = addDays(date, -1);
  // 무한루프 방지: 최대 30일 역행
  for (let i = 0; i < 30; i++) {
    if (getStatus(d).status === "open") return d;
    d = addDays(d, -1);
  }
  return d; // 못 찾으면 그냥 30일 전 (방어)
}

/**
 * 주어진 시장의 다음 영업일을 찾는다.
 * date 가 영업일이면 그 다음 영업일을 반환 (date 본인은 제외).
 */
export function getNextTradingDay(date: string, market: "kr" | "us"): string {
  const getStatus = market === "kr" ? getKrStatus : getUsStatus;
  let d = addDays(date, 1);
  for (let i = 0; i < 30; i++) {
    if (getStatus(d).status === "open") return d;
    d = addDays(d, 1);
  }
  return d;
}

/**
 * 주어진 KST 날짜에 대해 양국 시장 캘린더 정보를 반환.
 */
export function getMarketCalendarInfo(date: string): MarketCalendarInfo {
  const kr = getKrStatus(date);
  const us = getUsStatus(date);
  const krOpen = kr.status === "open";
  const usOpen = us.status === "open";
  return {
    date,
    krStatus: kr.status,
    usStatus: us.status,
    krHolidayName: kr.name,
    usHolidayName: us.name,
    krPrevTradingDay: getPrevTradingDay(date, "kr"),
    krNextTradingDay: getNextTradingDay(date, "kr"),
    usPrevTradingDay: getPrevTradingDay(date, "us"),
    usNextTradingDay: getNextTradingDay(date, "us"),
    isDualClosed: !krOpen && !usOpen,
    isKrClosedOnly: !krOpen && usOpen,
    isUsClosedOnly: krOpen && !usOpen,
  };
}

/**
 * 해당 연도의 휴일 데이터가 존재하는지. false면 데이터가 낡은 것 —
 * 호출 측(run.ts/run-etf.ts)이 발송을 막고 exit(1)을 내야 한다.
 */
export function isYearCovered(year: number, market: "kr" | "us"): boolean {
  const table = market === "kr" ? KR_HOLIDAYS : US_HOLIDAYS;
  return table[year] !== undefined;
}

/**
 * 사람이 읽기 좋은 한 줄 요약 (로깅·프롬프트용).
 */
export function describeMarketCalendar(info: MarketCalendarInfo): string {
  const krLabel = info.krStatus === "open"
    ? "한국 정상"
    : info.krStatus === "closed_weekend"
      ? "한국 주말 휴장"
      : `한국 휴장(${info.krHolidayName})`;
  const usLabel = info.usStatus === "open"
    ? "미국 정상"
    : info.usStatus === "closed_weekend"
      ? "미국 주말 휴장"
      : `미국 휴장(${info.usHolidayName})`;
  return `${krLabel} · ${usLabel}`;
}
