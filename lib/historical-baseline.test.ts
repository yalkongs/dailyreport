// lib/historical-baseline.test.ts
// C05 (2026-10-16 감사): '1주 전' 기준값이 목표일 '이후' 첫 거래일 종가(휴일 끼면 이번 주 월요일)로
// 잡혀 "한 주치 상승분을 하루에 소화" 같은 오서술이 났다. 목표 시각 이전 마지막 종가를 쓰고
// 실제 날짜를 보존한다. 주간 누적은 이번 주 월요일(KST) 이전 마지막 종가가 기준이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCloseOnOrBefore, weekStartKst } from "./historical-baseline";

const KS11 = [
  { date: new Date("2026-10-07T00:00:00Z"), close: 6600 },
  { date: new Date("2026-10-08T00:00:00Z"), close: 6625.5 }, // 목
  // 10-09 한글날 휴장, 10-10·11 주말
  { date: new Date("2026-10-12T00:00:00Z"), close: 6384.24 }, // 월
  { date: new Date("2026-10-13T00:00:00Z"), close: 6035.35 },
];

test("1주 전: 목표 시각 이전 마지막 종가와 그 날짜(휴일 뒤 월요일이 아님)", () => {
  // 발행 2026-10-16 06:40 KST = 10-15 21:40Z, 7일 전 = 10-08 21:40Z
  const target = new Date("2026-10-08T21:40:00Z");
  assert.deepEqual(pickCloseOnOrBefore(KS11, target), { close: 6625.5, date: "2026-10-08" });
});

test("목표 이전 값이 없으면 null", () => {
  assert.equal(pickCloseOnOrBefore(KS11, new Date("2026-10-01T00:00:00Z")), null);
  assert.equal(pickCloseOnOrBefore([{ date: new Date("2026-10-08T00:00:00Z"), close: null }], new Date("2026-10-09T00:00:00Z")), null);
});

test("이번 주 시작: KST 월요일 00:00 (금요일 아침 발행 기준)", () => {
  // 2026-10-16(금) 06:40 KST → 2026-10-12(월) 00:00 KST = 10-11 15:00Z
  assert.equal(weekStartKst(new Date("2026-10-15T21:40:00Z")).toISOString(), "2026-10-11T15:00:00.000Z");
  // 월요일 아침이면 그날 00:00 KST
  assert.equal(weekStartKst(new Date("2026-10-11T21:40:00Z")).toISOString(), "2026-10-11T15:00:00.000Z");
});

test("주간 누적 기준: 이번 주 월요일 이전 마지막 종가(직전 주 마지막 거래일)", () => {
  const wk = weekStartKst(new Date("2026-10-15T21:40:00Z"));
  // 월요일 00:00 KST 직전 = 10-08(목) — 10-09 휴장
  assert.deepEqual(pickCloseOnOrBefore(KS11, new Date(wk.getTime() - 1)), { close: 6625.5, date: "2026-10-08" });
});

test("Market 프롬프트 과거 비교: 기준값별 실제 날짜와 주간 기준을 함께 준다", async () => {
  const { buildHistoricalBlock } = await import("./claude-client");
  const block = buildHistoricalBlock([{
    symbol: "^KS11", nameKo: "코스피", current: 5554.22,
    weekToDateBase: 6625.5, weekToDateBaseDate: "2026-10-08",
    oneWeekAgo: 6625.5, oneWeekAgoDate: "2026-10-08",
  }]);
  assert.match(block, /코스피: 현재: 5554\.22 \/ 주간 기준\(10\/08 종가\): 6625\.5 \/ 1주전\(10\/08 종가\): 6625\.5/);
  assert.match(block, /하루 등락률을 주간 수익률로 쓰지 마십시오/);
  assert.equal(buildHistoricalBlock([]), "");
});

test("시장 체온: 추세선이 있으면 5개 시점·색 기준 설명을 붙인다", async () => {
  const { renderReport } = await import("./report-renderer");
  const content = { cover: { headline: "t", subline: "s" }, bigStory: { content: [] }, watchPoints: [], compass: [], soWhat: [], calendar: [], closingMessage: "c" };
  const data = {
    collectedAt: "2026-10-16T07:00:00+09:00", date: "2026-10-16", dayOfWeek: "금",
    koreaStocks: [{ symbol: "^KS11", name: "KOSPI", nameKo: "코스피", price: 5554.22, change: -454, changePercent: -7.57, previousClose: 6008 }],
    usStocks: [], europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
  };
  const hist = [{ symbol: "^KS11", nameKo: "코스피", current: 5554.22, oneYearAgo: 2600, threeMonthsAgo: 3200, oneMonthAgo: 3500, oneWeekAgo: 6625.5 }];
  const html = renderReport(content as never, data as never, hist);
  assert.match(html, /class="pulse-note">추세선: 1년 전·3개월 전·1개월 전·1주 전·현재 5개 시점 비교\(시간 간격 비례 아님\)/);
  assert.match(html, /<title>1년 전·3개월 전/);
  assert.doesNotMatch(renderReport(content as never, data as never, []), /class="pulse-note"/);
});
