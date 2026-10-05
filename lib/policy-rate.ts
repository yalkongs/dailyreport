/**
 * 정책금리(연준 목표범위·한은 기준금리) 수집·요약·프롬프트 블록.
 * 마켓 리포트가 금리 국면을 추론하지 않고 입력에서 읽게 하기 위한 사실 블록.
 * 설계: docs/superpowers/specs/2026-10-05-policy-rate-block-design.md
 */

import { fetchWithTimeout } from "./fetch-utils";
import type { ContextError, PolicyRateChange, PolicyRateSummary, PolicyRates } from "./types";

export interface RatePoint {
  date: string;
  value: number;
}

const EPS = 1e-9;
const STALE_DAYS = 7;
const START_SLACK_DAYS = 30;
const GAP_DAYS = 7;
const PHASE_DAYS = 365;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

const dirWord = (delta: number) => (delta > 0 ? "인상" : "인하");

export function summarizePolicyRate(
  points: RatePoint[],
  opts: { label: string; today: string; windowStart: string; currentText?: string },
): PolicyRateSummary | null {
  const valid = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (valid.length === 0) return null;

  const last = valid[valid.length - 1];
  if (daysBetween(last.date, opts.today) > STALE_DAYS) return null;
  if (daysBetween(opts.windowStart, valid[0].date) > START_SLACK_DAYS) return null;

  const changes: PolicyRateChange[] = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const cur = valid[i];
    if (Math.abs(cur.value - prev.value) <= EPS) continue;
    if (daysBetween(prev.date, cur.date) > GAP_DAYS) return null;
    changes.push({ date: cur.date, delta: Math.round((cur.value - prev.value) * 10000) / 10000 });
  }

  const lastChange = changes.at(-1) ?? null;
  const prevChange = changes.at(-2) ?? null;
  const base = {
    label: opts.label,
    currentText: opts.currentText ?? `${last.value.toFixed(2)}%`,
    current: last.value,
    lastChange,
    prevChange,
    asOf: last.date,
  };

  if (!lastChange) {
    return { ...base, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };
  }
  if (daysBetween(lastChange.date, opts.today) > PHASE_DAYS) {
    return {
      ...base,
      stance: `동결 지속(마지막 변경: ${dirWord(lastChange.delta)} ${lastChange.date})`,
      stanceDirection: "hold",
    };
  }

  const dir = dirWord(lastChange.delta);
  const direction = lastChange.delta > 0 ? "hike" : "cut";
  let streak = 1;
  for (let j = changes.length - 2; j >= 0; j--) {
    const sameSign = Math.sign(changes[j].delta) === Math.sign(lastChange.delta);
    const close = daysBetween(changes[j].date, changes[j + 1].date) <= PHASE_DAYS;
    if (sameSign && close) streak++;
    else break;
  }

  let stance = dir;
  if (streak >= 2) {
    stance = `${dir}(${streak}회 연속)`;
  } else if (prevChange) {
    if (daysBetween(prevChange.date, lastChange.date) > PHASE_DAYS) {
      stance = `${dir}(장기 동결 후 첫 변경)`;
    } else if (Math.sign(prevChange.delta) !== Math.sign(lastChange.delta)) {
      stance = `${dir}(${dirWord(prevChange.delta)}→${dir} 전환)`;
    }
  }
  return { ...base, stance, stanceDirection: direction };
}

export type JsonFetcher = (url: string) => Promise<unknown>;

const defaultFetcher: JsonFetcher = (url) => fetchWithTimeout<unknown>(url, { timeoutMs: 10000 });

const ECOS_PAGE = 1000;
const ECOS_MAX_PAGES = 5;

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function minusYears(date: string, years: number): string {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCFullYear(t.getUTCFullYear() - years); // 2028-02-29 → 2025-03-01 (존재하는 날짜로 보정)
  return t.toISOString().slice(0, 10);
}

interface FredResp {
  observations?: { date: string; value: string }[];
}

async function fetchFredSeries(fetcher: JsonFetcher, id: string, key: string, start: string): Promise<RatePoint[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}` +
    `&file_type=json&observation_start=${start}&sort_order=asc`;
  const data = (await fetcher(url)) as FredResp;
  return (data.observations ?? []).map((o) => ({ date: o.date, value: o.value === "." ? NaN : parseFloat(o.value) }));
}

interface EcosResp {
  StatisticSearch?: { list_total_count?: number; row?: { TIME: string; DATA_VALUE: string }[] };
  RESULT?: { CODE?: string; MESSAGE?: string };
}

async function fetchEcosBaseRate(fetcher: JsonFetcher, key: string, start: string, end: string): Promise<RatePoint[]> {
  const from = start.replaceAll("-", "");
  const to = end.replaceAll("-", "");
  const out: RatePoint[] = [];
  for (let page = 0; page < ECOS_MAX_PAGES; page++) {
    const s = page * ECOS_PAGE + 1;
    const e = (page + 1) * ECOS_PAGE;
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/${s}/${e}/722Y001/D/${from}/${to}/0101000`;
    const data = (await fetcher(url)) as EcosResp;
    if (!data.StatisticSearch) {
      throw new Error(`ECOS ${data.RESULT?.CODE ?? "응답 없음"}: ${data.RESULT?.MESSAGE ?? ""}`.trim());
    }
    const rows = data.StatisticSearch.row ?? [];
    for (const r of rows) {
      const t = r.TIME;
      out.push({ date: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`, value: parseFloat(r.DATA_VALUE) });
    }
    const total = data.StatisticSearch.list_total_count ?? rows.length;
    if (out.length >= total || rows.length === 0) break;
  }
  return out;
}

export async function collectPolicyRates(
  opts: { today?: string; fetcher?: JsonFetcher; fredKey?: string; ecosKey?: string } = {},
): Promise<{ rates: PolicyRates; errors: ContextError[] }> {
  const today = opts.today ?? kstToday();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const fredKey = opts.fredKey ?? process.env.FRED_API_KEY ?? "";
  const ecosKey = opts.ecosKey ?? process.env.ECOS_API_KEY ?? "";
  const windowStart = minusYears(today, 3);
  const errors: ContextError[] = [];

  const fedTask = async (): Promise<PolicyRateSummary | null> => {
    if (!fredKey) return null;
    const [upper, lower] = await Promise.all([
      fetchFredSeries(fetcher, "DFEDTARU", fredKey, windowStart),
      fetchFredSeries(fetcher, "DFEDTARL", fredKey, windowStart),
    ]);
    const lowerLatest = [...lower].reverse().find((p) => Number.isFinite(p.value));
    const upperLatest = [...upper].reverse().find((p) => Number.isFinite(p.value));
    if (!lowerLatest || !upperLatest) throw new Error("요약 불가: FRED 목표범위 관측 없음");
    if (lowerLatest.date !== upperLatest.date) {
      throw new Error(`요약 불가: 목표범위 상·하단 관측일 불일치(${lowerLatest.date} vs ${upperLatest.date})`);
    }
    const s = summarizePolicyRate(upper, {
      label: "미 연준 목표범위",
      today,
      windowStart,
      currentText: `${lowerLatest.value.toFixed(2)}~${upperLatest.value.toFixed(2)}%`,
    });
    if (!s) throw new Error("요약 불가: 이력 불완전 또는 오래됨");
    return s;
  };

  const bokTask = async (): Promise<PolicyRateSummary | null> => {
    if (!ecosKey) return null;
    const pts = await fetchEcosBaseRate(fetcher, ecosKey, windowStart, today);
    const s = summarizePolicyRate(pts, { label: "한국은행 기준금리", today, windowStart });
    if (!s) throw new Error("요약 불가: 이력 불완전 또는 오래됨");
    return s;
  };

  const [fed, bok] = await Promise.allSettled([fedTask(), bokTask()]);
  const pick = (r: PromiseSettledResult<PolicyRateSummary | null>, source: string) => {
    if (r.status === "fulfilled") return r.value;
    errors.push({ source, status: "error", message: (r.reason as Error).message });
    return null;
  };
  return {
    rates: { fed: pick(fed, "policy-rate-fed"), bok: pick(bok, "policy-rate-bok") },
    errors,
  };
}

const BLOCK_HEAD = "### 정책금리 (확정 사실 — 중앙은행의 현재 국면·지난 결정 서술의 유일한 근거)";

function fmtDelta(delta: number): string {
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}%p`;
}

function renderLine(label: string, s: PolicyRateSummary | null): string {
  if (!s) return `- ${label}: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n`;
  let facts: string;
  if (!s.lastChange) {
    facts = "최근 3년 변경 없음";
  } else {
    facts = `최근 변경 ${s.lastChange.date}(효력일) ${fmtDelta(s.lastChange.delta)}`;
    if (s.prevChange) facts += `, 직전 변경 ${s.prevChange.date} ${fmtDelta(s.prevChange.delta)}`;
  }
  return `- ${s.label}: ${s.currentText} — ${facts}\n  → 현재 국면: ${s.stance}\n`;
}

export function renderPolicyRateBlock(rates: PolicyRates): string {
  return `\n${BLOCK_HEAD}\n` + renderLine("미 연준 목표범위", rates.fed) + renderLine("한국은행 기준금리", rates.bok);
}

export function formatPolicyRateLog(rates: PolicyRates): string {
  const one = (s: PolicyRateSummary | null) => (s ? `${s.currentText}(${s.stance})` : "없음");
  return `🏛️ 정책금리: 연준 ${one(rates.fed)} / 한은 ${one(rates.bok)}`;
}

export const POLICY_RATE_RULE =
  "- ❌ **중앙은행 금리 국면 추정 금지**: 연준·한은의 **현재 국면과 지난 결정**(인상·인하·동결, 언제 얼마나)은 [정책금리] 블록에 적힌 대로만 쓸 것. " +
  "블록에서 '오늘 확인 불가'인 연준·한은은 국면·지난 결정을 언급하지 말 것(FRED 연방기금금리 월평균 값으로 대신 추정하지 말 것). " +
  "블록에 없는 중앙은행(ECB·일본은행 등)의 국면·결정은 추정하지 말고, 뉴스에 출처가 있을 때만 출처를 밝혀 인용할 것. " +
  "**앞으로의 방향**(추가 인상·인하 전망)은 뉴스에 출처가 있을 때만 출처를 밝혀 인용할 것 — 현재 국면과 반대되는 전망이면 " +
  "\"인상 국면 속에서도 ○○는 인하 가능성을 제기했다\"처럼 국면을 함께 밝힐 것.";
