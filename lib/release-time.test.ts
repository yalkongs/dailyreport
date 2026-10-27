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
  assert.match(block, /\[US\] Consumer Price Index — 10\/14 21:30 KST · 오늘 밤 발표\(한국 장 마감 후\) → 국내 반영은 10\/15\(목\)/); // 2026-10-28: 리포트 날짜 기준 시점·반영일
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

// 2026-10-28: 10/29(목) 21:30 미 GDP를 ETF가 '오늘 밤 발표 → 국내 반영은 다음 거래일'로, Market이 '목요일 국내 시장'으로 썼다.
// 프롬프트가 날짜와 상관없이 '오늘 밤'·'다음 거래일' 고정 문구를 줬다 — 일정 줄마다 리포트 날짜 기준 발표 시점과 국내 반영일을 코드가 붙인다.
test("발표 시점·국내 반영일: 리포트 날짜 기준 오늘/내일/모레와 실제 반영 거래일", async () => {
  const { describeEventTiming } = await import("./economic-calendar");
  assert.equal(describeEventTiming("2026-10-29", "21:30", "2026-10-28"), "내일(10/29 목) 밤 발표(한국 장 마감 후) → 국내 반영은 10/30(금)");
  assert.equal(describeEventTiming("2026-10-28", "21:30", "2026-10-28"), "오늘 밤 발표(한국 장 마감 후) → 국내 반영은 10/29(목)");
  assert.equal(describeEventTiming("2026-10-29", "03:00", "2026-10-28"), "내일(10/29 목) 새벽 발표(한국 개장 전) → 국내 반영은 10/29(목)");
  assert.equal(describeEventTiming("2026-10-28", "03:00", "2026-10-28"), "오늘 새벽 발표(한국 개장 전) → 국내 반영은 오늘");
  assert.equal(describeEventTiming("2026-10-28", "10:00", "2026-10-28"), "오늘 한국 장중 발표");
  // 금요일 밤 → 월요일 반영, 그 뒤 날짜는 날짜·요일로
  assert.equal(describeEventTiming("2026-10-30", "21:30", "2026-10-28"), "모레(10/30 금) 밤 발표(한국 장 마감 후) → 국내 반영은 11/2(월)");
  assert.equal(describeEventTiming("2026-11-03", "22:30", "2026-10-28"), "11/3(화) 밤 발표(한국 장 마감 후) → 국내 반영은 11/4(수)");
  // 한국 휴장(성탄절)을 건너뛴다
  assert.equal(describeEventTiming("2026-12-24", "22:30", "2026-12-24"), "오늘 밤 발표(한국 장 마감 후) → 국내 반영은 12/28(월)");
  // 휴장 일정이 등록되지 않은 해로 넘어가면 날짜를 지어내지 않는다(12/31 휴장 → 2027년 1/1 신정을 거래일로 잘못 셌다)
  assert.equal(describeEventTiming("2026-12-30", "22:30", "2026-12-30"), "오늘 밤 발표(한국 장 마감 후) → 국내 반영은 다음 거래일");
  // 경계: 09:00·15:30 정각은 장중, 15:31부터 장 마감 후
  assert.equal(describeEventTiming("2026-10-28", "09:00", "2026-10-28"), "오늘 한국 장중 발표");
  assert.equal(describeEventTiming("2026-10-28", "15:30", "2026-10-28"), "오늘 한국 장중 발표");
  assert.equal(describeEventTiming("2026-10-28", "15:31", "2026-10-28"), "오늘 밤 발표(한국 장 마감 후) → 국내 반영은 10/29(목)");
  // 지난 일정은 날짜 그대로(오늘·내일로 바꾸지 않는다)
  assert.equal(describeEventTiming("2026-10-27", "21:30", "2026-10-28"), "10/27(화) 밤 발표(한국 장 마감 후) → 국내 반영은 오늘");
});

test("일정 한 줄: 리포트 날짜를 주면 발표 시점·반영일을, 안 주면 예전 표기를", async () => {
  const { formatEconomicEventLine } = await import("./economic-calendar");
  const gdp = { date: "2026-10-29", time: "21:30", kstDate: "2026-10-29", country: "US", event: "Gross Domestic Product", importance: 4 };
  assert.equal(formatEconomicEventLine(gdp, "2026-10-28"), "[US] Gross Domestic Product — 10/29 21:30 KST · 내일(10/29 목) 밤 발표(한국 장 마감 후) → 국내 반영은 10/30(금)");
  assert.equal(formatEconomicEventLine(gdp), "[US] Gross Domestic Product — 10/29 21:30 KST · 한국 장 마감 후 발표 — 국내 반영은 다음 거래일");
});

test("ETF·Market 프롬프트: 미국 일정에 '오늘 밤 → 다음 거래일' 고정 문구를 주지 않고 줄의 시점·반영일을 쓰게 한다", async () => {
  const { buildUsEventsBlock, buildMorningPrompt } = await import("./etf/claude-client");
  const { buildReportPrompt } = await import("./claude-client");
  const gdp = { date: "2026-10-29", time: "21:30", kstDate: "2026-10-29", country: "US", event: "Gross Domestic Product", importance: 4 };
  const block = buildUsEventsBlock([gdp], "2026-10-28");
  assert.match(block, /\[US\] Gross Domestic Product — 10\/29 21:30 KST · 내일\(10\/29 목\) 밤 발표\(한국 장 마감 후\) → 국내 반영은 10\/30\(금\)/);
  assert.match(block, /각 줄에 적힌 발표 시점과 국내 반영일을 그대로/);
  const etf = buildMorningPrompt({ reportType: "morning", date: "2026-10-28", quotes: [], flows: [], investorFlows: [], news: [], analysisLens: "", narrativeAngle: "글로벌→국내_전이", usEvents: [gdp], macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null } } as never);
  for (const stale of ["\"오늘 밤 발표, 국내 반영은 다음 거래일\"", "\"오늘 밤 발표 → 국내 반영은 다음 거래일\""]) assert.ok(!etf.includes(stale), stale);
  assert.match(etf, /국내 직전 장이 끝난 뒤 열린 간밤 미국 장의 움직임을 국내 자산군의 이유로 들지 마십시오/);
  const ctx = { angle: { id: "a", name: "구조적 렌즈", description: "", promptGuide: "g" }, recentLog: [], sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null }, deepDiveTopic: null };
  const data = { collectedAt: "2026-10-28T06:40:00+09:00", date: "2026-10-28", dayOfWeek: "수", koreaStocks: [], usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [] };
  const context = { news: [], economicCalendar: [gdp], policyRates: { fed: null, bok: null }, fredIndicators: [], sentiment: {}, koreanBonds: [], historicalComparison: [] };
  const market = buildReportPrompt(data as never, ctx as never, context as never);
  assert.match(market, /Gross Domestic Product — 10\/29 21:30 KST · 내일\(10\/29 목\) 밤 발표\(한국 장 마감 후\) → 국내 반영은 10\/30\(금\)/);
  assert.match(market, /경제 캘린더 줄에 적힌 발표 시점과 국내 반영일을 그대로/);
  assert.ok(!market.includes("\"장 마감 후 → 다음 거래일 반영\"으로 표기"));
  // 새벽 발표는 오늘 반영된다 — '오늘 장중 변수처럼 쓰지 말라'는 장 마감 후 일정에만
  assert.match(market, /한국 장 마감 후에 발표되는 일정은 오늘 한국 장중 변수처럼 쓰지 마십시오/);
  assert.ok(!market.includes("오늘 한국 장중 변수처럼 쓰지 마십시오. 요일·날짜를"));
  // ETF todayChecks.time: HH:MM 형식의 예외(장 마감 후 미국 지표)를 명시
  assert.match(etf, /단 한국 장 마감 후에 발표되는 미국 지표는 time에 그 줄의 발표 시점과 국내 반영일을 씁니다/);
});
