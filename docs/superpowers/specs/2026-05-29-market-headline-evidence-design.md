# Market 리포트 제목 재설계 — 근거 토대 + 은유 제목 (2-Layer)

- **작성일**: 2026-05-29
- **상태**: 설계 (사용자 검토 대기)
- **범위**: Market 리포트 한정 (`lib/claude-client.ts`, `lib/context-data.ts`, `scripts/run.ts`, 신규 `lib/evidence-confidence.ts`). ETF 리포트는 범위 밖.

---

## 1. 배경 / 문제

제목의 본질은 "정보 요약"이 아니라 **독자가 읽고 싶게 만드는 호기심의 방아쇠**다. 배달 시점(미 마감 직후·한국 개장 전)에 한국 투자자가 관심 가질 토픽을, 그날 본문의 중심 긴장을 압축해 한 줄로 표현해야 한다.

현재 구현은 두 가지 면에서 이 목표와 어긋난다.

1. **은유 봉쇄**: 시스템 프롬프트가 은유를 통째로 금지(`claude-client.ts` 비유 금지 문구)하고 "사건+수치 2요소"로 팩트 앵커에 무게를 둔다. → 호기심보다 요약에 가까운 제목.
2. **근거 토대의 비대칭**: 제목 은유가 딛고 설 근거(뉴스/catalyst)에 충분성 게이트가 없다.
   - 가격 데이터: `run.ts:204` 에서 50% 이상 실패 시 중단 (게이트 있음).
   - 컨텍스트(뉴스·캘린더·FRED·심리): `collectContextData` 가 실패를 `contextErrors` 로 수집(`context-data.ts:100`)하지만, `run.ts` Step 2 검증은 가격만 보고(`run.ts:191-202`) `contextErrors` 는 무시. 프롬프트(`buildContextBlock`)도 실패를 알리지 않음.
   - 결과: 뉴스가 실패/빈약해도 파이프라인은 진행되고, Claude 는 "뉴스 실패"와 "조용한 날"을 구분하지 못한 채 매력적 제목을 요구받아 **근거 없는 은유를 지어낼 수 있다** (호르무즈 stale-news 사고, `TODOS.md` P3 와 동일 실패 모드).
   - 부수: `marketMode`(event/quiet)는 가격만으로 판정(`market-mode.ts`)해 뉴스 무게를 반영하지 못함.

**핵심 원칙**: 은유 제목(Layer 1)은 근거 토대(Layer 0) 위에서만 의미가 있다. 근거가 비면 그 위는 무의미하므로, 한 스펙에서 두 층으로 함께 설계한다.

## 2. 결정 사항 (사용자 합의)

- **앵커 정책**: 유연 — 기본은 은유/관점 중심, 수치는 부제가 받침. 단 그 숫자 자체가 오늘의 후크(심리적 분기점: 코스피 3000, 환율 1,500 등)면 제목에 남길지 **모델이 판단**.
- **클리셰 차단**: soft — 프롬프트 지시 + 현행 로그. 재생성 하드 게이트는 두지 않음 (06:30 스케줄 지연·비용 회피).
- **적용 방식**: B안 — 헤드라인 규칙을 흩어진 주석/위성 모듈에서 떼어 `## 제목 작성 규칙` 단일 섹션으로 모은다.

## 3. 비목표 (Non-goals)

- 새 데이터 소스 추가, 뉴스 수집기 재작성 — 하지 않음. **이미 수집 중인 신호만** 소비한다.
- 제목/본문에 대한 재생성(하드 게이트) 도입 — 하지 않음.
- ETF 리포트 변경 — 범위 밖.
- 임계값의 완벽한 사전 보정 — 초안값으로 출시하고 운영하며 조정(`market-mode.ts:39` 패턴 따름).

## 4. 설계

### Layer 0 — 근거 토대 (evidence confidence)

신규 순수 함수 모듈 `lib/evidence-confidence.ts`. 외부 호출 없음. 이미 수집된 신호만 입력.

**입력 신호** (전부 기존):
- `news: NewsHeadline[]` — 건수, 항목별 `publishedHoursAgo` (신선도).
- `contextErrors: ContextError[]` — 실패한 소스 목록 (특히 `source === "news"`).
- `topCatalysts: CatalystScored[]` — `extractTopCatalysts` 결과. 0건이면 minScore(4) 통과 catalyst 없음 = 강한 forward catalyst 부재.

**출력**:
```ts
type EvidenceTier = "strong" | "thin" | "hollow";
interface EvidenceConfidence {
  tier: EvidenceTier;
  newsCount: number;
  freshCount: number;        // publishedHoursAgo < FRESH_HOURS 인 건수
  topCatalystScore: number;  // 없으면 0
  failedSources: string[];   // contextErrors 의 source 목록
  reason: string;            // 사람이 읽는 판정 근거 (로그·프롬프트용)
}
```

**판정 로직** (초안 임계값 — 운영 보정 대상, 명명 상수로):
```
FRESH_HOURS = 12
STRONG_CATALYST = 7

hollow  := topCatalysts.length === 0  OR  failedSources.includes("news")
strong  := !hollow AND topCatalystScore >= STRONG_CATALYST AND freshCount >= 1
thin    := 그 외
```
(thin/hollow 하한은 별도 상수가 필요 없다. `extractTopCatalysts` 가 이미 minScore=4 미만을 걸러내므로, `topCatalysts.length === 0` 이 곧 "점수 4 미만뿐" = hollow 를 의미한다.)

**프롬프트 표면화** (`buildContextBlock` 또는 신규 블록, `claude-client.ts`):
```
## 오늘의 근거 상태
- 뉴스: {newsCount}건 (신선 {freshCount}건)
- 최상위 catalyst: {있으면 "[점수 X] 제목" / 없으면 "없음 — 강한 forward catalyst 부재"}
- 실패한 데이터 소스: {failedSources or "없음"}
```
tier 별 지시는 Layer 1 의 제목 규칙이 직접 참조한다 (아래).

### Layer 1 — 제목 작성 규칙 (단일 섹션)

`claude-client.ts` 의 `buildReportPrompt` 에 `## 제목 작성 규칙` 한 블록을 신설하고, 기존 `cover.headline` 스키마 주석의 규칙을 이리로 이관(스키마엔 "아래 제목 작성 규칙 참조"만 남김). 시스템 프롬프트의 비유 문구도 함께 정리.

**제목(headline)**:
- 목적: 호기심의 방아쇠. "왜 지금 이걸 읽어야 하나"에 답하는 압축된 한 줄.
- **신선한 은유/관점 허용.** 단 오늘의 지배적 서사(앵글 + 1순위 catalyst)에서 길어올린 이미지여야 함. 아무 날에나 붙일 은유면 실패.
- **클리셰 금지**: `BANNED_METAPHORS`(16종, 이미 단일화). 시스템 프롬프트를 "은유 금지" → **"클리셰 금지, 신선한 은유 권장"**으로 축 전환.
- 수치 앵커: 기본 부제로. 단 숫자 자체가 오늘의 후크면 제목에 남길지 모델 판단.
- 길이: 압축 지향(대략 15~25자 권장, 은유가 살아있으면 약간 초과 허용 — 경직 금지).
- 반복 회피: 같은 catalyst/이미지가 최근 3일 등장 시 국면·단계 변주 또는 부제 이전 + 새 각도 (기존 규칙 유지).

**부제(subline)** — 앵커의 새 집:
- 제목이 은유/관점이면 부제가 구체 사건명 + 핵심 수치를 받친다. 1~2문장, 은유를 사실로 착지.

**본문 연결 (title-body payoff)** — `bigStory 작성 규칙` 에 추가:
- bigStory 첫 문단 또는 pullQuote 하나가 제목의 이미지를 명시적으로 받아 전개. 제목·본문이 한 유기체.

**tier 종속 동작** (Layer 0 소비):
- `strong`: 은유가 전면. catalyst 에 단단히 근거.
- `thin`: 은유 허용하되 신중. 가격·구조 서사 비중을 높이고 단정 자제("~로 알려졌다" 수준).
- `hollow`: **사실 모드.** 은유를 만들지 말 것. 절제된 사실 프레이밍(예: "조용한 N일, 다음 변수는 X"). 근거 부재를 본문에서 솔직히 반영.

### 보조 변경

- **반복 회피 로그 부활**: `run.ts:328` `metaphors: []` 가 항상 비어 있어 은유 반복 회피가 죽어 있음. 제목을 은유 중심으로 바꾸면 같은 은유 반복 위험이 커지므로, JSON 출력에서 제목/본문의 핵심 이미지를 추출해 `narrativeEntry.metaphors` 에 저장하도록 복원. (추출은 코드 휴리스틱 또는 Claude JSON 에 `coverImage` 같은 보조 필드 추가 중 택1 — 구현 계획에서 확정.)

## 5. 코드 적용 지점

| 변경 | 파일 | 성격 |
|---|---|---|
| `EvidenceConfidence` 계산 | `lib/evidence-confidence.ts` (신규) | 순수 함수 |
| confidence 계산 호출 + ctx 전달 | `scripts/run.ts` (Step 3 부근), `claude-client.ts` `AntiRepetitionContext` | 배선 |
| `## 오늘의 근거 상태` 블록 | `lib/claude-client.ts` (`buildContextBlock`/신규) | 프롬프트 |
| `## 제목 작성 규칙` 단일 섹션 + 스키마 주석 축약 | `lib/claude-client.ts` (`buildReportPrompt`, schema) | 프롬프트 |
| 시스템 프롬프트 "은유 금지"→"클리셰 금지·신선한 은유 권장" | `lib/claude-client.ts` (`buildSystemPrompt`) | 프롬프트 |
| event 모드 "단정형" 문구 완화 (은유 병행 허용) | `lib/market-mode.ts` (`describeModeForPrompt`) | 프롬프트 |
| `metaphors` 로그 부활 | `scripts/run.ts:328` (+ 필요 시 `narrative-memory.ts`) | 로직 |

## 6. 부작용 / 상호작용

| # | 상호작용 | 처리 |
|---|---|---|
| 1 | 시스템 프롬프트 "비유 금지" vs 새 "은유 허용" | 같은 문장을 "클리셰 금지·신선한 은유 권장"으로 교체(B안이 단일 섹션에서 해소). |
| 2 | event 모드 "단정형+구체 수치" 가 은유 배제 | 문구를 "수치를 살리되 은유 병행 가능"으로 완화. event=숫자가 후크라 유연 예외와 정합. |
| 3 | quiet/월·금/휴장 톤 | 은유와 병존. 단일 섹션이 참조 관계 명확화. |
| 4 | PNG 프리뷰 `wrapText(headline, 15, 4)` (`preview-card.ts:70`) | 제목 길어지면 4줄 초과 잘림. 길이 권고 유지 + **적용 후 프리뷰 렌더 1회 검증**. |
| 5 | `narrative-memory` 클리셰 필터(파도·항해·등대…) | 신선한 은유를 클리셰로 오판해 로그 누락 가능 → 반복 회피 약화. 마이너, 모니터링. metaphors 부활 시 이 필터 재검토. |
| 6 | catalyst F2 패널티 / 반복 헤드라인 로그 | 그대로 정합. |
| 7 | `marketMode` 가격-only vs tier 뉴스-aware | 두 신호는 직교(분량 vs 근거). 충돌 아님. 단 hollow + event(가격) 동시 발생 시 "은유 금지 + 깊게 써라"가 공존 → 사실 모드로 깊게 쓰면 됨(모순 아님), 구현 계획에서 문구로 확인. |

## 7. 검증 계획

- `npx tsc --noEmit` 통과.
- `lib/evidence-confidence.ts` 단위 검증: strong/thin/hollow 3분기 + 경계값(catalyst 0건, news 실패, 점수 6/7 경계).
- 백필 실행으로 실제 리포트 3종 생성 비교:
  - `REPORT_DATE` 로 뉴스 풍부했던 날(예: 삼성 노사) → strong, 은유 제목 확인.
  - 뉴스 빈약/주말 인접일 → thin/hollow, 사실 모드 확인.
- 생성된 제목으로 PNG 프리뷰 렌더 → 4줄 잘림 없는지 확인 (부작용 #4).
- 발송은 dry_run 으로 텔레그램 제외.

## 8. 미결 / 보정 항목

- 임계값(FRESH_HOURS, STRONG_CATALYST) 초안값 → 1주 운영 후 실측 분포로 조정.
- `metaphors` 추출 방식(코드 휴리스틱 vs Claude 보조 필드) → 구현 계획에서 확정.
- hollow 빈도가 높으면(뉴스 소스 불안정) Layer 0 게이트를 "약한 경고"에서 "사실 모드 강제"로 강화할지 재검토.
