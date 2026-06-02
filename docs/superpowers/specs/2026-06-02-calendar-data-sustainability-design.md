# Sub-project A: 캘린더 데이터 정확성·지속가능성

작성일: 2026-06-02
상태: 설계 승인됨 (구현 계획 대기)
상위 감사: [2026-06-02-calendar-timezone-audit-findings.md](./2026-06-02-calendar-timezone-audit-findings.md)
브랜치: `calendar-timezone-fixes`

## 문제

`lib/market-calendar.ts`의 휴일 데이터가 단일 연도(2026) 정적 하드코딩이다. 두 결함:

1. **연도 staleness**: 2027년이 되면 휴일 맵이 비어 모든 평일이 `open`으로 판정된다.
   → KR 휴장일에 "오늘 코스피 개장" 리포트가 발송된다 (조용한 오발송).
2. **손 추출 누락**: 2026 목록도 손으로 추리다 5건 누락(05-01·06-03·07-17·08-17·10-05)했다.
   06-02 핫픽스(main `0fae252`)로 2026은 메웠으나 **근본 구조는 그대로**다.

이번에 발견된 형태: GitHub 스케줄 지연이 아니라 **데이터 정합성**. 잘못된 발송은
사용자 신뢰(README "사실 정합성")를 직접 해친다.

## 목표

휴일 데이터를 **지속가능**하게: 데이터가 낡으면 조용히 오발송하지 말고 **큰 소리로 실패**(안전망),
그리고 연 갱신을 깔끔하게.

## 비목표 (다른 sub-project)

- US 휴장 가드레일 하루 어긋남(H2)·KR 대칭(M1)·EU/JP/CN(M2) → **B**
- 24h 상품 신선도 태깅(M3)·marketState(M4) → **C**
- FRED 경제캘린더 쿼리(H3) → **D**
- 로컬시간 getDay 하드닝(LOW) → **E**
- 운영자 Telegram 알림 dead no-op(M5) → **F**

## 핵심 결정 (브레인스토밍 확정)

| 항목 | 결정 |
|------|------|
| 유지 모델 | 수동 연도 갱신 + 안전망 (외부 API 의존 안 함) |
| 안전망 발동 | 현재 KST 연도의 KR 휴일 데이터가 0건 = 데이터 낡음 |
| 안전망 동작 | 발송 차단 + **`exit(1)` → GitHub 네이티브 실패 이메일** (Telegram 배선 안 함) |
| KR/US 비대칭 | KR 미커버 → `exit(1)` 차단 / US 미커버 → `console.warn`만 (오발송 아님) |

알림 채널 근거: in-pipeline Telegram(sendError)은 생성 스텝 env 부재로 **프로덕션 무동작**(M5).
이를 살리는 대신, exit(1) 한 줄로 GitHub가 repo 소유자에게 자동 이메일을 보낸다(배선 0).
정상 휴장 skip은 `exit(0)`이라 이메일 안 옴 — **exit 코드 차이가 알림 메커니즘의 전부**.
추가 신호: 차단 시 리포트 미도착 → 운영자가 그날 아침 인지(이번 세션이 그렇게 시작됨).

## 구성 요소

### A1. 데이터 재구조 — `lib/market-calendar.ts`

연도별 맵으로 전환:
```ts
const KR_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [ /* 현재 핫픽스로 채운 2026 항목 그대로 이관 */ ],
};
const US_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [ /* 현재 항목 그대로 */ ],
};
```
- `KR_HOLIDAY_MAP`/`US_HOLIDAY_MAP`(`:78-79`)와 `getKrStatus`/`getUsStatus`(`:102-116`)를
  `KR_HOLIDAYS[year]?.find(h => h.date === date)` 조회로 소폭 수정. `year`는 `date.slice(0,4)`.
- **2026을 공식 KRX 공지(KIND)와 재대조**: 핫픽스가 추가한 07-17 제헌절은 국내 금융지 보도
  기준이었음 → 공식 휴장 공고로 확정/정정. 나머지 4건도 공식 목록과 일치 확인.
- 연 추가는 `2027: [...]` 키 하나 추가로 끝.

### A2. 커버리지 체크 — 순수 함수
```ts
export function isYearCovered(year: number, market: "kr" | "us"): boolean
```
- 데이터 맵 키 존재로 판정 (`year in KR_HOLIDAYS`).
- market-calendar.ts는 **순수 유지** — `process.exit`·`console` 없음. I/O는 호출 스크립트가 담당.

### A3. Fail-loud 안전망 — `scripts/run.ts` · `scripts/run-etf.ts`

KST 날짜 확보 직후, **Claude 생성 전**에 배치:
- `run.ts`: `marketData.date` 확보 후(Step 1 직후, 중복 가드 이전).
- `run-etf.ts`: `date` 계산(`:53`) 직후, 중복 가드 이전.

로직:
```ts
const year = Number(date.slice(0, 4));
if (!isYearCovered(year, "kr")) {
  console.error(`❌ ${year} KR 휴일 데이터 없음 — lib/market-calendar.ts 갱신 필요. 안전을 위해 발송 중단.`);
  process.exit(1);   // → GitHub 스케줄 실패 → 자동 이메일
}
if (!isYearCovered(year, "us")) {
  console.warn(`⚠️ ${year} US 휴일 데이터 없음 — 미국 휴장 가드레일(sub-project B) 저하. 발송은 계속.`);
}
```
- 정상 휴장 skip(기존 `krStatus !== "open"` → `exit(0)`)과 **exit 코드로 구분**.

### A4. 테스트 — `lib/market-calendar.test.ts` (신설, `node:test` + `tsx`)

- **회귀**: 2026 휴장일 — 핫픽스 5건(05-01·06-03·07-17·08-17·10-05) + 기존 주요 휴일 →
  `getMarketCalendarInfo(d).krStatus === "closed_holiday"`. 정상 영업일(06-02·06-04) → `"open"`.
- **커버리지**: `isYearCovered(2026,"kr") === true`, `isYearCovered(2099,"kr") === false`.
- 실행: `npx tsx --test lib/market-calendar.test.ts` (프로젝트 관행: CI 테스트 스텝 없음·수동).

### A5. 연 갱신 프로세스 + 리마인더

- `README.md`(또는 `market-calendar.ts` 상단 주석)에 절차 문서화:
  "매년 연말, 공식 KRX 휴장 공고에서 다음 해 KR·US 휴일을 `KR_HOLIDAYS`/`US_HOLIDAYS`에 추가."
- 연말 리마인더 → 출시 후 `/schedule` 후보(예: 2026-12-01에 "2027 휴일 추가" 알림).
  안전망(A3)이 누락을 막는 backstop이므로 리마인더는 보조.

## 검증 계획 ("done = 실제로 됨")

1. `npx tsx --test lib/market-calendar.test.ts` 전부 통과 (회귀 + 커버리지).
2. 안전망 수동 검증: 임시로 미존재 연도 날짜로 `isYearCovered` false → 스크립트가 exit(1) 내는지
   (예: `TEST_DATE=2099-01-05`로 run 경로 진입 시 exit code 1 확인, dry 모드).
3. 정상 영업일/휴장일 동작 불변 확인 (06-02 정상 발송 경로, 06-03 휴장 skip exit(0)).
4. 기존 테스트 스위트 회귀 없음.

## 범위·작업 성격

타이트하게 유지: 데이터 재구조 + 커버리지 체크 + exit(1) 안전망 + 테스트. Telegram·가드레일·
FRED는 전부 별 sub-project. 코드 변경은 market-calendar.ts(재구조+커버리지) + run.ts·run-etf.ts
(안전망 ~5줄씩) + 테스트 파일. 워크플로 변경 없음.
