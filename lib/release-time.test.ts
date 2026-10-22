// lib/release-time.test.ts
// C03 (2026-10-16 감사): 미국 지표 발표 시각을 한국시간으로 바꾸고 한국 정규장과의 관계를 붙인다.
// (10/14 CPI 08:30 ET = 한국시간 21:30 — ETF가 '오늘 국내 장중 방향을 뒤집는다'고 썼다.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { etToKst, describeKrSession } from "./release-time";

test("ET → KST: 서머타임(EDT) 기간 08:30 ET = 같은 날 21:30 KST", () => {
  assert.deepEqual(etToKst("2026-10-14", "08:30"), { date: "2026-10-14", time: "21:30" });
});

test("ET → KST: 표준시(EST) 기간 08:30 ET = 같은 날 22:30 KST", () => {
  assert.deepEqual(etToKst("2026-11-10", "08:30"), { date: "2026-11-10", time: "22:30" });
});

test("ET → KST: FOMC 14:00 ET는 한국시간 다음 날 새벽", () => {
  assert.deepEqual(etToKst("2026-10-28", "14:00"), { date: "2026-10-29", time: "03:00" });
});

test("한국 정규장 기준 시점 설명", () => {
  assert.equal(describeKrSession("21:30"), "한국 장 마감 후 발표 — 국내 반영은 다음 거래일");
  assert.equal(describeKrSession("03:00"), "한국 개장 전 발표");
  assert.equal(describeKrSession("10:00"), "한국 장중 발표");
  assert.equal(describeKrSession("08:00"), "한국 개장 전 발표");
});

test("ETF 프롬프트: 미국 지표 일정을 한국시간·장 마감 후 표시와 함께 준다", async () => {
  const { buildUsEventsBlock } = await import("./etf/claude-client");
  const block = buildUsEventsBlock([
    { date: "2026-10-14", time: "21:30", kstDate: "2026-10-14", country: "US", event: "Consumer Price Index", importance: 5 },
    { date: "2026-10-20", time: "21:30", kstDate: "2026-10-20", country: "US", event: "Housing Starts", importance: 3 },
  ], "2026-10-14");
  assert.match(block, /\[US\] Consumer Price Index — 10\/14 21:30 KST · 한국 장 마감 후 발표 — 국내 반영은 다음 거래일/);
  assert.doesNotMatch(block, /Housing Starts/); // 오늘~+2일만
  assert.equal(buildUsEventsBlock([], "2026-10-14"), "");
});

// 2026-10-16 dry-run: 장중(15:29) 실행에서 코스피가 '오늘 장중 +2.47%'로 들어가, 직전 거래일 기준의
// ETF 서술과 대조돼 오탐이 났다. 국내 지수는 오늘 세션이 시작됐으면 직전 거래일 종가로 맞춘다.
test("국내 지수: 오늘 세션 값이면 직전 두 종가로 직전 거래일 등락을 계산", async () => {
  const { previousSessionFromCloses } = await import("./etf/market-context");
  const closes = [
    { date: new Date("2026-10-13T00:00:00Z"), close: 6035.35 },
    { date: new Date("2026-10-14T00:00:00Z"), close: 6008.5 },
    { date: new Date("2026-10-15T00:00:00Z"), close: 5554.22 },
    { date: new Date("2026-10-16T00:00:00Z"), close: 5691.4 }, // 오늘 장중
  ];
  const r = previousSessionFromCloses(closes, "2026-10-16");
  assert.equal(r?.asOf, "2026-10-15");
  assert.equal(r?.price, 5554.22);
  assert.ok(Math.abs((r?.changePercent ?? 0) - ((5554.22 / 6008.5 - 1) * 100)) < 1e-9);
  assert.equal(previousSessionFromCloses(closes.slice(0, 1), "2026-10-16"), null);
});

// FRED 캘린더(2026-10-16 운영 진단 반영): 검증된 릴리스 ID, 릴리스별 조회, 일부 실패 허용.
test("FRED 캘린더: 릴리스별 발표일을 기간 안에서 한국시간으로 환산·정렬", async () => {
  const { buildReleaseEvents, IMPORTANT_RELEASES } = await import("./economic-calendar");
  const cpi = IMPORTANT_RELEASES.find((r) => r.id === 10)!;
  const ip = IMPORTANT_RELEASES.find((r) => r.id === 13)!;
  const ev = buildReleaseEvents([
    { release: cpi, dates: ["2026-10-14", "2026-11-10"] },
    { release: ip, dates: ["2026-10-16"] },
  ], "2026-10-14", "2026-10-21");
  assert.deepEqual(ev.map((e) => `${e.event}@${e.kstDate} ${e.time}`), [
    "Consumer Price Index@2026-10-14 21:30",
    "Industrial Production (G.17)@2026-10-16 22:15",
  ]);
  // 운영에서 다른 지표로 확인된 ID는 쓰지 않는다
  for (const wrong of [21, 19, 18, 83]) assert.ok(!IMPORTANT_RELEASES.some((r) => r.id === wrong), `id ${wrong}`);
});

test("FRED 캘린더: 일부 릴리스 조회가 실패해도 나머지로 진행", async () => {
  const { collectEconomicCalendar } = await import("./economic-calendar");
  const prev = process.env.FRED_API_KEY;
  process.env.FRED_API_KEY = "test";
  const today = new Date();
  const d = (n: number) => { const x = new Date(today); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  try {
    const fetcher = (async (url: string) => {
      if (url.includes("release_id=10&")) return { release_dates: [{ date: d(2) }] };
      throw new Error("timeout");
    }) as never;
    // 수집 함수의 경고 줄(console.log)을 가로챈다 — 테스트 중 stdout 쓰기가 Node 테스트 실행기의 결과 메시지와
    // 겹치면 'Unable to deserialize cloned data'로 이 파일이 실패로 잡혔다(CI 10/20·10/23, 테스트는 모두 통과).
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    let ev: Awaited<ReturnType<typeof collectEconomicCalendar>>;
    try { ev = await collectEconomicCalendar(fetcher); } finally { console.log = origLog; }
    assert.ok(logs.some((l) => /릴리스 \d+\/\d+건 조회 실패/.test(l)), "실패 건수 경고를 남긴다");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event, "Consumer Price Index");
    assert.match(ev[0].time ?? "", /^2[12]:30$/);
  } finally {
    if (prev === undefined) delete process.env.FRED_API_KEY; else process.env.FRED_API_KEY = prev;
  }
});
