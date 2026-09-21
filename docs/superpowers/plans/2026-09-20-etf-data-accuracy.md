# ETF 국내 시세 기준일 정확성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF 리포트가 이틀 전 세션의 국내 ETF 시세를 "전일"로 서술하지 않게 한다 — KRX 데이터가 전일 세션이 아닌 날은 병합하지 않고, ETF 발송을 KRX 게시 이후(08:10 KST)로 옮긴다.

**Architecture:** KRX 응답 행의 `BAS_DD`를 직전 한국 거래일과 비교하는 순수 함수(`lib/etf/krx-session.ts`)를 만들고, 병합을 순수 함수로 분리해 `prev-session`일 때만 KRX 값을 쓴다. stale인 날은 기존 "KRX 수집 실패일" 경로(국내 NAV 전부 null → `krx-nav`)로 들어간다. 게시 시각은 기존 백업 schedule에 편승한 읽기 전용 관측 job으로 먼저 측정한다.

**Tech Stack:** TypeScript, tsx, node:test + node:assert/strict, GitHub Actions, KRX OpenAPI(`data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd`), yahoo-finance2.

**Spec:** `docs/superpowers/specs/2026-09-20-etf-data-accuracy-design.md`

## Global Constraints

- 브랜치: Phase 1은 `feat/krx-publish-probe`(spec·plan 문서 커밋이 있는 `feat/etf-data-accuracy`에서 분기 — 문서가 Phase 1과 함께 main에 들어간다), Phase 2는 `feat/etf-data-accuracy`(Phase 1 머지 후 main 위로 rebase). 머지·push는 사용자 지시가 있을 때만.
- **Phase 1만 먼저 main에 올린다.** Phase 2는 관측(3~5거래일) 뒤, cron-job.org 전환과 **같은 날** 머지·push한다(가드를 06:40 체제에서 먼저 켜면 매일 stale 경로가 되어 NAV·괴리율이 비고 strong tier가 상시 차단된다).
- stale·none에서는 KRX 값을 **하나도** 병합하지 않는다(날짜 혼합 금지 — `validateData`의 가격/NAV 10% 검증이 리포트를 통째로 중단시킨다, `lib/etf/pipeline-utils.ts:45-55`).
- 판정은 요청 변수 `basDd`가 아니라 **응답 행의 `BAS_DD`**로 한다.
- evidence tier·모드 임계값, `validateData`, `detectAnomalies`의 로직은 바꾸지 않는다.
- 테스트: `npx tsx --test <file>`, 타입: `npx tsc --noEmit`. `git add -A` 금지(파일을 지정해 add).
- 커밋 메시지는 한국어 서술형, 끝에 아래 두 줄:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FXc7J4MXi9SRfhhjaVfR8s
  ```
- `on.schedule`과 job `if`는 바꾸지 않는다(백업은 cron-job.org 2차 트리거 — spec 3절 2026-09-21 개정).

## File Structure

| 파일 | 책임 | Phase |
|---|---|---|
| `lib/etf/krx-session.ts` (신규) | KRX 기준일 판정·관측 종료 조건 순수 함수 | 1 |
| `lib/etf/krx-session.test.ts` (신규) | 위 함수 테스트 | 1 |
| `scripts/probe-krx-publish.ts` (신규) | KRX 게시 시각 읽기 전용 관측 | 1 |
| `.github/workflows/daily-report.yml` | `krx-probe` job(1), 트리거 분리·`FORCE_REGENERATE`(2) | 1·2 |
| `lib/workflow-triggers.test.ts` (신규) | 워크플로 분기 조건 정적 assert | 1·2 |
| `lib/etf/etf-data.ts` | KRX 수집이 BAS_DD 반환, `mergeKrxIntoQuotes` 분리 | 2 |
| `lib/etf/etf-data.merge.test.ts` (신규) | 병합 3분기 + 하류 연결 테스트 | 2 |
| `lib/etf/etf-evidence-log.ts`, `scripts/run-etf.ts` | `krxBasDd`·`krxSession` 기록, reportDate 전달 | 2 |
| `lib/etf/claude-client.ts`, `README.md` | 발행 시각 문구 | 2 |

---

# Phase 1 — KRX 게시 시각 관측 (리포트 무영향)

### Task 1: KRX 기준일 판정 순수 함수

**Files:**
- Create: `lib/etf/krx-session.ts`
- Test: `lib/etf/krx-session.test.ts`

**Interfaces:**
- Produces:
  - `type KrxSession = 'prev-session' | 'stale' | 'none'`
  - `toKrxBasDd(isoDate: string): string` — `"2026-09-17"` → `"20260917"`
  - `expectedKrxBasDd(reportDate: string): string` — 직전 한국 거래일의 basDd
  - `resolveKrxSession(rowBasDd: string | null, reportDate: string): KrxSession`
  - `probeDeadlinePassed(kstHHMM: string, deadline?: string): boolean` — 기본 deadline `"09:10"`

- [ ] **Step 1: 실패하는 테스트 작성** — `lib/etf/krx-session.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toKrxBasDd, expectedKrxBasDd, resolveKrxSession, probeDeadlinePassed } from "./krx-session";

test("toKrxBasDd: ISO 날짜를 KRX basDd로", () => {
  assert.equal(toKrxBasDd("2026-09-17"), "20260917");
});

test("expectedKrxBasDd: 평일은 하루 전", () => {
  assert.equal(expectedKrxBasDd("2026-09-18"), "20260917"); // 금 → 목
});

test("expectedKrxBasDd: 월요일은 지난 금요일", () => {
  assert.equal(expectedKrxBasDd("2026-09-14"), "20260911");
});

test("expectedKrxBasDd: 휴일 다음 날은 휴일을 건너뛴다 (08-17 광복절 대체공휴일)", () => {
  assert.equal(expectedKrxBasDd("2026-08-18"), "20260814");
});

test("resolveKrxSession: 직전 거래일이면 prev-session", () => {
  assert.equal(resolveKrxSession("20260917", "2026-09-18"), "prev-session");
});

test("resolveKrxSession: 이틀 전 세션이면 stale (06:40 실행의 실제 상황)", () => {
  assert.equal(resolveKrxSession("20260916", "2026-09-18"), "stale");
});

test("resolveKrxSession: 일요일 기준일로 온 응답도 stale (09-15 실행의 20260913 사례)", () => {
  assert.equal(resolveKrxSession("20260913", "2026-09-15"), "stale");
});

test("resolveKrxSession: 응답이 없으면 none", () => {
  assert.equal(resolveKrxSession(null, "2026-09-18"), "none");
  assert.equal(resolveKrxSession("", "2026-09-18"), "none");
});

test("probeDeadlinePassed: 09:10 이전은 계속, 이후는 중단", () => {
  assert.equal(probeDeadlinePassed("07:52"), false);
  assert.equal(probeDeadlinePassed("09:09"), false);
  assert.equal(probeDeadlinePassed("09:10"), true);
  assert.equal(probeDeadlinePassed("10:35"), true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/krx-session.test.ts`
Expected: FAIL — `Cannot find module './krx-session'`

- [ ] **Step 3: 구현** — `lib/etf/krx-session.ts`

```ts
// lib/etf/krx-session.ts
// KRX OpenAPI 응답이 "직전 한국 거래일" 세션인지 판정한다.
// KRX는 전일 데이터를 익영업일 아침에 게시하므로, 그 전에 조회하면 이틀 전 세션이 온다.
// 그 값을 "전일"로 병합하면 리포트가 하루 어긋난다(2026-09-19 운영 점검).
import { getPrevTradingDay } from "../market-calendar";

export type KrxSession = "prev-session" | "stale" | "none";

export function toKrxBasDd(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

export function expectedKrxBasDd(reportDate: string): string {
  return toKrxBasDd(getPrevTradingDay(reportDate, "kr"));
}

/** rowBasDd 는 요청 변수가 아니라 응답 행의 BAS_DD 여야 한다. */
export function resolveKrxSession(rowBasDd: string | null, reportDate: string): KrxSession {
  if (!rowBasDd) return "none";
  return rowBasDd === expectedKrxBasDd(reportDate) ? "prev-session" : "stale";
}

/** 관측 종료 조건. kstHHMM 은 "HH:MM" (24시간제, 0 패딩). */
export function probeDeadlinePassed(kstHHMM: string, deadline = "09:10"): boolean {
  return kstHHMM >= deadline;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/krx-session.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/krx-session.ts lib/etf/krx-session.test.ts
git commit -m "KRX 기준일 판정 순수 함수 추가 (직전 거래일 대조)"
```

### Task 2: 관측 스크립트 + `krx-probe` job

**Files:**
- Create: `scripts/probe-krx-publish.ts`
- Create: `lib/workflow-triggers.test.ts`
- Modify: `.github/workflows/daily-report.yml` (파일 끝에 job 추가)

**Interfaces:**
- Consumes: `expectedKrxBasDd`, `probeDeadlinePassed` (Task 1), `getMarketCalendarInfo`(`lib/market-calendar.ts`, 반환값의 `krStatus`), `fetchJson`(`lib/etf/fetcher.ts`)

- [ ] **Step 1: 실패하는 워크플로 테스트 작성** — `lib/workflow-triggers.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "daily-report.yml"), "utf8");

/** `  <name>:` 로 시작하는 job 블록 텍스트(다음 최상위 job 직전까지). */
function jobBlock(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job '${name}' 없음`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test("krx-probe: schedule 이벤트에서만 돌고 다른 job과 의존이 없다", () => {
  const job = jobBlock("krx-probe");
  assert.match(job, /if: \$\{\{ github\.event_name == 'schedule' \}\}/);
  assert.doesNotMatch(job, /needs:/);
  assert.match(job, /timeout-minutes: 95/);
  assert.match(job, /KRX_AUTH_KEY: \$\{\{ secrets\.KRX_AUTH_KEY \}\}/);
  assert.match(job, /npx tsx scripts\/probe-krx-publish\.ts/);
});

test("krx-probe: 읽기 전용 — commit·push·Telegram step이 없다", () => {
  const job = jobBlock("krx-probe");
  assert.doesNotMatch(job, /git (commit|push)/);
  assert.doesNotMatch(job, /api\.telegram\.org/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts`
Expected: FAIL — `job 'krx-probe' 없음`

- [ ] **Step 3: 관측 스크립트 작성** — `scripts/probe-krx-publish.ts`

```ts
// scripts/probe-krx-publish.ts
// KRX OpenAPI가 전일 ETF 일별매매정보를 몇 시에 게시하는지 관측한다 (읽기 전용).
// 파일을 쓰지 않고 로그만 남긴다. 결과는 `gh run view --log`로 읽는다.
// 관측이 끝나면(3~5거래일) 이 스크립트와 워크플로의 krx-probe job을 제거한다.
import { fetchJson } from "../lib/etf/fetcher";
import { expectedKrxBasDd, probeDeadlinePassed } from "../lib/etf/krx-session";
import { getMarketCalendarInfo } from "../lib/market-calendar";

const URL = "https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd";
const INTERVAL_MS = 5 * 60 * 1000;

function kstNow(): { date: string; hhmm: string; hhmmss: string } {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "2026-09-21 07:52:03"
  return { date: s.slice(0, 10), hhmm: s.slice(11, 16), hhmmss: s.slice(11, 19) };
}

async function main() {
  const authKey = process.env.KRX_AUTH_KEY;
  if (!authKey) {
    console.log("[krx-probe] KRX_AUTH_KEY 없음 — 관측 건너뜀");
    return;
  }
  const { date } = kstNow();
  if (getMarketCalendarInfo(date).krStatus !== "open") {
    console.log(`[krx-probe] ${date} 한국 휴장 — 관측 건너뜀`);
    return;
  }
  const basDd = expectedKrxBasDd(date);
  console.log(`[krx-probe] 시작 KST ${kstNow().hhmmss} — 기대 기준일 ${basDd}`);

  for (;;) {
    const now = kstNow();
    const data = await fetchJson<{ OutBlock_1?: { BAS_DD: string }[] }>(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", AUTH_KEY: authKey },
      body: JSON.stringify({ basDd }),
    });
    const rows = data?.OutBlock_1 ?? [];
    if (rows.length > 0) {
      const rowDates = [...new Set(rows.map((r) => r.BAS_DD))].join(",");
      console.log(`[krx-probe] 게시 확인 KST ${now.hhmmss} 요청=${basDd} 응답 BAS_DD=${rowDates} ${rows.length}건`);
      return;
    }
    console.log(`[krx-probe] 미게시 KST ${now.hhmmss} 요청=${basDd}`);
    if (probeDeadlinePassed(now.hhmm)) {
      console.log(`[krx-probe] 09:10 KST까지 미게시 — 관측 종료`);
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

// 관측 실패가 빨간 배지를 만들지 않게 항상 exit 0.
main().catch((e) => console.log("[krx-probe] 오류(무시):", (e as Error).message));
```

- [ ] **Step 4: 워크플로에 job 추가** — `.github/workflows/daily-report.yml` 파일 **맨 끝**에 추가(들여쓰기 2칸, `etf:` job과 같은 깊이)

```yaml

  # KRX OpenAPI 전일 데이터 게시 시각 관측 (읽기 전용, 임시).
  # 기존 백업 schedule(07:30 KST, 실제 발화 07:45~07:55)에 편승해 09:10 KST까지
  # 5분 간격으로 조회하고 로그만 남긴다. market·etf job과 무관하며 리포트에 영향이 없다.
  # 3~5거래일 관측 후 이 job과 scripts/probe-krx-publish.ts를 제거한다.
  # spec: docs/superpowers/specs/2026-09-20-etf-data-accuracy-design.md
  krx-probe:
    if: ${{ github.event_name == 'schedule' }}
    runs-on: ubuntu-latest
    timeout-minutes: 95

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: main

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Probe KRX publish time
        env:
          KRX_AUTH_KEY: ${{ secrets.KRX_AUTH_KEY }}
        run: npx tsx scripts/probe-krx-publish.ts
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests), tsc 출력 없음

- [ ] **Step 6: 로컬 실행 점검 (KRX 키 없는 경로)**

Run: `npx tsx scripts/probe-krx-publish.ts`
Expected: `[krx-probe] KRX_AUTH_KEY 없음 — 관측 건너뜀` 한 줄 후 exit 0

- [ ] **Step 7: 전체 테스트 후 커밋**

```bash
npx tsx --test lib/*.test.ts lib/etf/*.test.ts
git add scripts/probe-krx-publish.ts lib/workflow-triggers.test.ts .github/workflows/daily-report.yml
git commit -m "KRX 게시 시각 읽기 전용 관측 job 추가 (백업 schedule 편승)"
```

### Task 3: Phase 1 배포와 관측 (수동, 사용자 승인 필요)

- [ ] **Step 1:** 사용자 승인 후 `feat/krx-publish-probe`를 main에 `--no-ff` 머지, 전체 테스트·tsc 확인, push.
- [ ] **Step 2:** 다음 거래일 백업 schedule 실행 후 확인:
  `gh run list --workflow=daily-report.yml --event schedule --limit 1 --json databaseId -q '.[0].databaseId'` → `gh run view <id> --log | grep krx-probe`
  Expected: `시작 KST …` → `미게시 …` 반복 → `게시 확인 KST HH:MM:SS … BAS_DD=<기대 기준일>`.
  market·etf job의 결과가 평소와 같은지도 함께 확인한다(중복 가드로 skip).
- [ ] **Step 3:** 3~5거래일의 게시 시각을 표로 정리해 사용자에게 보고하고 발송 시각(기본 08:10)을 확정한다. 게시가 08:10보다 늦으면 발송 시각·백업 cron을 그만큼 늦춘 값으로 Phase 2의 Task 6을 고친다.

---

# Phase 2 — 기준일 가드 + 08:10 전환 (관측 후, 전환과 같은 날 배포)

### Task 4: KRX 수집이 BAS_DD를 돌려주고, 병합을 순수 함수로 분리

**Files:**
- Modify: `lib/etf/etf-data.ts` (`collectKrxOpenApiEtfDailyTrades` 92-126, `collectAllEtfData` 319-377)
- Test: `lib/etf/etf-data.merge.test.ts` (신규)

**Interfaces:**
- Consumes: `KrxSession` (Task 1)
- Produces:
  - `export interface KrxEtfDailyTrade` (기존 인터페이스를 export)
  - `collectKrxOpenApiEtfDailyTrades(): Promise<{ map: Map<string, KrxEtfDailyTrade>; basDd: string | null }>` — `basDd`는 응답 첫 행의 `BAS_DD`
  - `mergeKrxIntoQuotes(quotes: EtfQuote[], krxMap: Map<string, KrxEtfDailyTrade>, session: KrxSession): EtfQuote[]`

- [ ] **Step 1: 실패하는 테스트 작성** — `lib/etf/etf-data.merge.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeKrxIntoQuotes, type KrxEtfDailyTrade } from "./etf-data";
import { validateData } from "./pipeline-utils";
import { detectAnomalies } from "./analyzer";
import type { EtfQuote } from "./types";

function yahooQuote(ticker: string, price: number, changePercent: number): EtfQuote {
  return {
    ticker, name: ticker, market: "KR", price, change: 0, changePercent, volume: 1000,
    aum: null, nav: null, premiumDiscount: null, trackingError: null,
  } as EtfQuote;
}
function krxRow(ticker: string, close: number, nav: number, changePercent: number): KrxEtfDailyTrade {
  return {
    date: "20260916", ticker, name: "KRX " + ticker, close, change: 0, changePercent, nav,
    volume: 5000, tradingValue: 9_000_000, marketCap: 1, netAssetTotal: 2,
    underlyingIndexName: "IDX", underlyingIndexClose: 100, underlyingIndexChangePercent: changePercent,
    premiumDiscount: ((close - nav) / nav) * 100, dailyIndexGap: 0,
  };
}

// KODEX 레버리지가 하루 +11% 움직인 날: Yahoo(D-1)=111, KRX(D-2) 종가·NAV=100
const QUOTES = [yahooQuote("122630.KS", 111, 11), yahooQuote("069500.KS", 105, 5)];
const KRX = new Map([
  ["122630.KS", krxRow("122630.KS", 100, 100, -3)],
  ["069500.KS", krxRow("069500.KS", 100, 97, -1.5)], // D-2 괴리율 +3.09%
]);

test("prev-session: KRX 공식값이 가격·등락률·NAV를 채운다 (현행 동작)", () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, "prev-session");
  assert.equal(out[0].price, 100);
  assert.equal(out[0].changePercent, -3);
  assert.equal(out[0].nav, 100);
  assert.equal(out[1].name, "KRX 069500.KS");
});

test("stale: KRX 값이 하나도 섞이지 않는다 — Yahoo 시세 그대로, KRX 보조지표는 null", () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, "stale");
  assert.deepEqual(out, QUOTES);
  assert.equal(out[0].nav, null);
  assert.equal(out[1].premiumDiscount, null);
});

test("none: stale과 동일", () => {
  assert.deepEqual(mergeKrxIntoQuotes(QUOTES, new Map(), "none"), QUOTES);
});

test("하류 연결: stale 병합 결과는 가격/NAV 10% 검증을 통과하고 괴리율 이상 탐지가 0건", () => {
  const out = mergeKrxIntoQuotes(QUOTES, KRX, "stale");
  assert.doesNotThrow(() => validateData(out));
  const premium = detectAnomalies(out, [], []).filter((a) => a.type === "premiumDiscount");
  assert.equal(premium.length, 0);
});

test("회귀 증명: 날짜를 섞으면(D-1 가격 + D-2 NAV) validateData가 리포트를 중단시킨다", () => {
  const mixed = QUOTES.map((q) => ({ ...q, nav: KRX.get(q.ticker)!.nav }));
  assert.throws(() => validateData(mixed), /괴리 10% 초과/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/etf-data.merge.test.ts`
Expected: FAIL — `mergeKrxIntoQuotes` export 없음

- [ ] **Step 3: 구현** — `lib/etf/etf-data.ts`

(a) `interface KrxEtfDailyTrade {` → `export interface KrxEtfDailyTrade {`

(b) import 추가: `import type { KrxSession } from './krx-session'`

(c) `collectKrxOpenApiEtfDailyTrades`의 시그니처와 반환을 교체:

```ts
export async function collectKrxOpenApiEtfDailyTrades(): Promise<{
  map: Map<string, KrxEtfDailyTrade>
  basDd: string | null
}> {
  const authKey = process.env.KRX_AUTH_KEY
  const map = new Map<string, KrxEtfDailyTrade>()
  if (!authKey) {
    console.warn('[etf-data] KRX_AUTH_KEY 미설정 — KRX OpenAPI ETF 일별매매정보 건너뜀')
    return { map, basDd: null }
  }

  const url = 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd'
  for (const requested of recentKrxDates()) {
    try {
      const data = await fetchJson<{ OutBlock_1?: KrxEtfDailyTradeRow[] }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: authKey,
        },
        body: JSON.stringify({ basDd: requested }),
      })

      const rows = data?.OutBlock_1 ?? []
      if (rows.length === 0) continue
      for (const row of rows) {
        const mapped = mapKrxEtfDailyTrade(row)
        map.set(mapped.ticker, mapped)
      }
      // 판정은 요청 날짜가 아니라 응답 행의 기준일로 한다.
      const basDd = rows[0].BAS_DD || null
      console.log(`[etf-data] KRX OpenAPI ETF 일별매매정보: 요청=${requested} 응답 BAS_DD=${basDd}, ${rows.length}건`)
      return { map, basDd }
    } catch (e) {
      console.error(`[etf-data] KRX OpenAPI ETF 일별매매정보 실패: ${requested}`, e)
    }
  }

  return { map, basDd: null }
}
```

(d) `collectAllEtfData` 위에 순수 병합 함수 추가:

```ts
/**
 * KRX 값을 국내 quote에 병합한다. session 이 'prev-session' 일 때만.
 * stale·none 에서는 KRX 값을 하나도 섞지 않는다 — D-1 가격과 D-2 NAV를 섞으면
 * validateData 의 가격/NAV 10% 검증이 리포트를 통째로 중단시키고, 오래된 괴리율이
 * 이상 탐지·"오늘 N개 관측" 문구로 '오늘'의 사실이 된다.
 * 국내 NAV가 전부 null이면 run-etf 가 'krx-nav' 실패로 기록한다(기존 경로).
 */
export function mergeKrxIntoQuotes(
  quotes: EtfQuote[],
  krxMap: Map<string, KrxEtfDailyTrade>,
  session: KrxSession,
): EtfQuote[] {
  if (session !== 'prev-session') return quotes
  return quotes.map(q => {
    const krx = krxMap.get(q.ticker)
    if (!krx) return q
    return {
      ...q,
      name: krx.name || q.name,
      price: krx.close ?? q.price,
      change: krx.change ?? q.change,
      changePercent: krx.changePercent ?? q.changePercent,
      volume: krx.volume ?? q.volume,
      aum: krx.netAssetTotal ?? q.aum,
      nav: krx.nav,
      premiumDiscount: krx.premiumDiscount,
      trackingError: q.trackingError,
      tradingValue: krx.tradingValue,
      marketCap: krx.marketCap,
      underlyingIndexName: krx.underlyingIndexName,
      underlyingIndexClose: krx.underlyingIndexClose,
      underlyingIndexChangePercent: krx.underlyingIndexChangePercent,
      dailyIndexGap: krx.dailyIndexGap,
    }
  })
}
```

(e) `collectAllEtfData`를 교체(시그니처에 `reportDate`, 반환에 `krx` 추가. legacy NAV 경로는 날짜를 알 수 없으므로 제거):

```ts
export async function collectAllEtfData(
  reportDate: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
): Promise<{
  quotes: EtfQuote[]
  flows: EtfFlow[]
  investorFlows: InvestorFlow[]
  krx: { basDd: string | null; session: KrxSession }
}> {
  const [quotesResult, krxOpenApiResult, investorFlowsResult, flowsResult] = await Promise.allSettled([
    collectYahooQuotes(),
    collectKrxOpenApiEtfDailyTrades(),
    collectKrxInvestorFlows(),
    collectUsEtfFlows(),
  ])

  const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value : []
  const krxResult = krxOpenApiResult.status === 'fulfilled'
    ? krxOpenApiResult.value
    : { map: new Map<string, KrxEtfDailyTrade>(), basDd: null }
  const session = resolveKrxSession(krxResult.basDd, reportDate)
  console.log(
    `[etf-data] KRX BAS_DD=${krxResult.basDd ?? '없음'} 기대=${expectedKrxBasDd(reportDate)} → ${session}` +
    (session === 'prev-session' ? '' : ' — KRX 값을 병합하지 않습니다(국내 NAV·괴리율 없음)'),
  )

  return {
    quotes: mergeKrxIntoQuotes(quotes, krxResult.map, session),
    flows: flowsResult.status === 'fulfilled' ? flowsResult.value : [],
    investorFlows: investorFlowsResult.status === 'fulfilled' ? investorFlowsResult.value : [],
    krx: { basDd: krxResult.basDd, session },
  }
}
```

import를 값 import로 보강: `import { resolveKrxSession, expectedKrxBasDd, type KrxSession } from './krx-session'` ((b)의 type-only import를 이것으로 대체).

`collectLegacyKrxNavData`와 `collectKrxNavData`는 더 이상 호출되지 않으면 삭제한다(`grep -rn "collectLegacyKrxNavData\|collectKrxNavData" lib scripts`로 다른 호출처가 없는지 확인 후).

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/etf-data.merge.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/etf-data.ts lib/etf/etf-data.merge.test.ts
git commit -m "KRX 기준일 가드: 전일 세션일 때만 KRX 값을 병합 (날짜 혼합 금지)"
```

### Task 5: 파이프라인 연결 — reportDate 전달과 evidence 로그 기록

**Files:**
- Modify: `scripts/run-etf.ts:106-115` (수집 호출), `:251-261` (로그 적재)
- Modify: `lib/etf/etf-evidence-log.ts:10-20` (엔트리 타입)
- Test: `lib/etf/etf-evidence-log.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: `collectAllEtfData(reportDate)`의 반환 `krx: { basDd, session }` (Task 4)
- Produces: `EtfEvidenceLogEntry`에 선택 필드 `krxBasDd?: string | null`, `krxSession?: 'prev-session' | 'stale' | 'none'`

- [ ] **Step 1: 실패하는 테스트 추가** — `lib/etf/etf-evidence-log.test.ts` 끝에

```ts
test("KRX 기준일·세션 판정을 엔트리에 기록한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evlog-"));
  const file = path.join(dir, "log.json");
  appendEtfEvidenceLog(
    {
      date: "2026-09-21", tier: "thin", mode: "normal", newsCount: 8, freshCount: 5,
      topCatalystScore: 6, anomalyCount: 0, anomalyBreakdown: {}, failedSources: ["krx-nav"],
      krxBasDd: "20260917", krxSession: "stale",
    },
    { path: file },
  );
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved[0].krxBasDd, "20260917");
  assert.equal(saved[0].krxSession, "stale");
});
```

(파일 상단에 `fs`·`path`·`os` import가 없으면 `import * as fs from "node:fs"; import * as path from "node:path"; import * as os from "node:os";`를 추가한다. 기존 테스트가 임시 경로를 만드는 방식이 있으면 그 방식을 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx tsc --noEmit`
Expected: FAIL — `krxBasDd` does not exist in type `EtfEvidenceLogEntry`

- [ ] **Step 3: 구현**

`lib/etf/etf-evidence-log.ts`의 `EtfEvidenceLogEntry`에 추가:

```ts
  failedSources: string[]
  // 2026-09-20: KRX 응답 기준일과 세션 판정 — 발송 시각(08:10) 적정성 관측용. 옛 엔트리엔 없음.
  krxBasDd?: string | null
  krxSession?: 'prev-session' | 'stale' | 'none'
```

`scripts/run-etf.ts`의 수집 호출:

```ts
  const [etfData, macro, news] = await Promise.allSettled([
    collectAllEtfData(date),
    collectMacroContext(),
    collectNews(),
  ])

  const { quotes, flows, investorFlows, krx } = etfData.status === 'fulfilled'
    ? etfData.value
    : { quotes: [], flows: [], investorFlows: [], krx: { basDd: null, session: 'none' as const } }
```

`appendEtfEvidenceLog({ … })` 호출의 `failedSources` 다음 줄에:

```ts
    krxBasDd: krx.basDd,
    krxSession: krx.session,
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/etf-evidence-log.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add scripts/run-etf.ts lib/etf/etf-evidence-log.ts lib/etf/etf-evidence-log.test.ts
git commit -m "ETF 파이프라인에 리포트 날짜 전달, evidence 로그에 KRX 세션 판정 기록"
```

### Task 6: ETF `FORCE_REGENERATE` 연결

> 개정(2026-09-21): 백업 schedule을 둘로 나누고 `github.event.schedule`로 job을 분기하던 원안은 폐기했다
> (GitHub schedule이 09시대에 발화해 개장 전 백업으로 쓸 수 없음 — spec 3절 개정 참조).
> `on.schedule`과 job `if`는 바꾸지 않는다. 트리거 분리는 cron-job.org의 `inputs.only`로만 한다.

**Files:**
- Modify: `.github/workflows/daily-report.yml` (ETF "Run ETF pipeline" step의 `env:`, 파일 상단 주석)
- Test: `lib/workflow-triggers.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가** — `lib/workflow-triggers.test.ts` 끝에

```ts
test("ETF 파이프라인 step에도 FORCE_REGENERATE가 전달된다", () => {
  assert.match(jobBlock("etf"), /FORCE_REGENERATE: \$\{\{ inputs\.force_regenerate == true && 'true' \|\| 'false' \}\}/);
});

test("schedule과 job 분기 조건은 그대로다 — 트리거 분리는 inputs.only로만", () => {
  assert.match(yml, /- cron: '30 22 \* \* 0-4'/);
  assert.equal((yml.match(/- cron:/g) ?? []).length, 1);
  assert.match(jobBlock("market"), /if: \$\{\{ inputs\.only != 'etf' \}\}/);
  assert.match(jobBlock("etf"), /if: \$\{\{ always\(\) && inputs\.only != 'market' \}\}/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts`
Expected: FAIL (FORCE_REGENERATE 테스트 1건)

- [ ] **Step 3: 워크플로 수정**

ETF "Run ETF pipeline" step의 `env:`에 한 줄 추가(`ETF_PUBLIC_BASE_URL` 아래):

```yaml
          FORCE_REGENERATE: ${{ inputs.force_regenerate == true && 'true' || 'false' }}
```

파일 상단 주석 2행 `# Runs at 06:30 KST on weekdays. Two sequential jobs:` →
`# Market runs at 06:40 KST, ETF at 08:10 KST on weekdays (cron-job.org dispatch, inputs.only). Two jobs:`

`on.schedule` 주석에 한 줄 추가: `# 개장 전 백업은 cron-job.org 2차 트리거(07:20 market, 08:35 etf)가 맡는다. 이 schedule은 3순위.`

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/daily-report.yml lib/workflow-triggers.test.ts
git commit -m "ETF 강제 재생성 입력 연결, 트리거 설명 주석 갱신"
```

### Task 7: 발행 시각 문구

**Files:**
- Modify: `lib/etf/claude-client.ts:240`, `:351`
- Modify: `README.md:3`, `:9`, `:65`, `:166-192` (트리거 설명)

- [ ] **Step 1: 프롬프트 문구 교체**

`lib/etf/claude-client.ts:240`
`- 발행 시각: 매일 **06:30 KST** (한국 증시 개장 전). 독자는 막 잠에서 깬 한국 개인 투자자입니다.` →
`- 발행 시각: 매일 **한국 증시 개장(09:00) 전** 아침. 독자는 개장을 준비하는 한국 개인 투자자입니다.`

`lib/etf/claude-client.ts:351`
`이 헤드라인은 06:30 KST 한국 개인투자자가 가장 먼저 만나는 한 줄입니다.` →
`이 헤드라인은 개장 전 한국 개인투자자가 가장 먼저 만나는 한 줄입니다.`

- [ ] **Step 2: 잔재 확인**

Run: `grep -n "06:30" lib/etf/claude-client.ts`
Expected: 출력 없음

- [ ] **Step 3: README 갱신** — 발송 시각 설명을 "Market 06:40 KST · ETF 08:10 KST"로, cron-job.org 표에 ETF 작업 행(`10 8 * * 1-5`, body `{"ref":"main","inputs":{"only":"etf"}}`)과 기존 작업 body(`{"ref":"main","inputs":{"only":"market"}}`)를 반영하고, ETF를 08:10으로 옮긴 이유 한 단락(“KRX OpenAPI 전일 데이터 게시 시각”)을 추가한다. 백업 schedule 설명을 두 cron으로 고친다.

- [ ] **Step 4: 전체 검증 후 커밋**

```bash
npx tsx --test lib/*.test.ts lib/etf/*.test.ts && npx tsc --noEmit
git add lib/etf/claude-client.ts README.md
git commit -m "ETF 발행 시각 문구를 '개장 전'으로 일반화, README 트리거 설명 갱신"
```

### Task 8: Phase 2 배포·전환 (수동, 사용자 승인 필요 — 하루 안에 끝낼 것)

- [ ] **Step 1:** 거래일 오후에 사용자 승인 후 `feat/etf-data-accuracy`를 main에 `--no-ff` 머지, 전체 테스트·tsc 확인, push.
- [ ] **Step 2:** 실데이터 검증 — `gh workflow run daily-report.yml -f only=etf -f dry_run=true -f force_regenerate=true` (발송·커밋 없음). 로그에서 확인:
  `[etf-data] KRX BAS_DD=<직전 거래일> 기대=<직전 거래일> → prev-session`, `[validate] 수집 성공`, market job `skipped`·etf job `success`.
- [ ] **Step 3:** 사용자가 cron-job.org에서 4개 작업을 설정(모두 월~금·Asia/Seoul·같은 URL·PAT): 마켓 06:40(기존 수정)·07:20(신규) body `{"ref":"main","inputs":{"only":"market"}}`, ETF 08:10(관측으로 확정)·08:35(신규) body `{"ref":"main","inputs":{"only":"etf"}}`. **Step 1과 같은 날** 끝낸다. `krx-probe` 제거(Step 5)를 먼저 해 2차 dispatch에서 probe가 다시 돌지 않게 한다.
- [ ] **Step 4:** 다음 3거래일 아침 확인 — 06:40 run은 market만, 08:10 run은 etf만 실행. ETF 로그 `→ prev-session`, 도착 시각, `data/etf-evidence-log.json`의 `krxSession`. `stale`이 반복되면 발송 시각을 늦춘다.
- [ ] **Step 5:** 관측 job 제거 — `krx-probe` job, `scripts/probe-krx-publish.ts`, `lib/workflow-triggers.test.ts`의 krx-probe 테스트 3개, `probeDeadlinePassed`와 그 테스트를 삭제하고 커밋.
- [ ] **되돌리기:** cron-job.org 두 작업을 원래대로(06:40 body `{"ref":"main"}`, 08:10 작업 비활성) 돌리고 머지 커밋을 revert.
