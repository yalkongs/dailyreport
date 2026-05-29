# ETF event 모드의 괴리율 과민 보정 (B4)

- **작성일**: 2026-05-29
- **상태**: 설계 (사용자 검토 대기)
- **브랜치**: `feat/etf-event-mode-anomaly`
- **범위**: `lib/etf/etf-mode.ts` 한정 (+ 신규 단위 테스트). 다른 파일 무변경.

---

## 1. 배경 / 문제

`etf-mode.ts`의 mode 분기는 anomaly 건수를 트리거로 쓴다:
- event: `anomalyCount >= EVENT_THRESHOLDS.anomalies`(=10) (가격 트리거 SOXX/SPY/KOSPI proxy/VIX 와 OR)
- quiet: `coreAvgAbs < 0.5 && anomalyCount <= QUIET_THRESHOLDS.anomMax`(=3) (+ `!krx-nav`)

그런데 anomaly는 `premiumDiscount`(괴리율)가 압도적으로 많다. `analyzer.ts`의 괴리율 임계값은 warning 0.5%로 낮아, ~100개 ETF 유니버스에서 일상적 NAV 갭만으로도 10건 이상 쉽게 누적된다. (실측: 2026-05-29 ETF 리포트 anomalyCount 10건 **전부 premiumDiscount**.)

결과:
- **event 과민 발동**: 괴리율 군집(시장 이벤트 아님)만으로 event 모드 → 본문 과다 분량(bigPicture 8~12문장).
- **quiet 억제**: 괴리율이 anomalyCount를 ≤3 위로 밀어올려, 가격이 평온해도 quiet로 분류 안 됨.

즉 mode의 anomaly 카운트가 괴리율 노이즈에 양방향으로 왜곡된다.

**참고 — "유의미 이상치"의 실제 구성**: anomaly 타입은 premiumDiscount·trackingError·volumeSpike·consecutiveSell·aumChange. 이 중 `consecutiveSell`은 `etf-data.ts`가 `consecutiveForeignSell: 0`을 하드코딩해 영구 미발동(미구현 스텁), `aumChange`는 미구현. 따라서 괴리율 제외 시 실효 카운트 = **trackingError + volumeSpike**.

## 2. 결정 사항 (사용자 합의)

- **mode 카운트에서 premiumDiscount 제외**: event·quiet 트리거 모두 "유의미 이상치(괴리율 제외)" 건수로 비교.
- **event 임계값 10 → 5**: 유의미 이상치는 드물고 더 의미 있으므로 5건이면 실제 ETF 스트레스로 본다.
- **quiet 임계값 3 유지**.
- 괴리율은 이상탐지 섹션·index `anomalyBreakdown`에는 **그대로 표시**(독자 노출 유지). mode 트리거만 영향.

## 3. 설계

`lib/etf/etf-mode.ts` `analyzeEtfMode`:
- 유의미 이상치 카운트 도입:
  ```ts
  const significantAnomalies = anomalies.filter(a => a.type !== "premiumDiscount").length;
  ```
- event 트리거: `if (significantAnomalies >= EVENT_THRESHOLDS.anomalies)` (임계값 상수 5로 변경).
- quiet 조건: `... && significantAnomalies <= QUIET_THRESHOLDS.anomMax && ...` (anomMax 3 유지).
- `metrics.anomalyCount`는 **전체**(`anomalies.length`) 유지 — 로그·투명성용. 단, event/quiet `reason` 문구는 어느 카운트로 판정했는지 명확히: 예) `이벤트 트리거: 유의미 이상 ${significantAnomalies}건`, `잠잠: ... 유의미 이상 ${significantAnomalies}건(전체 ${anomalyCount})`.
- 임계값 상수에 "초안값, 운영 보정" 주석 유지.

## 4. 비목표 (Non-goals)

- evidence tier(`etf-evidence.ts`) — 무변경. 거기 anomalyCount는 맥락 표시용(전체)이며 tier 판정엔 안 쓴다.
- 이상탐지 섹션·`run-etf.ts`의 `anomalyBreakdown` — 무변경(괴리율 계속 표시).
- `analyzer.ts` 괴리율 탐지 임계값(0.5%) — 무변경(탐지·표시는 유지, mode만 분리).
- `consecutiveSell` 미구현 스텁 — 범위 밖(별도).

## 5. 코드 적용 지점

| 변경 | 파일 | 성격 |
|---|---|---|
| significantAnomalies 필터 + event/quiet 트리거·임계값·reason | `lib/etf/etf-mode.ts` | 로직 |
| `analyzeEtfMode` 단위 테스트 | `lib/etf/etf-mode.test.ts` (신규) | 테스트 |

## 6. 부작용 / 상호작용

| 상호작용 | 처리 |
|---|---|
| evidence tier | 무관(anomalyCount 맥락 표시용, tier 판정 미사용). |
| 이상탐지 섹션·index breakdown | 무변경 — 괴리율 그대로 표시. |
| event 모드 프롬프트 문구("이상 신호 다발") | 유효(유의미 이상치 군집 또는 가격 변동). |
| KRX 실패 quiet 가드(`!krx-nav`) | 그대로 유지(B4와 직교). |

## 7. 검증 계획

- `npx tsc --noEmit` 통과.
- `lib/etf/etf-mode.test.ts` 신규: `analyzeEtfMode` 단위 검증
  - 괴리율 10건만(가격 평온) → event 아님, quiet/normal.
  - 유의미 이상치(trackingError/volumeSpike) ≥5 → event.
  - 가격 트리거(SOXX≥3% 등) → 기존대로 event.
  - 괴리율 다수 + 가격 평온 + 유의미 0~3 → quiet 발동(과거엔 억제됐던 케이스).
- (선택) 라이브 재생성으로 mode 로그 확인.

## 8. 미결 / 보정 항목

- event 임계값 5, quiet 3은 초안값 → 운영 분포 보고 조정.
- `consecutiveSell`(5번째 이상탐지)·`aumChange` 실제 구현은 별도 기능 작업.
