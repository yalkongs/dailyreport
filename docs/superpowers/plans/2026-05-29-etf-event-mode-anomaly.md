# ETF event 모드 괴리율 과민 보정 (B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF mode 분기(event/quiet)가 괴리율(premiumDiscount) 노이즈에 왜곡되지 않도록, mode 트리거를 "유의미 이상치(괴리율 제외)" 카운트로 바꾸고 event 임계값을 10→5로 낮춘다.

**Architecture:** `lib/etf/etf-mode.ts`의 `analyzeEtfMode`에서 `significantAnomalies = anomalies.filter(a => a.type !== "premiumDiscount").length`를 도입해 event·quiet 트리거에 사용. `metrics.anomalyCount`는 전체 유지(로그·투명성). 다른 파일·이상탐지 섹션·evidence tier 무변경.

**Tech Stack:** TypeScript · tsx · `node:test`/`node:assert` (`npx tsx --test`).

**참고 spec:** `docs/superpowers/specs/2026-05-29-etf-event-mode-anomaly-design.md`

**커밋 규약:** 한국어 서술형 + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. 특정 파일만 stage (`git add -A` 금지). 브랜치: `feat/etf-event-mode-anomaly`.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `lib/etf/etf-mode.ts` | significantAnomalies 트리거 + event 임계값 5 | 수정 |
| `lib/etf/etf-mode.test.ts` | analyzeEtfMode 단위 테스트 | 신규 |

---

## Task 1: 괴리율 제외 mode 트리거 + 단위 테스트

**Files:**
- Create: `lib/etf/etf-mode.test.ts`
- Modify: `lib/etf/etf-mode.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/etf/etf-mode.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEtfMode } from './etf-mode'
import type { CollectedData, EtfQuote, Anomaly, MacroContext } from './types'

function q(ticker: string, changePercent: number): EtfQuote {
  return {
    ticker, name: ticker, market: ticker.endsWith('.KS') ? 'KR' : 'US',
    price: 100, change: 0, changePercent,
    volume: null, aum: null, nav: null, premiumDiscount: null,
    trackingError: null, prev20AvgVolume: null,
  }
}
function anom(type: Anomaly['type']): Anomaly {
  return { ticker: 'X', market: 'US', type, value: 1, threshold: 0.5, severity: 'warning' }
}
function data(quotes: EtfQuote[]): CollectedData {
  return {
    reportType: 'morning', date: '2026-05-29', quotes,
    flows: [], investorFlows: [], macro: {} as MacroContext, news: [], analysisLens: 'x',
  }
}
// SOXX 0.2% · SPY 0.1% → coreAvgAbs 0.15 < 0.5 (가격 평온)
const calm = [q('SOXX', 0.2), q('SPY', 0.1)]

test('괴리율 10건만 + 가격 평온 → event 아님, quiet', () => {
  const anomalies = Array.from({ length: 10 }, () => anom('premiumDiscount'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.notEqual(r.mode, 'event')
  assert.equal(r.mode, 'quiet')
})

test('유의미 이상치(trackingError) 5건 → event', () => {
  const anomalies = Array.from({ length: 5 }, () => anom('trackingError'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.mode, 'event')
})

test('가격 트리거(SOXX 3.5%) → event (이상치 무관)', () => {
  const r = analyzeEtfMode(data([q('SOXX', 3.5), q('SPY', 0.1)]), [])
  assert.equal(r.mode, 'event')
})

test('괴리율 다수 + 가격 평온 + 유의미 0 → quiet (과거엔 억제됐던 케이스)', () => {
  const anomalies = Array.from({ length: 8 }, () => anom('premiumDiscount'))
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.mode, 'quiet')
})

test('metrics.anomalyCount는 전체(괴리율 포함) 유지', () => {
  const anomalies = [
    ...Array.from({ length: 6 }, () => anom('premiumDiscount')),
    anom('trackingError'),
  ]
  const r = analyzeEtfMode(data(calm), anomalies)
  assert.equal(r.metrics.anomalyCount, 7)
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/etf/etf-mode.test.ts`
Expected: FAIL — 현재 코드는 `anomalyCount`(전체)로 판정하므로 "괴리율 10건만 → quiet"가 event로 나와 실패(현재 임계값 10 충족). "유의미 5건 → event"도 현재는 normal(5 < 10)이라 실패.

- [ ] **Step 3: event 임계값 10 → 5**

`lib/etf/etf-mode.ts`의 `EVENT_THRESHOLDS`에서:
기존:
```ts
  anomalies: 10,     // 이상 탐지 ≥ 10건
```
신규:
```ts
  anomalies: 5,      // 유의미 이상 탐지(괴리율 제외) ≥ 5건. 초안값 — 운영 보정 대상.
```

- [ ] **Step 4: significantAnomalies 도입**

`analyzeEtfMode` 안에서 `const anomalyCount = anomalies.length;` 바로 다음에 추가:
```ts
  // B4 (2026-05-29): 괴리율은 일상적 NAV 갭으로 흔해 mode를 왜곡 → 유의미 이상치만 트리거에 사용.
  const significantAnomalies = anomalies.filter(a => a.type !== "premiumDiscount").length;
```

- [ ] **Step 5: event 트리거를 significantAnomalies로**

event 트리거 블록을 교체:
기존:
```ts
  if (anomalyCount >= EVENT_THRESHOLDS.anomalies) {
    eventTriggers.push(`이상 탐지 ${anomalyCount}건`);
  }
```
신규:
```ts
  if (significantAnomalies >= EVENT_THRESHOLDS.anomalies) {
    eventTriggers.push(`유의미 이상 ${significantAnomalies}건`);
  }
```

- [ ] **Step 6: quiet 조건·reason을 significantAnomalies로**

quiet 판정 블록을 교체:
기존:
```ts
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && anomalyCount <= QUIET_THRESHOLDS.anomMax && !failedSources.includes('krx-nav')) {
    return {
      mode: "quiet",
      reason: `잠잠: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 이상 탐지 ${anomalyCount}건`,
      metrics,
    };
  }
```
신규:
```ts
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && significantAnomalies <= QUIET_THRESHOLDS.anomMax && !failedSources.includes('krx-nav')) {
    return {
      mode: "quiet",
      reason: `잠잠: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 유의미 이상 ${significantAnomalies}건(전체 ${anomalyCount})`,
      metrics,
    };
  }
```

- [ ] **Step 7: normal reason도 일관되게**

normal 반환의 reason을 교체:
기존:
```ts
    reason: `표준: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 이상 탐지 ${anomalyCount}건`,
```
신규:
```ts
    reason: `표준: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 유의미 이상 ${significantAnomalies}건(전체 ${anomalyCount})`,
```

(`metrics.anomalyCount`는 전체 그대로 둔다 — 변경 없음.)

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx tsx --test lib/etf/etf-mode.test.ts`
Expected: PASS — `pass 5  fail 0`.

- [ ] **Step 9: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 10: 커밋**

```bash
git add lib/etf/etf-mode.ts lib/etf/etf-mode.test.ts
git commit -m "$(cat <<'EOF'
ETF B4: event/quiet 모드를 유의미 이상치(괴리율 제외)로 판정

괴리율은 일상적 NAV 갭으로 흔해 anomalyCount를 부풀려 event 과민·quiet 억제를 유발했음.
mode 트리거를 significantAnomalies(괴리율 제외)로 바꾸고 event 임계값 10→5.
metrics.anomalyCount는 전체 유지(로그). 이상탐지 섹션·evidence tier 무변경. 단위 테스트 5종.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (작성자 체크리스트 결과)

**Spec coverage:** 괴리율 제외(Step 4)·event 트리거(Step 5)·quiet 조건(Step 6)·event 임계값 10→5(Step 3)·normal/quiet reason 표기(Step 6·7)·metrics.anomalyCount 전체 유지(명시)·단위 테스트(Step 1) — 모두 매핑. 비목표(evidence tier·이상탐지 섹션·analyzer 무변경)는 이 파일만 건드리므로 자동 충족.

**Placeholder scan:** 없음. 모든 Step에 실제 코드·명령·기대 출력.

**Type consistency:** `analyzeEtfMode(data, anomalies, failedSources?)` 기존 시그니처 그대로 사용(2-arg 호출). `Anomaly['type']`·`EtfQuote`·`CollectedData`·`MacroContext` 필드는 types.ts 정의와 일치(EtfQuote 필수 12필드·Anomaly 6필드·CollectedData 필수 8필드 모두 fixture에 포함). `significantAnomalies` 정의(Step 4) ↔ 사용(Step 5·6·7) 일치.
