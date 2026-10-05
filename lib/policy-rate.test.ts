import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePolicyRate, daysBetween, type RatePoint, collectPolicyRates, renderPolicyRateBlock, formatPolicyRateLog, POLICY_RATE_RULE, findPolicyDirectionMismatches, extractReportText } from "./policy-rate";
import type { PolicyRateSummary } from "./types";

const TODAY = "2026-10-05";
const WINDOW = "2023-10-05";

/** start~end 매일 값. changes: [효력일, 새 값] */
function daily(start: string, end: string, initial: number, changes: [string, number][] = []): RatePoint[] {
  const out: RatePoint[] = [];
  let v = initial;
  const map = new Map(changes);
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (map.has(d)) v = map.get(d)!;
    out.push({ date: d, value: v });
  }
  return out;
}

const opts = (label = "한국은행 기준금리") => ({ label, today: TODAY, windowStart: WINDOW });

test("daysBetween", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-05"), 4);
});

test("실제 연준 이력: 인하 사이클 뒤 첫 인상 → 전환", () => {
  const pts = daily(WINDOW, "2026-10-04", 5.5, [
    ["2024-09-19", 5.0], ["2024-11-08", 4.75], ["2024-12-19", 4.5],
    ["2025-09-18", 4.25], ["2025-10-30", 4.0], ["2025-12-11", 3.75], ["2026-09-17", 4.0],
  ]);
  const s = summarizePolicyRate(pts, { ...opts("미 연준 목표범위"), currentText: "3.75~4.00%" })!;
  assert.equal(s.current, 4);
  assert.equal(s.currentText, "3.75~4.00%");
  assert.deepEqual(s.lastChange, { date: "2026-09-17", delta: 0.25 });
  assert.deepEqual(s.prevChange, { date: "2025-12-11", delta: -0.25 });
  assert.equal(s.stance, "인상(인하→인상 전환)");
  assert.equal(s.stanceDirection, "hike");
  assert.equal(s.asOf, "2026-10-04");
});

test("한은 2회 연속 인상", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.currentText, "3.00%");
  assert.equal(s.stance, "인상(2회 연속)");
  assert.equal(s.stanceDirection, "hike");
});

test("단일 인하", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2026-08-01", 2.75]]), opts())!;
  assert.equal(s.stance, "인하");
  assert.equal(s.stanceDirection, "cut");
  assert.equal(s.prevChange, null);
});

test("마지막 변경 후 365일 초과 → 동결 지속", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2025-01-10", 3.25]]), opts())!;
  assert.equal(s.stance, "동결 지속(마지막 변경: 인상 2025-01-10)");
  assert.equal(s.stanceDirection, "hold");
});

test("3년 무변경", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.5), opts())!;
  assert.equal(s.lastChange, null);
  assert.equal(s.stance, "동결 지속(최근 3년 변경 없음)");
  assert.equal(s.stanceDirection, "hold");
});

test("365일 넘게 떨어진 같은 방향 두 변경은 연속이 아니다", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2024-01-10", 3.25], ["2026-09-01", 3.5]]), opts())!;
  assert.equal(s.stance, "인상(장기 동결 후 첫 변경)");
});

test("NaN 관측은 건너뛴다", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  pts.splice(100, 0, { date: pts[100].date, value: NaN });
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.stance, "인상(2회 연속)");
});

test("부동소수 오차는 변경이 아니다", () => {
  const pts = daily(WINDOW, "2026-10-04", 0.3);
  pts[500] = { ...pts[500], value: 0.1 + 0.2 };
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.lastChange, null);
});

test("빈 입력 → null", () => {
  assert.equal(summarizePolicyRate([], opts()), null);
});

test("마지막 관측이 7일 넘게 오래됨 → null", () => {
  assert.equal(summarizePolicyRate(daily(WINDOW, "2026-09-20", 3.0), opts()), null);
});

test("이력이 조회 시작보다 30일 넘게 늦게 시작 → null", () => {
  assert.equal(summarizePolicyRate(daily("2026-01-01", "2026-10-04", 3.0), opts()), null);
});

test("7일 초과 공백 직후 값이 바뀌면 → null", () => {
  const pts = daily(WINDOW, "2026-10-04", 3.75, [["2026-09-17", 4.0]])
    .filter((p) => p.date < "2026-09-08" || p.date > "2026-09-17");
  assert.equal(summarizePolicyRate(pts, opts()), null);
});

function fredObs(start: string, end: string, initial: number, changes: [string, number][] = []) {
  return { observations: daily(start, end, initial, changes).map((p) => ({ date: p.date, value: String(p.value) })) };
}
function ecosRows(start: string, end: string, initial: number, changes: [string, number][] = []) {
  return daily(start, end, initial, changes).map((p) => ({ TIME: p.date.replaceAll("-", ""), DATA_VALUE: String(p.value) }));
}
const FED_CHANGES: [string, number][] = [["2025-12-11", 3.75], ["2026-09-17", 4.0]];
const FED_LOWER: [string, number][] = [["2025-12-11", 3.5], ["2026-09-17", 3.75]];
const BOK_CHANGES: [string, number][] = [["2026-07-16", 2.75], ["2026-08-27", 3.0]];

function makeFetcher(overrides: Record<string, unknown | Error> = {}) {
  const calls: string[] = [];
  const bokAll = ecosRows(WINDOW, "2026-10-04", 2.5, BOK_CHANGES);
  const fetcher = async (url: string) => {
    calls.push(url);
    for (const [k, v] of Object.entries(overrides)) {
      if (url.includes(k)) {
        if (v instanceof Error) throw v;
        return v;
      }
    }
    if (url.includes("DFEDTARU")) return fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES);
    if (url.includes("DFEDTARL")) return fredObs(WINDOW, "2026-10-04", 3.75, FED_LOWER);
    const m = url.match(/\/json\/kr\/(\d+)\/(\d+)\//);
    if (m) {
      const [s, e] = [Number(m[1]), Number(m[2])];
      return { StatisticSearch: { list_total_count: bokAll.length, row: bokAll.slice(s - 1, e) } };
    }
    throw new Error("unexpected url " + url);
  };
  return { fetcher, calls };
}

test("collectPolicyRates: 두 소스 정상 + ECOS 페이지 이어받기", async () => {
  const { fetcher, calls } = makeFetcher();
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(errors, []);
  assert.equal(rates.fed!.currentText, "3.75~4.00%");
  assert.equal(rates.fed!.stance, "인상(인하→인상 전환)");
  assert.equal(rates.bok!.currentText, "3.00%");
  assert.equal(rates.bok!.stance, "인상(2회 연속)");
  assert.ok(calls.some((u) => u.includes("/1/1000/722Y001/D/")));
  assert.ok(calls.some((u) => u.includes("/1001/2000/722Y001/D/")));
  assert.ok(calls.every((u) => !u.includes("/722Y001/M/")));
});

test("collectPolicyRates: 키 없으면 조용히 null", async () => {
  const { fetcher, calls } = makeFetcher();
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "", ecosKey: "" });
  assert.deepEqual(rates, { fed: null, bok: null });
  assert.deepEqual(errors, []);
  assert.equal(calls.length, 0);
});

test("collectPolicyRates: FRED 실패는 fed만 null + errors 기록", async () => {
  const { fetcher } = makeFetcher({ DFEDTARU: new Error("HTTP 500") });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed, null);
  assert.ok(rates.bok);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, "policy-rate-fed");
  assert.match(errors[0].message, /HTTP 500/);
});

test("collectPolicyRates: FRED 결측 '.' 섞여도 요약", async () => {
  const obs = fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES);
  obs.observations[200].value = ".";
  const { fetcher } = makeFetcher({ DFEDTARU: obs });
  const { rates } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed!.stance, "인상(인하→인상 전환)");
});

test("collectPolicyRates: 하단 관측일이 상단과 다르면 fed null + errors", async () => {
  const { fetcher } = makeFetcher({ DFEDTARL: fredObs(WINDOW, "2025-12-11", 3.75, [["2025-12-11", 3.5]]) });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed, null);
  assert.equal(errors[0].source, "policy-rate-fed");
  assert.match(errors[0].message, /관측일 불일치/);
});

test("collectPolicyRates: 빈 정상 응답 → 요약 불가 errors", async () => {
  const { fetcher } = makeFetcher({
    DFEDTARU: { observations: [] },
    "722Y001": { StatisticSearch: { list_total_count: 0, row: [] } },
  });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(rates, { fed: null, bok: null });
  assert.deepEqual(errors.map((e) => e.source).sort(), ["policy-rate-bok", "policy-rate-fed"]);
  assert.ok(errors.every((e) => /요약 불가/.test(e.message)));
});

test("collectPolicyRates: 실제 응답 형식(추가 필드 포함) 파싱", async () => {
  // FRED observations 실제 형식(realtime_* 필드 포함), ECOS 2026-10-05 sample 키 실제 응답 행 형식
  const fredReal = (obs: { observations: { date: string; value: string }[] }) => ({
    realtime_start: TODAY, realtime_end: TODAY, units: "lin", count: obs.observations.length,
    observations: obs.observations.map((o) => ({ realtime_start: TODAY, realtime_end: TODAY, ...o })),
  });
  const bok = ecosRows(WINDOW, "2026-10-04", 2.5, BOK_CHANGES).map((r) => ({
    STAT_CODE: "722Y001", STAT_NAME: "1.3.1. 한국은행 기준금리 및 여수신금리",
    ITEM_CODE1: "0101000", ITEM_NAME1: "한국은행 기준금리", ITEM_CODE2: null, ITEM_NAME2: null,
    UNIT_NAME: "연%", WGT: null, ...r,
  }));
  const fetcher = async (url: string) => {
    if (url.includes("DFEDTARU")) return fredReal(fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES));
    if (url.includes("DFEDTARL")) return fredReal(fredObs(WINDOW, "2026-10-04", 3.75, FED_LOWER));
    const m = url.match(/\/json\/kr\/(\d+)\/(\d+)\//)!;
    return { StatisticSearch: { list_total_count: bok.length, row: bok.slice(Number(m[1]) - 1, Number(m[2])) } };
  };
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(errors, []);
  assert.equal(rates.fed!.currentText, "3.75~4.00%");
  assert.equal(rates.bok!.lastChange!.date, "2026-08-27");
});

test("collectPolicyRates: 윤일 today도 존재하는 조회 시작일로", async () => {
  const { fetcher, calls } = makeFetcher();
  await collectPolicyRates({ today: "2028-02-29", fetcher, fredKey: "k", ecosKey: "k" });
  assert.ok(calls.some((u) => u.includes("observation_start=2025-03-01")));
  assert.ok(calls.some((u) => u.includes("/20250301/20280229/")));
});

test("collectPolicyRates: ECOS 데이터 없음 응답 → bok null + errors", async () => {
  const { fetcher } = makeFetcher({ "722Y001": { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } } });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.bok, null);
  assert.ok(rates.fed);
  assert.equal(errors[0].source, "policy-rate-bok");
  assert.match(errors[0].message, /INFO-200|요약 불가/);
});

const FED: PolicyRateSummary = {
  label: "미 연준 목표범위", currentText: "3.75~4.00%", current: 4,
  lastChange: { date: "2026-09-17", delta: 0.25 }, prevChange: { date: "2025-12-11", delta: -0.25 },
  stance: "인상(인하→인상 전환)", stanceDirection: "hike", asOf: "2026-10-04",
};
const BOK: PolicyRateSummary = {
  label: "한국은행 기준금리", currentText: "3.00%", current: 3,
  lastChange: { date: "2026-08-27", delta: 0.25 }, prevChange: { date: "2026-07-16", delta: 0.25 },
  stance: "인상(2회 연속)", stanceDirection: "hike", asOf: "2026-10-04",
};
const HEAD = "### 정책금리 (확정 사실 — 데이터 기준일까지 중앙은행의 국면·지난 결정 서술의 유일한 근거)";

test("renderPolicyRateBlock: 두 소스", () => {
  assert.equal(
    renderPolicyRateBlock({ fed: FED, bok: BOK }),
    `\n${HEAD}\n` +
      "- 미 연준 목표범위: 3.75~4.00% — 최근 변경 2026-09-17(효력일) +0.25%p, 직전 변경 2025-12-11 −0.25%p\n" +
      "  → 현재 국면: 인상(인하→인상 전환) (데이터 기준일 2026-10-04)\n" +
      "- 한국은행 기준금리: 3.00% — 최근 변경 2026-08-27(효력일) +0.25%p, 직전 변경 2026-07-16 +0.25%p\n" +
      "  → 현재 국면: 인상(2회 연속) (데이터 기준일 2026-10-04)\n",
  );
});

test("renderPolicyRateBlock: 한쪽 없음 → 확인 불가 줄", () => {
  const out = renderPolicyRateBlock({ fed: FED, bok: null });
  assert.ok(out.includes("- 미 연준 목표범위: 3.75~4.00%"));
  assert.ok(out.endsWith("- 한국은행 기준금리: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n"));
});

test("renderPolicyRateBlock: 둘 다 없음 → 제목 + 확인 불가 두 줄", () => {
  assert.equal(
    renderPolicyRateBlock({ fed: null, bok: null }),
    `\n${HEAD}\n` +
      "- 미 연준 목표범위: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n" +
      "- 한국은행 기준금리: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n",
  );
});

test("renderPolicyRateBlock: 변경 없음·직전 없음", () => {
  const hold: PolicyRateSummary = { ...BOK, lastChange: null, prevChange: null, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };
  const single: PolicyRateSummary = { ...BOK, prevChange: null, stance: "인상" };
  assert.ok(renderPolicyRateBlock({ fed: null, bok: hold }).includes("- 한국은행 기준금리: 3.00% — 최근 3년 변경 없음\n  → 현재 국면: 동결 지속(최근 3년 변경 없음) (데이터 기준일 2026-10-04)\n"));
  assert.ok(renderPolicyRateBlock({ fed: null, bok: single }).includes("최근 변경 2026-08-27(효력일) +0.25%p\n  → 현재 국면: 인상 (데이터 기준일 2026-10-04)\n"));
});

test("formatPolicyRateLog", () => {
  assert.equal(formatPolicyRateLog({ fed: FED, bok: BOK }), "🏛️ 정책금리: 연준 3.75~4.00%(인상(인하→인상 전환), 최근 변경 2026-09-17, 기준일 2026-10-04) / 한은 3.00%(인상(2회 연속), 최근 변경 2026-08-27, 기준일 2026-10-04)");
  assert.ok(formatPolicyRateLog({ fed: null, bok: { ...BOK, lastChange: null, prevChange: null } }).includes("최근 변경 없음, 기준일 2026-10-04"));
  assert.equal(formatPolicyRateLog({ fed: null, bok: null }), "🏛️ 정책금리: 연준 없음 / 한은 없음");
});

test("POLICY_RATE_RULE: 국면은 블록만, 전망은 출처 인용", () => {
  assert.ok(POLICY_RATE_RULE.startsWith("- ❌ **중앙은행 금리 국면 추정 금지**"));
  assert.ok(POLICY_RATE_RULE.includes("[정책금리] 블록에 적힌 대로만"));
  assert.ok(POLICY_RATE_RULE.includes("FRED 연방기금금리 월평균"));
  assert.ok(POLICY_RATE_RULE.includes("블록에 없는 중앙은행(ECB·일본은행 등)"));
  assert.ok(POLICY_RATE_RULE.includes("출처가 있을 때만"));
  assert.ok(POLICY_RATE_RULE.includes("데이터 기준일 **이후에 발표된**"));
  assert.ok(POLICY_RATE_RULE.includes("그 결정이 블록보다 우선한다"));
});

test("context-data: 정책금리 수집·errors 병합·로그 연결", () => {
  const src = fs.readFileSync("lib/context-data.ts", "utf8");
  assert.ok(src.includes("collectPolicyRates()"));
  assert.ok(src.includes("errors.push(...policyRateResult.errors)"));
  assert.ok(src.includes("policyRates: policyRateResult.rates"));
  assert.ok(src.includes("formatPolicyRateLog(policyRateResult.rates)"));
});

const CUT_BOK: PolicyRateSummary = { ...BOK, stance: "인하", stanceDirection: "cut" };
const HOLD_BOK: PolicyRateSummary = { ...BOK, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };

test("soft-warn: 인상 국면에서 인하 전제 표현 탐지(10-02 실문장)", () => {
  const text = "수치가 예상보다 높게 나오면 한국은행 금리 인하 기대가 후퇴하며 채권·주식 모두 단기 부담을 받을 수 있습니다. 반도체는 강했습니다.";
  const hits = findPolicyDirectionMismatches(text, { fed: FED, bok: BOK });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].includes("금리 인하 기대"));
  assert.ok(hits[0].length <= 80);
});

test("soft-warn: <strong> 낀 표현과 '금리를 내렸다'도 탐지", () => {
  const text = "연준의 금리 <strong>인하</strong> 기대가 커졌습니다. 한은이 금리를 내렸습니다.";
  assert.equal(findPolicyDirectionMismatches(text, { fed: FED, bok: BOK }).length, 2);
});

test("extractReportText: 중첩 객체의 문자열 값만 줄 단위로 모은다", () => {
  const content = { bigStory: { content: [
    { type: "paragraph", text: "연준이 동결했습니다." },
    { text: "한은의 추가 인상 기대가 커졌습니다.", type: "paragraph" },
  ] }, n: 3 };
  const text = extractReportText(content);
  assert.ok(text.includes("연준이 동결했습니다.\n"));
  assert.ok(!text.includes("{"));
  // 객체 경계가 문장을 합치지 않는다: 연준 hike·한은 cut 에서 두 번째 문장만 탐지
  assert.equal(findPolicyDirectionMismatches(text, { fed: FED, bok: CUT_BOK }).length, 1);
});

test("soft-warn: 은행이 엇갈리면 문장 단서로 구분", () => {
  const rates = { fed: FED, bok: CUT_BOK };
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인하 기대가 커졌습니다.", rates).length, 0);
  assert.equal(findPolicyDirectionMismatches("연준의 추가 인하 기대가 커졌습니다.", rates).length, 1);
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인상 기대가 커졌습니다.", rates).length, 1);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", rates).length, 0);
});

test("soft-warn: 단서 없는 문장은 두 은행이 모두 있고 같은 방향일 때만", () => {
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", { fed: FED, bok: null }).length, 0);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", { fed: FED, bok: BOK }).length, 1);
});

test("soft-warn: hold·없음은 검사하지 않음", () => {
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인하 기대.", { fed: null, bok: HOLD_BOK }).length, 0);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대.", { fed: null, bok: null }).length, 0);
});

test("프롬프트 소스: 규칙 삽입·과거 수치 출처 통합·인하 프레임 제거", () => {
  const cc = fs.readFileSync("lib/claude-client.ts", "utf8");
  assert.ok(cc.includes("${POLICY_RATE_RULE}"));
  assert.ok(cc.includes("renderPolicyRateBlock(context.policyRates)"));
  assert.ok(cc.includes("findPolicyDirectionMismatches(extractReportText(content), context.policyRates)"));
  assert.ok(!cc.includes("금리 인하를 준비하던"));
  assert.ok(cc.includes("historicalComparison 필드 또는 [정책금리] 블록의 수치만"));
  assert.ok(cc.includes("historicalComparison·[정책금리] 블록에 포함되지 않은 과거 수치는 절대 사용 금지"));
  assert.ok(cc.includes("반드시 이 데이터 또는 [정책금리] 블록만 사용하십시오"));
  const sd = fs.readFileSync("lib/sideways-detector.ts", "utf8");
  assert.ok(!sd.includes("미국 금리 인하가 진짜 시작되면"));
  assert.ok(sd.includes("미국 금리 경로가 바뀌면 무슨 일이 벌어지나 — 시나리오 분석"));
});

test("collectPolicyRates: 비 Error 거부(undefined)도 fed만 null, bok 유지", async () => {
  const { fetcher: base } = makeFetcher();
  const fetcher = async (url: string) => {
    if (url.includes("DFEDTARU")) throw undefined;
    return base(url);
  };
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed, null);
  assert.ok(rates.bok);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, "policy-rate-fed");
  assert.equal(typeof errors[0].message, "string");
});

test("context-data.ts: 수집 에러 로그에 사유(message) 포함", () => {
  const src = fs.readFileSync(new URL("./context-data.ts", import.meta.url), "utf8");
  assert.ok(src.includes("${e.source}(${e.message})"));
});

test("claude-client.ts: 컨텍스트 비활성 시에도 정책금리 블록 유지", () => {
  const src = fs.readFileSync(new URL("./claude-client.ts", import.meta.url), "utf8");
  assert.ok(src.includes("if (!context) return renderPolicyRateBlock({ fed: null, bok: null });"));
});
