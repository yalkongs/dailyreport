// lib/release-time.ts
// C03 (2026-10-16 감사): 발표 시각을 한국시간으로 환산하고 한국 정규장(09:00~15:30)과의 관계를 설명한다.
// 외부 라이브러리 없이 Intl로 미국 동부 서머타임(EDT/EST)을 판정한다.

function nyParts(instant: number): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 미국 동부 현지 날짜·시각(HH:MM) → 한국 날짜·시각. */
export function etToKst(dateEt: string, timeEt: string): { date: string; time: string } {
  const [y, m, d] = dateEt.split("-").map(Number);
  const [hh, mm] = timeEt.split(":").map(Number);
  // EDT(UTC-4)·EST(UTC-5) 두 후보 중 뉴욕 현지 표기가 일치하는 쪽
  for (const offset of [4, 5]) {
    const instant = Date.UTC(y, m - 1, d, hh + offset, mm);
    const ny = nyParts(instant);
    if (ny.date === dateEt && ny.time === timeEt) {
      const kst = new Date(instant + 9 * 3600 * 1000).toISOString();
      return { date: kst.slice(0, 10), time: kst.slice(11, 16) };
    }
  }
  throw new Error(`etToKst: 환산 불가 ${dateEt} ${timeEt}`);
}

/** 한국시간 HH:MM이 한국 정규장 기준 언제인지. */
export function describeKrSession(timeKst: string): string {
  const [hh, mm] = timeKst.split(":").map(Number);
  const minutes = hh * 60 + mm;
  if (minutes < 9 * 60) return "한국 개장 전 발표";
  if (minutes <= 15 * 60 + 30) return "한국 장중 발표";
  return "한국 장 마감 후 발표 — 국내 반영은 다음 거래일";
}
