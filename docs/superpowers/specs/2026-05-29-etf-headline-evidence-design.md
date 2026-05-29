# ETF 리포트 제목 재설계 — 근거 토대 + tier 종속 하이브리드 헤드라인 (2-Layer)

- **작성일**: 2026-05-29
- **상태**: 설계 (사용자 검토 대기)
- **브랜치**: `feat/etf-headline-evidence`
- **범위**: ETF(morning) 리포트 한정. Market 리포트는 범위 밖(단, 공유 클리셰 목록 추출 시 `lib/claude-client.ts` import 1줄 변경).
- **선행**: (a) 무해한 정리 완료(`e27f2ea` 죽은 resolutions, `99c1112` 죽은 FX 트리거) — origin/main 반영됨.

---

## 1. 배경 / 문제 (ETF 감사 결과)

Market 리포트를 재설계한 동일한 문제의식으로 ETF를 점검한 결과, 우려가 더 강하게 성립했다.

- **프롬프트 부채**: `etf/claude-client.ts` 17커밋·551줄. 헤드라인 규칙만 ~65줄(`:344-409`)에 Tier1→Tier2→P0→P1·P2·P3→Plan B→Phase C·F2·F3·E1~E4가 층층이 누적.
- **F3↔E2 모순 미해소**: catalyst 의무화(`:350` "사건명 반드시 명시")와 anchor 다양화(`:191-200` "3회+ anchor 절대 피하라")가 평면 명령으로 충돌 — Market 커밋 `150b479`가 명시적으로 해소한 바로 그 충돌이 ETF엔 그대로.
- **옛 제목 패러다임**: "두 절 압축형(앵커가 제목 안)"(`:366-375`) — Market의 *재설계 이전* 스타일. 호크·앵커→부제 미적용.
- **메타포 정책 불일치**: system prompt가 은유 허용(`:26`)·클리셰 7종 금지(`:38`)·동시에 "관문/장면/불씨/온도… 허용"(`:42`). "불씨"는 Market 금지목록엔 있고 ETF엔 허용 — 단일 소스 없음.
- **근거 토대 결손**: evidence tier 없음(`evidence-confidence.ts` ETF 미사용), 데이터 실패가 프롬프트에 무음 누락(`run-etf.ts:94-141` allSettled→빈 값, `failedSources` 필드 없음), macro 전체 실패 시 `N/A` 7줄이 진짜 null과 구분 불가, KRX 실패 시 이상치 소멸 → 낮은 anomalyCount가 `etf-mode`를 "조용한 날"로 위장.

**핵심 원칙(Market와 동일)**: tier 종속 헤드라인(Layer 1)은 신뢰할 수 있는 근거 tier(Layer 0) 위에서만 의미가 있다. 한 스펙에 두 층으로 설계한다.

## 2. 결정 사항 (사용자 합의)

- **헤드라인 = tier 종속 하이브리드**: `strong`=호크+앵커는 subline / `thin`=앵커 우선·신중 / `hollow`=순수 사실(은유 금지). Layer 0 tier가 제목 형태를 결정.
- **데이터 실패 = 노출 + tier 반영**: `failedSources`를 `CollectedData`에 추가→프롬프트 노출, 뉴스 전멸/KRX 실패면 tier를 hollow/thin으로 낮춤(KRX의 quiet 위장 문제 동시 해결).
- **Layer 0 산출 = 신규 모듈(B안)**: `lib/etf/etf-evidence.ts` — Market의 tier 구조·임계값 패턴을 차용하되 ETF 신호로 산출. 기존 `catalyst-extractor` 재사용. 과잉추상화 회피.
- **report-quality·데이터 게이트 불변**: ETF의 작동하는 hard validator(`report-quality.ts`)와 데이터 게이트(`pipeline-utils.ts`)는 변경하지 않고 보강만.

## 3. 비목표 (Non-goals)

- `report-quality` hard validator·`pipeline-utils` 게이트 변경 — 안 함(additive only).
- 뉴스/데이터 수집 재작성, 새 데이터 소스 추가 — 안 함.
- `consecutiveForeignSell` 사문화 규칙(미구현 의도 stub) — 이번 범위 밖, 보존.
- report-language↔report-quality 도달불가 hard 패턴(띄어쓰기 backstop) 정리 — 이번 범위 밖.
- 임계값 사전 완벽 보정 — 초안값 출시 후 운영 보정(`market-mode.ts:39` 패턴).

## 4. 설계

### Layer 0 — ETF 근거 토대

**`CollectedData` 확장** (`lib/etf/types.ts`): `failedSources: string[]` 추가.

**`run-etf.ts` 배선**: `Promise.allSettled` 결과에서 실패 소스를 수집:
- `etfData` rejected → `"etf-quotes"`
- `macro` rejected → `"macro"`
- `news` rejected → `"news"`
- KRX nav/괴리율이 전량 null(국내 ETF가 있는데도) → `"krx-nav"` (KRX의 quiet 위장 차단용 신호)
이 배열을 `CollectedData.failedSources`에 담는다.

**신규 모듈 `lib/etf/etf-evidence.ts`** (순수 함수):
```ts
export type EtfEvidenceTier = "strong" | "thin" | "hollow";
export interface EtfEvidence {
  tier: EtfEvidenceTier;
  newsCount: number;
  freshCount: number;        // publishedHoursAgo < FRESH_HOURS
  topCatalystScore: number;  // 없으면 0
  anomalyCount: number;
  failedSources: string[];
  reason: string;
}
export function analyzeEtfEvidence(
  data: CollectedData,
  anomalyCount: number,
  failedSources: string[] = [],
): EtfEvidence
```
- `catalyst-extractor.extractTopCatalysts(data.news, {topN:1, recentHeadlines})`로 최상위 catalyst 점수.
- 판정(초안 임계값, 명명 상수):
  ```
  FRESH_HOURS = 12;  STRONG_CATALYST = 7;
  newsFailed := failedSources.includes("news")
  hollow := topCatalysts.length === 0  OR  newsFailed  OR  newsCount === 0
  strong := !hollow AND topCatalystScore >= STRONG_CATALYST AND freshCount >= 1
            AND !failedSources.includes("krx-nav")   // KRX 실패 시 strong 금지(근거 불완전)
  thin   := 그 외
  ```
- `reason`: 사람이 읽는 판정 근거(로그·프롬프트용).
- **anomalyCount의 역할**: tier 판정에는 쓰지 않는다(헤드라인 근거는 "오늘의 이야기" = 뉴스/catalyst). anomalyCount는 근거 상태 블록에 맥락으로만 노출하고, 분량은 기존 `etf-mode`가 담당. (이상치는 본문·mode 신호이지 헤드라인 tier 신호가 아님.)

**배선**: `run-etf.ts`에서 `analyzeEtfEvidence` 호출 → `data.etfEvidence`로 프롬프트 빌더에 전달 + tier 로그.

**프롬프트 표면화** (`claude-client.ts buildMorningPrompt`):
```
[오늘의 근거 상태 — tier: {tier}]
- 뉴스 {newsCount}건 (신선 {freshCount}건)
- 최상위 catalyst: {있으면 "[점수 X] 제목" / 없으면 "없음 — 강한 catalyst 부재"}
- 실패한 데이터 소스: {failedSources or "없음"}
이 근거 상태가 아래 [제목 작성 규칙]의 tier 동작을 결정합니다.
```

**KRX 위장 해소** (`etf-mode.ts`): `analyzeEtfMode`에 `failedSources` 전달. `quiet` 판정(`coreAvgAbs < 0.5 && anomalyCount <= 3`)에서 `failedSources.includes("krx-nav")`이면 quiet 강등 보류(낮은 anomalyCount가 데이터 실패 탓일 수 있으므로). tier와 mode는 직교(tier=헤드라인 근거, mode=분량)이되 이 한 가지 오판만 차단.

### Layer 1 — 헤드라인 규칙 단일 섹션 (tier 종속)

`cover.headline` 규칙(`:344-409`)을 하나의 일관 섹션으로 재작성. anchor-history 블록(`:170-201`)·catalyst F3 블록은 이 섹션의 `[반복 회피]`로 흡수.

**제목(headline) — tier 종속:**
- **strong**: 호크가 전면. 수치·티커 앵커는 **subline**으로. 최상위 catalyst에서 길어올린 신선한 은유 허용.
- **thin**: 앵커 우선·신중. 가격·구조 서사 비중↑, 단정 자제. 은유는 절제.
- **hollow**: **사실 모드.** 은유 만들지 말 것. 절제된 사실(횡보·다음 영업일 미리보기 등). catalyst 의무 자동 우회.

**공통:**
- **F3/E2 통합 (base + 예외)**: `[기본]` catalyst가 있으면 근거로 반영(strong/thin), 단 `[반복 회피 — 기본보다 우선]` 같은 catalyst·anchor가 최근 3일 등장 시 (a) 국면·단계 변주 또는 (b) anchor를 부제로 내리고 새 각도. hollow면 catalyst 의무 미적용.
- **지수/시장/증시 단독 금지**: 한 번만 명시(중복 3진술 정리). 하드 차단은 `report-quality`가 이미 수행(불변).
- **메타포 단일화**: `lib/banned-metaphors.ts`(신규)로 공유 목록 추출 — Market `claude-client.ts`의 `BANNED_METAPHORS`를 이리로 이관, ETF는 여기에 ETF 특유(훈풍·찬바람) 추가분을 더해 import. 모순된 허용목록(`:42`)은 제거하되, 진짜 유용한 ETF 표현은 "금지 목록에 넣지 않음"으로 처리(별도 허용목록 없이). (사용자: 과감한·신선한 은유 OK, 클리셰만 차단 — [[feedback-headline-metaphor-tone]])
- **본문 payoff**: `narrativeNotes.bigPicture` 첫 부분이 헤드라인 이미지를 받아 전개.

**`etf-mode.ts` event 문구 완화**: `describeEtfModeForPrompt` event 분기의 "단정형 + 구체 수치"(`:126`)를 tier 하이브리드와 충돌하지 않게 완화(Market Task 5와 동일 취지) — "[제목 작성 규칙]을 따르되 사건의 무게가 전달되도록".

**프롬프트 정리(헤드라인 재작성에 수반)**: Phase 이력 주석(`:462,479` 등 resolutions 잔재 설명은 이미 (a)에서 일부 제거됨, 남은 archaeology 정리), 3중 지수/시장 진술 통합.

## 5. 코드 적용 지점

| 변경 | 파일 | 성격 |
|---|---|---|
| `EtfEvidence` 산출 | `lib/etf/etf-evidence.ts` (신규) | 순수 함수 |
| `failedSources` 필드 | `lib/etf/types.ts` (`CollectedData`) | 타입 |
| failedSources 수집 + evidence 계산·전달·로그 | `scripts/run-etf.ts` | 배선 |
| 근거 상태 블록 + 헤드라인 규칙 단일 섹션 + event 문구 | `lib/etf/claude-client.ts` | 프롬프트 |
| quiet 위장 차단(failedSources 인지) | `lib/etf/etf-mode.ts` | 로직 |
| 공유 클리셰 목록 | `lib/banned-metaphors.ts` (신규) + `lib/claude-client.ts` import | 리팩토링 |

## 6. 부작용 / 상호작용

| # | 상호작용 | 처리 |
|---|---|---|
| 1 | `report-quality` hard validator (지수/시장·투자권유·중복) | **불변.** 새 tier는 additive. 헤드라인의 지수/시장 차단은 계속 validator가 담당. |
| 2 | `pipeline-utils` 데이터 게이트 | **불변.** evidence는 게이트 통과 후 산출. |
| 3 | event 모드 "단정형" 문구 | tier 하이브리드와 충돌 → 완화. |
| 4 | anchor-history 블록(E2) | 새 [반복 회피]로 흡수, 중복 제거. |
| 5 | KRX 실패 → 낮은 anomalyCount → quiet 위장 | etf-mode가 failedSources 인지해 차단. |
| 6 | ETF 프리뷰 PNG (`report-preview.ts`) | 헤드라인 길이·줄바꿈 — 적용 후 렌더 1회 확인. |
| 7 | `BANNED_METAPHORS` 공유 추출 | Market `claude-client.ts` import 1줄 변경 — tsc로 검증. |
| 8 | report-language↔report-quality 도달불가 패턴 / consecutiveSell stub | **범위 밖**(별도). |

## 7. 검증 계획

- `npx tsc --noEmit` 통과.
- `lib/etf/etf-evidence.test.ts` 단위 검증: strong/thin/hollow 3분기 + 경계(catalyst 0건, news 실패, krx-nav 실패→strong 금지, 점수 6/7 경계).
- 로컬 ETF 재생성(`run-etf.ts`, push·Telegram 없음): 정상=strong/thin 헤드라인(호크/앵커), `DISABLE_CONTEXT` 또는 뉴스 실패 시뮬=hollow 사실 모드 확인.
- ETF 프리뷰 PNG 렌더 → 헤드라인 줄바꿈 확인(부작용 #6).
- `report-quality` 검증이 새 헤드라인에도 그대로 통과하는지(지수/시장 차단 등).

## 8. 미결 / 보정 항목

- 임계값(FRESH_HOURS, STRONG_CATALYST) 초안값 → 1주 운영 후 실측 보정.
- 공유 `BANNED_METAPHORS`의 ETF 추가분 최종 목록(훈풍·찬바람 외) 확정.
- evidence·mode 직교 유지 vs 통합 — 현재는 직교 + quiet 위장만 차단. hollow 빈도 높으면 재검토.
