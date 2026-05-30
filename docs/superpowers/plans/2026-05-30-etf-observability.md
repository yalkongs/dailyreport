# ETF 관측성·투명성 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF 파이프라인의 매 실행에서 tier·mode·신호를 `data/etf-evidence-log.json`에 적재(B5)하고, macro 수집이 전체 실패한 날 거시 지표 블록 머리에 경고 1줄을 띄워(B6) 임계값 보정 데이터를 확보하고 모델이 진짜 null과 수집 실패를 구분할 수 있게 한다.

**Architecture:** 신규 순수 유틸 `lib/etf/etf-evidence-log.ts`가 lens/angle 로그와 동일한 `loadJson`/`saveJson` 패턴으로 append + retention 슬라이스. `run-etf.ts` Step 7 끝에 1회 호출. macro 블록은 `lib/etf/claude-client.ts`에서 `buildMacroBlock` 헬퍼로 추출해 `failedSources` 의존 경고를 분기·테스트.

**Tech Stack:** TypeScript · tsx · `node:test`/`node:assert` (`npx tsx --test`).

**참고 spec:** `docs/superpowers/specs/2026-05-30-etf-observability-design.md`

**커밋 규약:** 한국어 서술형 + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. 특정 파일만 stage (`git add -A` 금지). 브랜치: `feat/etf-observability`.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `lib/etf/etf-evidence-log.ts` | tier·신호 로그 append + retention | 신규 |
| `lib/etf/etf-evidence-log.test.ts` | append/retention 단위 테스트 | 신규 |
| `scripts/run-etf.ts` | Step 7 끝에 1회 호출 | 수정 |
| `lib/etf/claude-client.ts` | macro 블록 → `buildMacroBlock` 추출·경고 분기 | 수정 |
| `lib/etf/claude-client.macro.test.ts` | buildMacroBlock 단위 테스트 | 신규 |

---

## Task 1: B5 — tier 운영 로그 모듈 + 배선

**Files:**
- Create: `lib/etf/etf-evidence-log.ts`
- Create: `lib/etf/etf-evidence-log.test.ts`
- Modify: `scripts/run-etf.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/etf/etf-evidence-log.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { appendEtfEvidenceLog, type EtfEvidenceLogEntry } from './etf-evidence-log'

function entry(date: string): EtfEvidenceLogEntry {
  return {
    date,
    tier: 'thin',
    mode: 'normal',
    newsCount: 5,
    freshCount: 3,
    topCatalystScore: 6,
    anomalyCount: 2,
    anomalyBreakdown: { premiumDiscount: 2 },
    failedSources: [],
  }
}
function tmpPath(): string {
  return path.join(os.tmpdir(), `etf-evidence-log-${Date.now()}-${Math.floor(process.uptime() * 1e9)}.json`)
}

test('파일 없을 때 첫 호출 → 엔트리 1개', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.equal(stored.length, 1)
    assert.equal(stored[0].date, '2026-05-30')
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('기존 엔트리 뒤에 append', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-28'), { path: p })
    appendEtfEvidenceLog(entry('2026-05-29'), { path: p })
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.deepEqual(stored.map(e => e.date), ['2026-05-28', '2026-05-29', '2026-05-30'])
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('retention 슬라이스 — 한도 초과 시 가장 오래된 것 제거', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-28'), { path: p, retentionDays: 2 })
    appendEtfEvidenceLog(entry('2026-05-29'), { path: p, retentionDays: 2 })
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p, retentionDays: 2 })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.deepEqual(stored.map(e => e.date), ['2026-05-29', '2026-05-30'])
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('기본 path는 data/etf-evidence-log.json, 기본 retention 60', () => {
  // 옵션 미지정 경로(= 기본)는 cwd 의존이라 단위에서 강하게 검증 불가.
  // 여기선 함수가 옵션 없이도 throw 안 하는지만 가볍게 확인.
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p }) // 명시 path 사용 (cwd 오염 방지)
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.equal(stored.length, 1)
  } finally {
    fs.rmSync(p, { force: true })
  }
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/etf/etf-evidence-log.test.ts`
Expected: FAIL — `Cannot find module './etf-evidence-log'`.

- [ ] **Step 3: 모듈 구현**

`lib/etf/etf-evidence-log.ts`:

```ts
// lib/etf/etf-evidence-log.ts
//
// B5 (2026-05-30): 매 ETF 실행의 evidence tier·mode·신호를 일별 로그에 적재.
// 임계값(FRESH_HOURS·STRONG_CATALYST·event/quiet anomaly) 운영 보정을 위한 표본 누적.
// 순수 유틸. 외부 호출 없음(파일 IO만).

import type { AnomalyType } from './types'
import { loadJson, saveJson } from './pipeline-utils'

export interface EtfEvidenceLogEntry {
  date: string
  tier: 'strong' | 'thin' | 'hollow'
  mode: 'event' | 'normal' | 'quiet'
  newsCount: number
  freshCount: number
  topCatalystScore: number
  anomalyCount: number                                     // 전체(괴리율 포함)
  anomalyBreakdown: Partial<Record<AnomalyType, number>>   // 타입별 분해 — 괴리율 vs 유의미 사후 분석용
  failedSources: string[]
}

const DEFAULT_PATH = 'data/etf-evidence-log.json'
const DEFAULT_RETENTION = 60 // 초안값 — 평일 ≈ 3개월. 1~2개월 운영 후 보정.

export function appendEtfEvidenceLog(
  entry: EtfEvidenceLogEntry,
  options: { path?: string; retentionDays?: number } = {},
): void {
  const file = options.path ?? DEFAULT_PATH
  const retention = options.retentionDays ?? DEFAULT_RETENTION
  const existing = loadJson<EtfEvidenceLogEntry[]>(file, [])
  const next = [...existing, entry].slice(-retention)
  saveJson(file, next)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test lib/etf/etf-evidence-log.test.ts`
Expected: PASS — `pass 4  fail 0`.

- [ ] **Step 5: run-etf.ts 배선 — import 추가**

`scripts/run-etf.ts` 상단 import에 추가:
```ts
import { appendEtfEvidenceLog } from '../lib/etf/etf-evidence-log'
```

- [ ] **Step 6: run-etf.ts 배선 — Step 7 끝에 호출 1회**

`scripts/run-etf.ts`의 Step 7 (인덱스 갱신) 마지막 줄을 찾기:
```ts
  saveJson(ANGLE_LOG_PATH, [...recentAngles, narrativeAngle].slice(-30))
```
그 직후에 한 블록 추가:
```ts

  // B5 (2026-05-30): tier·mode·신호 일별 로그 적재 — 임계값 운영 보정용
  appendEtfEvidenceLog({
    date,
    tier: data.etfEvidence?.tier ?? 'hollow',
    mode: data.etfMode?.mode ?? 'normal',
    newsCount: data.etfEvidence?.newsCount ?? 0,
    freshCount: data.etfEvidence?.freshCount ?? 0,
    topCatalystScore: data.etfEvidence?.topCatalystScore ?? 0,
    anomalyCount: anomalies.length,
    anomalyBreakdown: breakdown,
    failedSources: data.failedSources ?? [],
  })
```

- [ ] **Step 7: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 8: 커밋**

```bash
git add lib/etf/etf-evidence-log.ts lib/etf/etf-evidence-log.test.ts scripts/run-etf.ts
git commit -m "$(cat <<'EOF'
B5: ETF tier·mode·신호 일별 로그 적재 (etf-evidence-log)

매 실행에서 tier·mode·newsCount/freshCount·topCatalystScore·anomalyBreakdown·failedSources를
data/etf-evidence-log.json에 append(retention 60일). 임계값 운영 보정 데이터 수집.
lens/angle 로그와 동일 패턴. 단위 테스트 4종.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: B6 — macro 블록 실패 경고

**Files:**
- Modify: `lib/etf/claude-client.ts`
- Create: `lib/etf/claude-client.macro.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/etf/claude-client.macro.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMacroBlock } from './claude-client'
import type { MacroContext } from './types'

const emptyMacro: MacroContext = {
  usdKrw: null, dxy: null, vix: null, moveIndex: null,
  us10y: null, fearGreed: null, wti: null, gold: null,
}

test('failedSources에 macro 포함 → 경고 줄이 헤더 직후 등장', () => {
  const out = buildMacroBlock(emptyMacro, ['macro'])
  const lines = out.split('\n')
  assert.equal(lines[0], '[거시 지표]')
  assert.match(lines[1], /거시 데이터 수집 실패/)
  assert.match(lines[1], /신뢰할 수 없습니다/)
})

test('failedSources에 macro 없음(빈 배열) → 경고 없음', () => {
  const out = buildMacroBlock(emptyMacro, [])
  assert.equal(out.split('\n')[0], '[거시 지표]')
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('failedSources undefined → 경고 없음', () => {
  const out = buildMacroBlock(emptyMacro, undefined)
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('다른 키만 실패(news) → macro 경고 없음 (macro 키만 트리거)', () => {
  const out = buildMacroBlock(emptyMacro, ['news', 'krx-nav'])
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('지표 7줄(USD/KRW·VIX·MOVE·공포탐욕·US 10Y·WTI·Gold)이 항상 존재', () => {
  const out = buildMacroBlock(emptyMacro, [])
  assert.match(out, /USD\/KRW:/)
  assert.match(out, /VIX:/)
  assert.match(out, /MOVE:/)
  assert.match(out, /공포탐욕:/)
  assert.match(out, /US 10Y:/)
  assert.match(out, /WTI:/)
  assert.match(out, /Gold:/)
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/etf/claude-client.macro.test.ts`
Expected: FAIL — `buildMacroBlock`이 export되어 있지 않음.

- [ ] **Step 3: buildMacroBlock 추출·구현 + 호출부 교체**

`lib/etf/claude-client.ts`에 새 export 함수 추가(파일 상단의 다른 `function` 사이가 자연스러움 — `formatPromptNumber` 근처):

```ts
// B6 (2026-05-30): macro 블록 — failedSources에 'macro' 있으면 머리에 경고.
// 평소 단일 지표 null(예: ^MOVE)은 진짜 부재이므로 라벨링 안 함(블록 단위 처리).
export function buildMacroBlock(macro: import('./types').MacroContext, failedSources: string[] | undefined): string {
  const warn = failedSources?.includes('macro')
    ? '⚠️ 거시 데이터 수집 실패 — 아래 수치는 신뢰할 수 없습니다(직전 영업일 기준으로도 보지 마십시오).\n'
    : ''
  return `[거시 지표]
${warn}USD/KRW: ${formatPromptNumber(macro.usdKrw, 0)}
VIX: ${formatPromptNumber(macro.vix, 2)}
MOVE: ${formatPromptNumber(macro.moveIndex, 2)}
공포탐욕: ${formatPromptNumber(macro.fearGreed, 0)}
US 10Y: ${formatPromptNumber(macro.us10y, 2)}%
WTI: ${formatPromptNumber(macro.wti, 1)}
Gold: ${formatPromptNumber(macro.gold, 0)}`
}
```

그리고 `buildMorningPrompt` 안의 기존 거시 지표 블록(8줄)을 찾기:
```
[거시 지표]
USD/KRW: ${formatPromptNumber(data.macro.usdKrw, 0)}
VIX: ${formatPromptNumber(data.macro.vix, 2)}
MOVE: ${formatPromptNumber(data.macro.moveIndex, 2)}
공포탐욕: ${formatPromptNumber(data.macro.fearGreed, 0)}
US 10Y: ${formatPromptNumber(data.macro.us10y, 2)}%
WTI: ${formatPromptNumber(data.macro.wti, 1)}
Gold: ${formatPromptNumber(data.macro.gold, 0)}
```
이 전체를 한 줄로 교체:
```
${buildMacroBlock(data.macro, data.failedSources)}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test lib/etf/claude-client.macro.test.ts`
Expected: PASS — `pass 5  fail 0`.

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 6: 커밋**

```bash
git add lib/etf/claude-client.ts lib/etf/claude-client.macro.test.ts
git commit -m "$(cat <<'EOF'
B6: macro 수집 실패 시 거시 지표 블록 머리에 경고 (블록 단위 라벨)

buildMacroBlock으로 추출해 failedSources에 'macro' 있을 때만 경고 줄 추가.
평소 단일 지표 null('^MOVE' 등)은 진짜 부재라 라벨링 안 함(per-field 아님). 단위 테스트 5종.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (작성자 체크리스트 결과)

**Spec coverage:** B5 모듈(Task 1 Step 3)·풍부 엔트리(Step 1·3)·retention 60(Step 3)·`run-etf.ts` 배선(Step 5·6)·테스트(Step 1) / B6 블록 단위 경고·`failedSources['macro']` 분기(Task 2 Step 3)·테스트(Step 1) / 비목표(macro 수집기·per-field·lens-angle 통합)는 코드를 안 건드리므로 자동 충족.

**Placeholder scan:** 없음 — 모든 Step에 실코드·실명령·기대 출력.

**Type consistency:** `EtfEvidenceLogEntry` 정의(Task 1 Step 3) ↔ 테스트(Step 1) ↔ run-etf 호출(Step 6) 필드 일치. `appendEtfEvidenceLog(entry, options?)` 시그니처 일관. `buildMacroBlock(macro: MacroContext, failedSources?: string[])` 정의(Task 2 Step 3) ↔ 테스트(Step 1) ↔ 호출부(Step 3) 일치. `loadJson`/`saveJson`은 기존 `pipeline-utils` 그대로 사용 — 시그니처 변경 없음.
