# ETF 리포트 품질 개선 로드맵

## 배경

2026-04-22 리포트 품질 평가 결과, ETF 리포트는 시장 리포트와 **코드 vs Claude
역할 배분**이 정반대로 치우친 상태였음.

| | 시장 리포트 (2026-04 리팩토링 후) | ETF 리포트 (현재) |
|---|---|---|
| Claude 담당 | JSON 본문 전체 (bigStory, compass, soWhat 등) | 커버·간밤 요약·섹터 서술 등 일부만 (약 5~25%) |
| 코드 담당 | 템플릿 렌더링만 | 본문 서술 대부분까지 직접 작성 (약 75~95%) |

결과:
- 매일 같은 고정 문장이 반복되어 운영이 정지된 것처럼 보임
- "체결 여건은 양호하지만..." 같은 한 문장이 수 개 ETF 행에 그대로 복제됨
- 내러티브가 끊겨 리포트가 체크리스트 묶음처럼 읽힘

## Tier 1 (완료 — 2026-04-22)

**범위**: 하드코딩된 문구를 코드 안에서 **더 자연스러운 한국어로 재작성** +
반복 위치에 **변주 도입** + 프롬프트 강제 어휘 규칙 **완화**.
이관(Claude로 이동) 없이 현 구조 유지.

**수행**
- `lib/etf/renderer.ts`: 유동성/괴리 ETF 행 footer를 4종/3종 변주로 교체
- `lib/etf/renderer.ts`: Characters, Resolution, Checklist, Match-check, Sector-reason,
  Story-act-note, Compact-note 등 15+ 고정 문구 자연화
- `lib/etf/morning-strategy.ts`: 7개 전략 그룹의 rationale/actionGuide/confirmSignal/avoid
  총 28개 문구 자연화 + 3개 riskAlert body 자연화
- `lib/etf/claude-client.ts` L225: 강제 대체어 리스트 → "중립적 관찰 표현 상황 선택" +
  "점검형 어미 반복 금지" 가이드로 전환

**예상 효과**
- 4/23부터 문체가 덜 기계적으로 바뀜
- 같은 자리에 매일 다른 문장이 나오므로 반복감 ↓
- 단, **매일 달라지는 내러티브는 아직 제한적** — 이는 Tier 2의 과제

---

## Tier 2 (TODO — 중간 재균형, 예상 공수 반나절)

**목표**: 코드 20+ 섹션 중 **내러티브성이 필요한 섹션을 Claude 생성으로 이관**.

**구체 작업**
- [ ] `renderer.ts` `renderMorningHtml` 에서 Claude가 쓸 수 있는 섹션 식별
  - 후보: Story Spine 텍스트, Characters 설명, Resolution 가이드, 체크리스트 하단 문구
- [ ] `lib/etf/types.ts` `MorningReport` 인터페이스에 신규 필드 추가
  - 예: `narrativeNotes: { storySpine: string[], resolutions: string[] }`
- [ ] `lib/etf/claude-client.ts` 프롬프트에 해당 필드 작성 지시 추가
- [ ] `renderer.ts` 가 해당 섹션을 Claude 출력에서 읽도록 변경
- [ ] `report-quality.ts` 에 신규 필드 검증 규칙 추가
- [ ] 2~3일 운영 관찰 후 품질 평가

**리스크**
- Claude가 데이터 근거 없이 서술 확장 → `report-quality.ts` 가드 필수
- 섹션 수는 그대로 두고 내용만 이관 → 구조 회귀 위험 낮음

---

## Tier 3 (TODO — 전면 리팩토링, 예상 공수 1~2일)

**목표**: 시장 리포트 "code-balance" 패턴과 동일한 구조로 전면 재설계.

**구체 작업**
- [ ] ETF 리포트의 섹션 구조를 12개 내외로 축소 (현 20개)
- [ ] Claude → JSON 스키마 1개 (rich narrative) 로 단순화
- [ ] 코드는 순수 템플릿 렌더링만 (문장 생성 0)
- [ ] `morning-strategy.ts` 의 actionGuide/avoid/rationale 은 **Claude 입력 힌트**로
  격하하고 (완성 문장 아님) Claude 가 문장화
- [ ] 렌더러 전면 재작성

**리스크**
- 회귀 위험 중간 (시장 리포트 리팩토링 당시 수 회 시행착오)
- 일정 확보 전에는 착수 금지

---

## Tier 4 (TODO — 독자 페르소나 기반 재설계, 일정 미정)

**사전 결정 필요**
- [ ] 독자 페르소나 정의 — 내부 트레이더 vs 일반 개인 투자자
- [ ] 리포트의 1차 목적 — 실행 가이드 vs 시장 인사이트
- [ ] 분량 목표 — 한 페이지 vs 스크롤 리더

위 3개 질문에 답이 서면 그에 맞춰 섹션·분량·어조 재구성.

---

## 공통 원칙 (모든 Tier 관통)

1. **수치는 코드가, 해석은 Claude가** — 같은 기준을 지킨다.
2. 프롬프트에 **"금지 어휘"보다 "지향 어휘·상황"** 을 제시한다.
3. 하드코딩된 문구는 **최소 2~4개 변주**를 둔다 (Tier 1 완료).
4. `report-quality.ts` 의 품질 검증은 **릴랙스하지 않는다** — 허위 수치·과장 표현 차단.
5. 변경 후 **1주일 관찰** 을 거쳐 다음 Tier로 이행한다.
