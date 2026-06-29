# 개장 전 시점 프레이밍 가드 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (또는 subagent-driven-development)로 태스크 단위 구현. 단계는 체크박스(`- [ ]`).

**Goal:** 개장 전 생성되는 market(및 ETF) 리포트가 직전 영업일 종가를 "오늘 마감"으로 오라벨링하지 않도록, 지수 데이터에 실제 세션 날짜+갭(간밤/지난 금요일)을 상시 명시하고 월요일 리듬을 전방위로 재구성한다.

**Architecture:** 순수 헬퍼 `describeSessionRecency`(갭→시점 표현, market-calendar)와 프롬프트 블록 빌더 `buildTemporalFramingBlock`(신규 모듈, market/etf 변형)을 추가하고, market `claude-client.ts`의 휴장 게이트 calendarBlock 정상일 경로(현재 빈 문자열)에 상시 블록을 주입. `weekday-rhythm.ts` 월요일 market 텍스트를 인과 날조 방지형으로 교체. ETF는 동일 빌더의 경량 변형을 정상일 경로에 적용.

**Tech Stack:** TypeScript, node:test + assert/strict (tsx 실행), 기존 `lib/market-calendar.ts` 헬퍼.

**스펙:** `docs/superpowers/specs/2026-06-29-preopen-temporal-framing-design.md`

---

### Task 1: `describeSessionRecency` 헬퍼 (market-calendar)

**Files:**
- Modify: `lib/market-calendar.ts` (익스포트 추가, 파일 끝)
- Test: `lib/market-calendar.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `lib/market-calendar.test.ts` 끝에 추가

```ts
import { getMarketCalendarInfo, isYearCovered, describeSessionRecency } from "./market-calendar";
// (위 import 라인의 기존 것을 이 형태로 확장)

test("describeSessionRecency: 화요일(갭1) → KR '전 거래일', US '간밤'", () => {
  const info = getMarketCalendarInfo("2026-06-30"); // 화, prev=06-29(월)
  const kr = describeSessionRecency("2026-06-30", info.krPrevTradingDay, "kr");
  assert.equal(kr.gapDays, 1);
  assert.match(kr.phrase, /전 거래일/);
  const us = describeSessionRecency("2026-06-30", info.usPrevTradingDay, "us");
  assert.equal(us.gapDays, 1);
  assert.match(us.phrase, /간밤/);
});

test("describeSessionRecency: 월요일(갭3) → 양쪽 '지난 금요일', '간밤' 불포함", () => {
  const info = getMarketCalendarInfo("2026-06-29"); // 월, prev=06-26(금)
  const kr = describeSessionRecency("2026-06-29", info.krPrevTradingDay, "kr");
  assert.equal(kr.gapDays, 3);
  assert.match(kr.phrase, /지난 금요일/);
  const us = describeSessionRecency("2026-06-29", info.usPrevTradingDay, "us");
  assert.equal(us.gapDays, 3);
  assert.match(us.phrase, /지난 금요일/);
  assert.doesNotMatch(us.phrase, /간밤/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: FAIL — `describeSessionRecency is not a function` (또는 export 없음)

- [ ] **Step 3: 구현** — `lib/market-calendar.ts` 끝(`describeMarketCalendar` 뒤)에 추가

```ts
const KR_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function koreanWeekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return KR_WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/**
 * 리포트 날짜와 직전 영업일 사이의 '시점 표현'을 결정한다.
 * gap=1(어제) → 간밤/전 거래일, gap>1(주말·연휴) → 실제 요일 명시.
 * 결정론적 순수 함수 (TZ 무관).
 */
export function describeSessionRecency(
  reportDate: string,
  prevTradingDay: string,
  market: "kr" | "us"
): { gapDays: number; phrase: string; weekday: string } {
  const gapDays = calendarDaysBetween(prevTradingDay, reportDate);
  const weekday = koreanWeekday(prevTradingDay);
  let phrase: string;
  if (gapDays === 1) {
    phrase = market === "kr"
      ? `전 거래일(어제, ${prevTradingDay})`
      : `간밤(${prevTradingDay} 현지 마감)`;
  } else {
    phrase = `지난 ${weekday}요일(${prevTradingDay})`;
  }
  return { gapDays, phrase, weekday };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: PASS (신규 2건 포함)

- [ ] **Step 5: 커밋**

```bash
git add lib/market-calendar.ts lib/market-calendar.test.ts
git commit -m "feat: describeSessionRecency — 갭 인지 시점 표현 헬퍼 (간밤 vs 지난 금요일)"
```

---

### Task 2: `buildTemporalFramingBlock` 프롬프트 블록 빌더 (신규 모듈)

**Files:**
- Create: `lib/temporal-framing.ts`
- Test: `lib/temporal-framing.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `lib/temporal-framing.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketCalendarInfo } from "./market-calendar";
import { buildTemporalFramingBlock } from "./temporal-framing";

test("market 월요일 블록: 지난 금요일 명시 + '오늘 마감' 금지 문구", () => {
  const info = getMarketCalendarInfo("2026-06-29"); // 월
  const block = buildTemporalFramingBlock(info, "market");
  assert.match(block, /개장 전/);
  assert.match(block, /지난 금요일/);
  assert.match(block, /오늘 코스피/);      // "...라고 쓰지 말 것" 금지 지시 포함
  assert.match(block, /비거래일/);          // 갭>1 안내
});

test("market 화요일 블록: 전 거래일/간밤, 갭 경고 없음", () => {
  const info = getMarketCalendarInfo("2026-06-30"); // 화
  const block = buildTemporalFramingBlock(info, "market");
  assert.match(block, /전 거래일/);
  assert.match(block, /간밤/);
  assert.doesNotMatch(block, /비거래일/);
});

test("etf 변형은 경량 — KR 단정 가드는 생략(베이스라인 보유)", () => {
  const info = getMarketCalendarInfo("2026-06-29");
  const block = buildTemporalFramingBlock(info, "etf");
  assert.match(block, /지난 금요일/);       // 갭 보강은 포함
  assert.doesNotMatch(block, /오늘 코스피/); // market 전용 KR 가드는 미포함
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/temporal-framing.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `lib/temporal-framing.ts`

```ts
// lib/temporal-framing.ts
// 개장 전 브리핑의 '시점 프레이밍' 블록 — market·ETF 공유.
// 지수 데이터가 직전 영업일 종가임을 갭 인지(간밤 vs 지난 금요일)로 명시한다.

import type { MarketCalendarInfo } from "./market-calendar";
import { describeSessionRecency } from "./market-calendar";

/**
 * 양국 정상 거래일에 항상 주입하는 시점 프레이밍.
 * market: KR/US 양쪽 시점 명시 + "오늘 마감" 단정 금지.
 * etf: overnight 베이스라인을 이미 가지므로 갭 보강만(경량).
 */
export function buildTemporalFramingBlock(
  info: MarketCalendarInfo,
  reportType: "market" | "etf"
): string {
  const kr = describeSessionRecency(info.date, info.krPrevTradingDay, "kr");
  const us = describeSessionRecency(info.date, info.usPrevTradingDay, "us");
  const gapWarn = us.gapDays > 1 || kr.gapDays > 1;

  if (reportType === "etf") {
    // ETF는 시스템 프롬프트가 "발행=개장 전, 전일 국내/간밤 해외"를 이미 명시.
    // 월요일 등 갭 발생 시 '간밤' 오용만 차단.
    const gapLine = gapWarn
      ? `\n- ⚠️ 직전 미국 세션은 ${us.phrase}입니다. "간밤"이 아니라 "${us.phrase}"로 명시하고, 그 사이 뉴스는 "오늘 개장 시 반영될 변수"로 서술하십시오.`
      : "";
    return `\n## ⏰ 시점 기준 (개장 전 브리핑)\n- 미국 데이터: ${us.phrase} 종가. 한국 ETF 데이터: ${kr.phrase} 종가.${gapLine}\n`;
  }

  // market — 베이스라인 프레이밍이 없으므로 상시 명시 + 단정 금지.
  const gapBlock = gapWarn
    ? `\n4. 직전 거래일과 오늘 사이 비거래일(주말·휴일)이 있습니다. 그 사이 발생한 뉴스는 **"오늘 개장 시 반영될 변수 / 이번 주 관전 포인트"**로 서술하고, **직전 종가가 이미 반영한 것처럼 쓰지 마십시오.**`
    : "";
  return `\n## ⏰ 시점 기준 — 개장 전 브리핑 (반드시 반영)
- 이 리포트는 ${info.date}(${koreanDow(info.date)}) **한국 장 개장(09:00) 전**에 작성된 **개장 전 브리핑**입니다.
1. 코스피·코스닥·원/달러 등 **한국 지수 데이터는 ${kr.phrase} 종가**입니다. "오늘 코스피가 X로 마감했다", "서울 장이 열리자마자" 같은 **오늘 세션 단정 금지** — 오늘 한국 장은 아직 시작도 안 했습니다.
2. S&P500·나스닥·다우·VIX·미 10Y 등 **미국 지수 데이터는 ${us.phrase} 종가**입니다.
3. 정확한 표현: "${kr.phrase} 종가 기준", "${us.phrase} 마감 기준".${gapBlock}
`;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function koreanDow(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/temporal-framing.test.ts`
Expected: PASS (3건)

- [ ] **Step 5: 커밋**

```bash
git add lib/temporal-framing.ts lib/temporal-framing.test.ts
git commit -m "feat: buildTemporalFramingBlock — 개장 전 시점 프레이밍 블록 (market/etf 변형)"
```

---

### Task 3: market 프롬프트에 상시 시점 블록 주입

**Files:**
- Modify: `lib/claude-client.ts:283-311` (calendarBlock)

- [ ] **Step 1: import 추가** — `lib/claude-client.ts` 상단 import 영역

```ts
import { buildTemporalFramingBlock } from "./temporal-framing";
```

- [ ] **Step 2: calendarBlock 정상일 경로 교체** — 현재 IIFE의 조기반환

기존:
```ts
  const calendarBlock = (() => {
    const info = ctx.calendarInfo;
    if (!info || (!info.isKrClosedOnly && !info.isUsClosedOnly)) return "";
    if (info.isKrClosedOnly) {
```
변경:
```ts
  const calendarBlock = (() => {
    const info = ctx.calendarInfo;
    if (!info) return "";
    if (info.isKrClosedOnly) {
```
그리고 같은 IIFE 끝(미국 휴장 분기 `return ...` 뒤, 닫는 `})()` 직전)에 정상일 분기를 추가:
```ts
    // isUsClosedOnly 분기 끝난 뒤
    if (info.isDualClosed) return ""; // 양국 휴장(cron 미발화) — 비목표
    // 양국 정상: 개장 전 시점 프레이밍 상시 주입 (신규)
    return buildTemporalFramingBlock(info, "market");
  })();
```
주의: 기존 `if (info.isUsClosedOnly)` 분기가 `return` 으로 끝나는지 확인하고, 끝나지 않으면 `return` 형태로 정리(원문 텍스트는 보존).

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 블록 주입 확인 (수동)** — 월요일 데이터로 프롬프트에 "개장 전"·"지난 금요일"이 들어가는지 1줄 확인

Run:
```bash
npx tsx -e "import {getMarketCalendarInfo} from './lib/market-calendar'; import {buildTemporalFramingBlock} from './lib/temporal-framing'; console.log(buildTemporalFramingBlock(getMarketCalendarInfo('2026-06-29'),'market'))"
```
Expected: "개장 전 브리핑"·"지난 금요일(2026-06-26)"·"오늘 코스피...금지" 포함 출력

- [ ] **Step 5: 커밋**

```bash
git add lib/claude-client.ts
git commit -m "feat: market 프롬프트 — 휴장 게이트 calendarBlock에 정상일 상시 시점 블록 추가"
```

---

### Task 4: weekday-rhythm 월요일 market 재구성

**Files:**
- Modify: `lib/weekday-rhythm.ts:34-38`
- Test: `lib/weekday-rhythm.test.ts` (신규)

- [ ] **Step 1: 실패 테스트 작성** — `lib/weekday-rhythm.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeWeekdayRhythm, getWeekdayRole } from "./weekday-rhythm";

test("월요일 market 리듬: 주말뉴스를 '오늘 원인'이 아니라 '개장 시 변수'로", () => {
  const block = describeWeekdayRhythm("monday_setup", "market");
  assert.match(block, /개장 시|관전 포인트|이번 주/);   // 전방위 프레이밍
  assert.doesNotMatch(block, /주말 뒤 시작/);            // 옛 인과 유도 제거
});

test("월요일 etf 리듬: overnight 설계와 정합 — 현행 유지(주말 해외 흐름)", () => {
  const block = describeWeekdayRhythm("monday_setup", "etf");
  assert.match(block, /주말/);
});

test("getWeekdayRole: 2026-06-29는 monday_setup", () => {
  assert.equal(getWeekdayRole("2026-06-29"), "monday_setup");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/weekday-rhythm.test.ts`
Expected: FAIL — 첫 테스트가 "주말 뒤 시작" 매칭으로 실패

- [ ] **Step 3: 구현** — `monday_setup` market 분기 교체

기존:
```ts
  if (role === "monday_setup") {
    const extra = reportType === "market"
      ? "주말 사이 발생한 해외 뉴스·정책 변화를 본문 앞부분에서 한 단락으로 정리하고, 이번 주 관전 포인트(주요 발표·결정 일정) 를 watchPoints 또는 caleandar 에서 강조."
      : "주말 사이 미국·유럽 시장 변동과 환율 야간 흐름을 bigPicture 첫 문장에 녹이고, 이번 주 관전 ETF군(반도체·환노출·채권 등 중 한 그룹) 을 closingLine 으로 명시."
    return `\n[요일 리듬 — 월요일 셋업]\n- 오늘은 한 주의 첫 영업일입니다. ${extra}\n- 헤드라인은 "주말 뒤 시작" 의 의미가 묻어나도록.\n`
  }
```
변경:
```ts
  if (role === "monday_setup") {
    if (reportType === "market") {
      return `\n[요일 리듬 — 월요일 셋업]\n- 오늘은 한 주의 첫 영업일이며, 지수 데이터는 지난 금요일 종가 기준이고 오늘 한국 장은 아직 개장 전입니다.\n- 주말 사이 발생한 해외 뉴스·정책 변화는 "오늘 개장 시 반영될 변수 / 이번 주 관전 포인트"로 서술하십시오. 직전 종가가 이미 반영한 원인처럼 쓰지 마십시오.\n- 이번 주 관전 포인트(주요 발표·결정 일정)를 watchPoints 또는 calendar 에서 강조.\n- 헤드라인은 "한 주의 시작" 톤이되, 일어나지 않은 오늘 장의 움직임을 단정하지 마십시오.\n`
    }
    // etf — overnight 브리핑 설계와 정합(주말 해외 흐름이 주된 데이터). 현행 유지.
    return `\n[요일 리듬 — 월요일 셋업]\n- 오늘은 한 주의 첫 영업일입니다. 주말 사이 미국·유럽 시장 변동과 환율 야간 흐름을 bigPicture 첫 문장에 녹이고, 이번 주 관전 ETF군(반도체·환노출·채권 등 중 한 그룹) 을 closingLine 으로 명시.\n- 헤드라인은 "주말 뒤 시작" 의 의미가 묻어나도록.\n`
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/weekday-rhythm.test.ts`
Expected: PASS (3건)

- [ ] **Step 5: 커밋**

```bash
git add lib/weekday-rhythm.ts lib/weekday-rhythm.test.ts
git commit -m "fix: 월요일 market 리듬 — 주말뉴스를 '오늘 원인' 아닌 '개장 시 변수'로 (인과 날조 차단)"
```

---

### Task 5: ETF 프롬프트에 경량 시점 블록 주입

**Files:**
- Modify: `lib/etf/claude-client.ts:188-210` (calendarBlock)

- [ ] **Step 1: import 추가** — `lib/etf/claude-client.ts` 상단

```ts
import { buildTemporalFramingBlock } from '../temporal-framing'
```

- [ ] **Step 2: calendarBlock 정상일 경로 교체** — `:190` 조기반환

기존:
```ts
  const calendarBlock = (() => {
    if (!cal || (!cal.isKrClosedOnly && !cal.isUsClosedOnly)) return ''
    if (cal.isKrClosedOnly) {
```
변경:
```ts
  const calendarBlock = (() => {
    if (!cal) return ''
    if (cal.isKrClosedOnly) {
```
미국 휴장 분기 `return` 뒤, IIFE 닫기 직전:
```ts
    if (cal.isDualClosed) return ''
    return buildTemporalFramingBlock(cal, 'etf')
  })()
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 커밋**

```bash
git add lib/etf/claude-client.ts
git commit -m "feat: ETF 프롬프트 — 정상일 경량 시점 블록(월요일 US '간밤' 갭 보강)"
```

---

### Task 6: 전체 검증 + 백필 비교

**Files:** (수정 없음 — 검증)

- [ ] **Step 1: 전체 타입체크 + 단위 테스트**

Run:
```bash
npx tsc --noEmit && npx tsx --test $(find lib scripts -name "*.test.ts")
```
Expected: tsc exit 0; 테스트 전건 pass (기존 45 + 신규 8 ≈ 53)

- [ ] **Step 2: 6/29 백필 재생성 (월요일 경로 실증)** — 오늘 스냅샷으로 market 재생성, 새 프레이밍 확인

> ⚠️ **로컬 키 의존성**: 백필은 실제 Claude 호출이라 `.env.local`의 `ANTHROPIC_API_KEY`가 **유효해야** 한다. 6/23 교체는 GitHub 시크릿만 갱신했을 수 있어 로컬 키가 stale(401)이면 이 스텝은 실패한다. 그 경우 **이 라이브 백필은 건너뛰고** 결정론적 단위테스트(Task 1·2·4)로 로직을 보증한 뒤, 머지 후 **내일 6/30 라이브**로 최종 확인한다(화요일 gap=1 경로). 월요일 gap>1 경로는 단위테스트(Task 1·2)가 이미 커버.

Run (FORCE_REGENERATE로 오늘 자 덮어쓰지 않도록 별도 출력/드라이런 경로 사용 — 발송·커밋 없이 콘텐츠만):
```bash
DISABLE_CONTEXT=false FORCE_REGENERATE=true npx tsx scripts/run.ts 2>&1 | tail -5
```
그 후 생성된 `public/reports/2026-06-29.html`에서 시점 표현 확인:
```bash
git show :public/reports/2026-06-29.html 2>/dev/null; python3 - <<'PY'
import re,html
t=open('public/reports/2026-06-29.html',encoding='utf-8').read()
t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t)
for kw in ['오늘 ... 마감','서울 장이 열리자마자','주말 뒤 첫 장','지난 금요일','개장 전']:
    pass
print('\n'.join(l.strip() for l in t.split('\n') if any(k in l for k in ['지난 금요일','개장 전','서울 장이 열리자마자','주말 뒤','마감'])))
PY
```
Expected: "지난 금요일 종가 기준" 류 등장, "서울 장이 열리자마자 ... 마감" / "주말 뒤 첫 장" **사라짐**.
> ⚠️ 백필이 오늘 자 산출물을 덮어쓰므로, 검증 후 `git checkout`/`git stash`로 **워킹트리 변경을 되돌려** 라이브 데이터를 보존할 것(이 브랜치엔 콘텐츠 산출물을 커밋하지 않는다).

- [ ] **Step 3: 워킹트리 정리 확인**

Run: `git status --short`
Expected: `lib/` 변경만 커밋됨, `public/`·`data/` 산출물 미스테이징/되돌림 상태(클린).

- [ ] **Step 4: finishing-a-development-branch 진입**

REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch — 테스트 통과 확인 후 옵션 제시(main 머지 후보).

---

## 자체 검토 (writing-plans self-review)
- **스펙 커버리지**: ① 상시 가드=Task 3, ② 갭 인지=Task 1·2, ③ 월요일 리듬=Task 4, ④ ETF=Task 5, ⑤ 테스트=Task 1·2·4·6. 전부 매핑됨.
- **Placeholder**: 없음 — 모든 코드 단계에 실제 코드/명령/기대출력 포함.
- **타입 일관성**: `describeSessionRecency`(Task 1) 반환 `{gapDays,phrase,weekday}`를 Task 2 `buildTemporalFramingBlock`에서 소비; `MarketCalendarInfo` 필드(krPrevTradingDay 등)는 Task 1 검증·Task 2/3/5 소비로 일관.
- **비목표 보존**: 휴장 분기 텍스트 무변경(Task 3/5는 정상일 경로만 추가), dual-closed는 `return ''` 유지.
