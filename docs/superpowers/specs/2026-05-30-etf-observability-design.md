# ETF 관측성·투명성 보강 — B5(tier 운영 로그) + B6(macro 실패 라벨)

- **작성일**: 2026-05-30
- **상태**: 설계 (사용자 검토 대기)
- **브랜치**: `feat/etf-observability`
- **범위**: B5와 B6 묶음 — 둘 다 ETF 파이프라인의 관측성·투명성 보강. 작고 직교(서로 무관). 한 스펙·한 plan으로 처리.

---

## 1. 배경 / 문제

### B5 — tier 운영 로그 부재
헤드라인 재설계에서 evidence tier 임계값(`FRESH_HOURS=12`, `STRONG_CATALYST=7`)과 B4의 mode 임계값(event 5, quiet 3)을 모두 **초안값으로 출시**했다(각 spec §8). 운영하며 보정하려면 실측 분포가 필요하나, 현재는 매 실행의 tier·신호가 휘발성 로그(console)로만 흐르고 어디에도 적재되지 않는다.

### B6 — macro 'N/A' 진짜 null과 구분 불가
`claude-client.ts`의 `[거시 지표]` 블록(`:287-293`)은 `formatPromptNumber`가 null이면 'N/A'를 출력한다. `collectMacroContext` 실패 시 `macro = {}` 폴백이라 7줄이 모두 `N/A`로 나오는데, 평소 일부 지표(예: `^MOVE`)가 단일하게 null인 케이스와 **시각적으로 동일**해 모델이 "수집 실패"를 인지할 수 없다. ETF 헤드라인/근거 토대 작업에서 `failedSources`로 tier에는 반영했지만 macro 블록 자체는 여전히 미라벨 상태.

## 2. 결정 사항 (사용자 합의)

- **B5**: 매 실행의 evidence·mode·anomaly 신호를 풍부 엔트리로 `data/etf-evidence-log.json`에 append. 보존 60일치(`slice(-60)`). lens/angle 로그와 동일 패턴.
- **B6**: `failedSources.includes('macro')` 면 macro 블록 머리에 경고 1줄 추가, 성공 시 기존 그대로. 블록 단위(per-field 아님).

## 3. 설계

### B5 — `lib/etf/etf-evidence-log.ts` (신규) + `scripts/run-etf.ts` 연결

엔트리 타입:
```ts
export interface EtfEvidenceLogEntry {
  date: string
  tier: 'strong' | 'thin' | 'hollow'
  mode: 'event' | 'normal' | 'quiet'
  newsCount: number
  freshCount: number
  topCatalystScore: number
  anomalyCount: number                              // 전체
  anomalyBreakdown: Partial<Record<AnomalyType, number>>  // 괴리율 vs 유의미 분해
  failedSources: string[]
}
```

API:
```ts
export function appendEtfEvidenceLog(entry: EtfEvidenceLogEntry, retentionDays = 60): void
```
- 내부에서 `loadJson<EtfEvidenceLogEntry[]>('data/etf-evidence-log.json', [])` → push(entry) → `slice(-retentionDays)` → `saveJson`. 기존 `lib/etf/pipeline-utils.ts`의 `loadJson`·`saveJson` 재사용.

`scripts/run-etf.ts` Step 7(인덱스 갱신) 직후, 이미 `data.etfEvidence`·`data.etfMode`·`breakdown`이 다 있는 시점에서 1회 호출:
```ts
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

**보존 60일** 결정 근거: lens/angle은 `-30`을 쓰지만 임계값 보정엔 더 풍부한 표본이 유용. 평일만 발행되므로 60건 ≈ 약 3개월. 초안값(주석으로 명시), 운영 보정.

### B6 — `lib/etf/claude-client.ts` macro 블록 조건부 경고

현재(약 287-294행):
```
[거시 지표]
USD/KRW: ${formatPromptNumber(data.macro.usdKrw, 0)}
VIX: ...
...
```

변경: `buildMorningPrompt` 안에서 `data.failedSources?.includes('macro')` 여부로 분기, 머리에 한 줄 추가:
```
[거시 지표]
⚠️ 거시 데이터 수집 실패 — 아래 수치는 신뢰할 수 없습니다(직전 영업일 기준으로도 보지 마십시오).
USD/KRW: N/A
...
```
성공 시 경고 줄 없음(기존 그대로). per-field 라벨은 하지 않음 — macro는 전체가 한 번에 폴백되므로 블록 머리 한 줄이 정확하고, 평소 단일 지표 null(`^MOVE` 등)이 잘못 라벨링되는 것 방지.

## 4. 비목표 (Non-goals)

- macro 수집기(`market-context.ts`) 재작성·재시도 정책 — 범위 밖.
- per-field 실패 추적(어떤 거시 지표가 왜 null인지) — 현재 폴백이 `{}` 단위라 분리 불가, 범위 밖.
- tier·mode 임계값 자체의 조정 — B5는 *데이터를 모으는* 단계, 실제 보정은 별도 분석 작업.
- lens/angle 로그 통합 — 무관.

## 5. 코드 적용 지점

| 변경 | 파일 | 성격 |
|---|---|---|
| `appendEtfEvidenceLog` + 타입 | `lib/etf/etf-evidence-log.ts` (신규) | 순수 유틸 |
| 로그 호출 | `scripts/run-etf.ts` (Step 7 후) | 배선 |
| macro 블록 경고 분기 | `lib/etf/claude-client.ts` `buildMorningPrompt` | 프롬프트 |

## 6. 부작용 / 상호작용

| 상호작용 | 처리 |
|---|---|
| 리포트 출력·tier·mode | B5는 순수 추가 로그, B6는 macro 실패 시 한 줄 추가 — 평소 출력 무영향. |
| 인덱스·lens/angle 로그 | 무영향(별도 파일). |
| 다른 데이터 실패(news/etf-quotes/krx-nav) | B6는 'macro' 키만 트리거 — 다른 실패는 evidence tier·이상탐지 표시에서 이미 처리. |
| 첫 실행(로그 파일 없음) | `loadJson`이 fallback `[]` 반환 → 첫 엔트리만 들어감. 안전. |

## 7. 검증 계획

- `npx tsc --noEmit` 통과.
- `appendEtfEvidenceLog` 단위 테스트: 첫 호출(파일 없음)·기존 엔트리 append·retention 컷오프(60 초과 → 슬라이스).
- macro 경고 조건부 렌더 단위 테스트: `failedSources` 'macro' 포함 시 경고 줄, 미포함 시 없음.
- (선택) 라이브 ETF 재생성 1회: `data/etf-evidence-log.json` 엔트리 1개 생성 확인, macro 실패 시 프롬프트 경고 확인.

## 8. 미결 / 보정 항목

- `retentionDays = 60` 초안값 → 1~2개월 운영 후 분포 보고 조정.
- B6 경고 문구는 임시(`⚠️ 거시 데이터 수집 실패 ...`) — 운영 중 적절 조정 가능.
- A2(연속매도 실제 구현)는 별도 후속.
