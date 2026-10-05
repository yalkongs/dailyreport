# 마켓 리포트 정책금리 사실 블록 — 설계

- 작성: 2026-10-05
- 브랜치: `feat/policy-rate-block`
- 범위: **마켓 리포트만**. ETF는 묶음 3의 10거래일 관찰(10-01~)이 끝난 뒤 같은 모듈을 붙이는 후속 과제로 남긴다.

## 1. 문제

마켓 리포트가 금리 **인상** 국면을 **인하** 국면으로 서술한다.

- 실제 상황(웹으로 검증함):
  - 연준은 2026-09-16에 25bp를 올렸다. 목표범위는 3.75~4.00%이고, 2023년 이후 첫 인상이다. 연내 추가 인상 가능성도 시사했다.
  - 한국은행은 2026-07-16과 08-27에 연속으로 올렸다. 기준금리는 연 3.00%다.
- 리포트 실측:
  - 07-17 이후 마켓 리포트 52일 중 31일에 '인하 기대·추가 인하·인하 시점/속도/여력' 같은 표현이 69회 나왔다. 정규식으로 센 상한치다.
  - 08-28 리포트는 한은이 금리를 올린 다음 날 "시장이 인하 방향을 반영했다"고 썼다.
  - ETF 리포트는 같은 기간 3일, 5회다.

### 원인
1. **정책금리 방향을 알려주는 입력이 없다.**
   - `lib/fred-data.ts`: FEDFUNDS(월평균)를 1건(`limit=1`)만 가져온다. 변화폭과 결정일이 없다.
   - `lib/ecos-data.ts`: 국고채 3년물과 10년물만 가져온다. 한은 기준금리는 없다.
   - 그런데 `lib/claude-client.ts`의 compass 규칙은 '기준금리' 비교를 지시한다. 데이터가 빈 자리를 모델이 학습 시점의 상식(완화 사이클)으로 채운다.
2. **프롬프트에 '인하' 전제가 박혀 있다.**
   - `lib/claude-client.ts` 좋은 글 예시: "각국 중앙은행이 금리 인하를 준비하던 바로 그 순간"
   - `lib/sideways-detector.ts` 딥다이브 주제: "미국 금리 인하가 진짜 시작되면 무슨 일이 벌어지나"

## 2. 목표와 성공 기준

- 모델이 정책금리의 수준과 국면을 **추론하지 않고 입력에서 읽도록** 한다.
- 성공 기준
  - 머지 후 10거래일 동안 마켓 리포트의 인하 전제 표현이 국면 라벨과 어긋나는 사례가 0~1건이다. soft-warn 로그와 아카이브 재집계로 확인한다.
  - 블록 값이 실제 정책금리와 일치한다. 첫 run 로그에서 확인한다.
  - 수집이 실패해도 생성은 멈추지 않는다.

## 3. 설계

### 3.1 데이터 모듈 `lib/policy-rate.ts` (신규)

**수집: `collectPolicyRates(): Promise<PolicyRates>`**
- 미 연준
  - FRED API `series/observations`에서 `DFEDTARU`(상단)와 `DFEDTARL`(하단)을 가져온다.
  - 기간은 `observation_start = 오늘 − 3년`, 정렬은 오름차순이다.
  - 키는 기존 `FRED_API_KEY`를 쓴다.
- 한국은행
  - ECOS `StatisticSearch/{key}/json/kr/1/2000/722Y001/D/{from}/{to}/0101000`(일별)을 가져온다. 기간은 3년이다.
  - 키는 기존 `ECOS_API_KEY`를 쓴다.
  - 행 수 상한(요청 구간 1~2000)이 3년치 일별(약 1,100행)을 덮는지 구현 때 확인한다. 부족하면 월별(M) 주기로 바꾼다.
- 두 소스는 서로 독립적으로 `Promise.allSettled` 한다. 각 요청의 타임아웃은 10초다(기존 `fetchWithTimeout`).
- 키가 없거나 응답이 비면 해당 소스는 `null`이다.

**요약: `summarizePolicyRate(points, today): PolicyRateSummary | null`** (순수 함수)
- 입력은 날짜 오름차순 `{ date, value }[]`다. 연준은 상단값으로 변경을 판정하고, 표시는 "하단~상단"으로 한다.
- 연속한 두 점의 값이 다르면 그 날짜를 변경 시점으로 본다. 결측(`.`)과 NaN은 건너뛴다.
- 출력
  - `current`: 현재 수준
  - `lastChange`: 최근 변경 `{ date, delta }`. 3년 안에 변경이 없으면 `null`
  - `prevChange`: 직전 변경 `{ date, delta }`. 없으면 `null`
  - `stance`: 국면 라벨(아래 규칙)
  - `asOf`: 마지막 관측일
- 국면 라벨 규칙
  - `lastChange`가 없음 → `"동결 지속(최근 3년 변경 없음)"`
  - `today − lastChange.date > 365일` → `"동결 지속(마지막 변경: 인상|인하 YYYY-MM-DD)"`
  - 그 밖의 경우 → `lastChange.delta > 0`이면 `"인상"`, 아니면 `"인하"`
  - 같은 방향 변경이 연속이면 `"인상(2회 연속)"`처럼 횟수를 붙인다. 셀 때는 최근부터 거슬러 올라가며 같은 방향이 이어지는 동안만 센다.
  - 연속이 1회이고 `prevChange`가 반대 방향이면 `"인상(인하→인상 전환)"`처럼 쓴다. 실제 연준이 이 경우다(2025-12 인하 → 2026-09 인상).
- 날짜 의미: FRED 목표범위 날짜는 **효력 발생일**이라 FOMC 발표 다음 날이다(예: 발표 2026-09-16 → `2026-09-17`). 블록에는 "효력일"이라고 명시해 발표일과 혼동하지 않게 한다. ECOS 일별 날짜도 같은 원칙으로 "효력일"로 표기한다.
- 지연 경고: `today − asOf > 7일`이면 해당 소스는 오래된 데이터로 보고 버린다(`null`). 과거 수준을 현재 사실로 주입하지 않기 위해서다.

**타입 (`lib/types.ts`)**
```ts
export interface PolicyRateChange { date: string; delta: number }
export interface PolicyRateSummary {
  label: string;            // "미 연준 목표범위" | "한국은행 기준금리"
  currentText: string;      // "3.75~4.00%" | "3.00%"
  current: number;          // 판정용(연준은 상단)
  lastChange: PolicyRateChange | null;
  prevChange: PolicyRateChange | null;
  stance: string;
  stanceDirection: "hike" | "cut" | "hold";
  asOf: string;
}
export interface PolicyRates { fed: PolicyRateSummary | null; bok: PolicyRateSummary | null }
```
- `ContextData`에 `policyRates: PolicyRates`를 추가한다. 기존 `fredIndicators`(FEDFUNDS 월평균 등)는 그대로 둔다.

### 3.2 컨텍스트 수집 연결 (`lib/context-data.ts`)
- 기존 `Promise.all` 묶음에 `collectPolicyRates()`를 추가한다. 실패하면 `errors.push({ source: "policy-rate", ... })`로 기록하고 `{ fed: null, bok: null }`을 쓴다.
- 로그 한 줄: `🏛️ 정책금리: 연준 3.75~4.00%(인상) / 한은 3.00%(인상(2회 연속))`. 어느 쪽이든 없으면 `없음`으로 찍는다.

### 3.3 프롬프트 (마켓만, `lib/claude-client.ts`)

**정책금리 블록**: `buildContextBlock`의 FRED 블록 바로 앞에 넣는다. 렌더 함수 `renderPolicyRateBlock(rates)`는 별도 export해서 테스트한다.
```
### 정책금리 (확정 사실 — 중앙은행 금리 방향 서술의 유일한 근거)
- 미 연준 목표범위: 3.75~4.00% — 최근 변경 2026-09-17(효력일) +0.25%p, 직전 변경 2025-12-11 −0.25%p
  → 현재 국면: 인상(인하→인상 전환)
- 한국은행 기준금리: 3.00% — 최근 변경 2026-08-27(효력일) +0.25%p, 직전 변경 2026-07-16 +0.25%p
  → 현재 국면: 인상(2회 연속)
```
- 두 소스가 모두 `null`이면 블록을 통째로 생략한다. 하나만 `null`이면 그 줄만 생략한다.

**규칙(C)**: 새 섹션을 만들지 않는다. 기존 "⛔ 허위 정보 생성 금지" 블록에 한 줄을 추가한다.
> - ❌ **중앙은행 금리 방향 추정 금지**: 연준·한은의 금리 국면(인상·인하·동결)과 '추가 인하/인상 기대' 같은 방향 서술은 [정책금리] 블록과 일치하게만 쓸 것. 블록이 없으면 국면·방향 서술을 생략하고 시장금리(국채 수익률) 변화만 서술할 것.

**박혀 있는 '인하' 표현 중립화(B)**
- `lib/claude-client.ts` 좋은 글 예시: "각국 중앙은행이 금리 인하를 준비하던 바로 그 순간" → "각국 중앙은행이 물가가 잡혔는지 확인하려던 바로 그 순간". 원유 → 인플레이션 논지는 유지한다.
- `lib/sideways-detector.ts` 딥다이브 주제: "미국 금리 인하가 진짜 시작되면 무슨 일이 벌어지나 — 시나리오 분석" → "미국 금리 경로가 바뀌면 무슨 일이 벌어지나 — 시나리오 분석"
- 다른 '인하' 고정 문구가 프롬프트 경로(`lib/*.ts`, ETF 제외)에 더 있는지 구현 때 grep으로 확인하고, 이 원칙으로 같이 정리한다.

### 3.4 측정: soft-warn (기록 전용)
- 순수 함수 `findPolicyDirectionMismatches(text, rates): string[]`
  - 어느 한 소스라도 `stanceDirection === "hike"`일 때, 본문에서 `/(금리 인하 기대|인하 기대|추가 (금리 )?인하|금리 인하 (시점|속도|여력|여지)|인하 방향)/` 매칭의 앞뒤 30자 발췌를 반환한다.
  - `"cut"`일 때는 인상 쪽 대칭 패턴을 쓴다.
- 생성 후 `generateReport`에서 `[soft-warn] 정책 방향 불일치 N건 (기록 전용)`과 발췌를 로그로 남긴다. 기각이나 재시도는 하지 않는다. "인하 기대가 사라졌다"처럼 정당한 문맥도 잡히기 때문이다.

## 4. 범위 밖
- ETF 리포트 적용(후속 과제)
- 다음 FOMC·금통위 일정, 시장 기대(FedWatch 등) 주입
- FEDFUNDS 월평균 제거와 FRED 캘린더 재검증(별도 과제 D)
- soft-warn을 hard 기각으로 승격하는 일(측정 후 판단)

## 5. 테스트
- `lib/policy-rate.test.ts`
  - `summarizePolicyRate`: 연속 인상(한은 2회), 전환(실제 연준 이력 2023-10~2026-10 fixture: 5.50→…→3.75→4.00, 기대 라벨 `인상(인하→인상 전환)`), 인하, 변경 후 365일 초과 동결, 3년 무변경, 결측/NaN 건너뛰기, 빈 배열 → `null`, `asOf` 7일 초과 → `null`
  - 연준 상하단 병합: 상단 기준 변경 판정, `currentText` 형식
  - `renderPolicyRateBlock`: 둘 다 있음, 하나만 있음, 둘 다 없음(빈 문자열) — 문자열 스냅샷
  - `findPolicyDirectionMismatches`: hike 상태에서 인하 표현 탐지, hold 상태 무탐지, 발췌 길이
- 기존 `market-prompt-freeze.test.ts`는 변경 없이 통과해야 한다(보이스·시점·요일 블록 불변).
- `tsc` clean과 전체 테스트 통과를 확인한다.
- 실데이터 확인: 로컬에는 FRED·ECOS 키가 없으므로 수집 경로는 머지 후 첫 run 로그로 확인한다. 파서는 구현 때 FRED 공개 CSV와 ECOS sample 키 응답으로 만든 fixture로 검증한다.

## 6. 운영 확인
- 머지 후 첫 거래일 마켓 run 로그에서 `🏛️ 정책금리:` 줄의 값이 실제와 맞는지 확인한다. 연준 3.75~4.00% `인상(인하→인상 전환)`, 한은 3.00% `인상(2회 연속)`이어야 한다. 한은 날짜는 ECOS 일별 응답으로 처음 확인하는 것이므로 07-16·08-27과 맞는지 함께 본다.
- 10거래일 뒤 인하 전제 표현을 다시 집계한다. 기준선은 52일 중 31일, 69회다. soft-warn 로그와 함께 본다.
