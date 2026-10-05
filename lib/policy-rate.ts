/**
 * 정책금리(연준 목표범위·한은 기준금리) 수집·요약·프롬프트 블록.
 * 마켓 리포트가 금리 국면을 추론하지 않고 입력에서 읽게 하기 위한 사실 블록.
 * 설계: docs/superpowers/specs/2026-10-05-policy-rate-block-design.md
 */

import type { PolicyRateChange, PolicyRateSummary } from "./types";

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
