# 캘린더 B — US 단독 휴장 시 시점 프레이밍 통합

> 캘린더 감사 sub-project B(휴일 인지 서사 가드레일)의 잔여. H2·M1 핵심은 2026-06-29 시점-프레이밍 작업(`cbcfde3`)이 이미 닫음(실측 확인). 이 스펙은 **남은 한 곳**만 닫는다.

## 1. 잔여 진단 (실측 기반)
- run.ts/run-etf.ts 정책: **한국 휴장이면 생성 전 silent skip**(`run.ts:181`, `run-etf.ts:94`). → `isKrClosedOnly`/`isDualClosed` 분기는 **생성 시 도달 불가(dead)**.
- 생성되는 비정상 상태는 **`isUsClosedOnly`(미국 단독 휴장·한국 개장)** 하나뿐. 이 분기가 `calendarBlock`에서 `buildTemporalFramingBlock`을 **대체(우회)**해, KR 개장 전 갭 인지 가드가 빠진다.
- 위험: 미국 휴장이 **월요일**(MLK·Presidents·Memorial·Labor, 연 4~5회)이면 KR 데이터=지난 금요일 종가인데 가드 부재 → "오늘 코스피 마감" Monday 버그 재현 가능.
- H2/M1 정상일 경로는 이미 해결됨: MLK 다음날 화 01-20 → US "지난 금요일(01-16)"·KR "어제(01-19)"; KR휴일 다음날 목 06-04 → KR "지난 화요일(06-02)" (실측 확인).

## 2. 목표 / 비목표
**목표**: `isUsClosedOnly` 케이스를 `buildTemporalFramingBlock`이 처리하도록 통합(prompt-consolidation 원칙). US 휴일 맥락("오늘 밤 미국 세션 없음") 흡수. 시점 가드 단일 소스화.
**비목표**: M2(EU/JP/CN 휴일 캘린더 — 데이터 소싱 필요). KR-휴장 분기 정책 변경(현행 silent skip 유지).

## 3. 설계 (통합 — Option B)
### 3.1 `lib/temporal-framing.ts` — `buildTemporalFramingBlock` 확장
`info.isUsClosedOnly`일 때, 기존 KR/US 갭 인지 프레이밍은 그대로 유지하고(이미 `describeSessionRecency`가 US prev=휴일 스킵해 "지난 금요일" 산출), **US 휴일 맥락 1줄을 추가**:
- market: 헤더 직후 `- ⚠️ 오늘 밤 미국 시장은 {usHolidayName}로 휴장입니다 — 오늘 밤 새 미국 세션이 없습니다.`
- etf: 동일 취지 1줄.
KR 프레이밍(item 1: "오늘 코스피 마감 금지" + `{kr.phrase} 종가`)은 **항상 발화**되므로, 통합만으로 잔여가 닫힌다.

### 3.2 `lib/claude-client.ts` (market) — calendarBlock 단순화
```ts
const calendarBlock = (() => {
  const info = ctx.calendarInfo;
  if (!info) return "";
  // KR 휴장·양국 휴장은 생성 전 silent skip(run.ts) — 도달 시 방어적 빈 문자열.
  if (info.isKrClosedOnly || info.isDualClosed) return "";
  // 정상일 + 미국 단독 휴장 모두 단일 시점 소스가 처리(갭 인지 + US 휴일 맥락).
  return buildTemporalFramingBlock(info, "market");
})();
```
→ 휴장 분기의 임시 텍스트 제거(US 휴일 내용은 3.1로 흡수, KR 휴일 텍스트는 dead라 제거).

### 3.3 `lib/etf/claude-client.ts` — 동일 단순화
`cal` 변수로 같은 패턴.

## 4. 테스트 (결정론)
`lib/temporal-framing.test.ts`에 추가:
- `isUsClosedOnly` 케이스(MLK 당일 KST 월 2026-01-19): market 블록이 (a) "오늘 밤 미국 … 휴장" 맥락 포함, (b) KR "지난 금요일(2026-01-16)" + "오늘 코스피" 금지 문구 포함.
- 정상일(2026-06-30 화)은 US 휴일 맥락 미포함(회귀 가드).

## 5. 검증
- tsc clean + 단위 전체 통과.
- 실측: `buildTemporalFramingBlock(getMarketCalendarInfo('2026-01-19'),'market')`에 KR "지난 금요일" 가드 + US 휴장 맥락 동시 존재 확인.
- (백필 불요 — 결정론 테스트 + 실측으로 충분. 다음 US 휴장 월요일 라이브에서 자연 확인.)
