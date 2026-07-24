# 정합성 Validator 설계 — 어휘 검사에서 사실 정합성 검사로

날짜: 2026-07-22
상태: 승인됨 (구현 진행)
브랜치: `report-consistency-validator`

## 배경 — 실제 발행본에서 발견된 결함 4종

2026-07-22 품질 리뷰에서 발행본 기준으로 실증된 결함. 현재 validator(`lib/etf/report-quality.ts`)는
어휘·형식(투자권유 표현, 애매어, 코드 괄호 등)은 잡지만 **사실 정합성은 전혀 검사하지 않는다.**
market은 hard validator 자체가 없다(`sanitizeBannedExpressions`는 로그만 남김, lib/claude-client.ts:599).

| # | 결함 | 실증 (2026-07-21 발행본) |
|---|------|--------------------------|
| R1 | ETF Characters 카드-산문 불일치 | 카드 "TIGER 미국나스닥100 (133690)" ↔ 산문 "TIGER 미국S&P500(360750)은…" / 카드 "TIGER 국채3년 (114820)" ↔ 산문 "TIGER 미국MSCI리츠(182480)는…" |
| R2 | 날짜-요일-상대시제 모순 | market 본문 중반 "내일(07/23, 목) GDP" vs 결문 "내일 PPI와 모레 GDP" (발행일 7/21 화 기준 07/23은 모레) |
| R3 | 출처 인용 품질 | "Crypto Briefing과 finance.biggo.com 등 외신에 따르면"이 그날의 핵심 논거(마이크론 전망)의 근거로 인용됨. "~에 따르면" 한 리포트 6회 |
| R4 | 미확보 필드 노출 | ETF Warning Board 3개 카드 전부 거래대금/괴리율/지수대비 "미확보" 표시로 발행 |

### R1의 근본 원인 (설계 결함 — 검증만 추가하면 수렴 불가)

- 렌더러가 **렌더 시점에** `selectStoryCharacters(data.quotes)`(lib/etf/renderer.ts:925)로
  카드 4장(primary/gate/alternative/warning)의 ETF를 결정론적으로 고른다.
- 프롬프트는 Claude에게 배정을 알려주지 않는다 — "primary: 오늘의 주인공 ETF (예: 반도체 ETF)"
  수준의 일반 지시뿐(lib/etf/claude-client.ts:404-406). Claude는 스스로 추측해서 쓴다.
- 7/21: gate 선택 로직은 나스닥100 우선(renderer.ts:931-936)인데 Claude는 S&P500을 추측.
  alternative는 국채 우선인데 Claude는 리츠를 추측. → 불일치는 필연.
- 따라서 **배정 주입(프롬프트) 없이 검증만 추가하면 재생성이 수렴하지 못한다.**
  주입 + 검증을 쌍으로 넣어야 한다.

## 목표 / 비목표

**목표**: 위 4종이 재생성(hard) 또는 자동 교정(soft)으로 발행 전에 잡히게 한다.
기존 철학 유지 — soft fix 먼저, hard는 재생성 사유, 실패 시 기존 Tier 1 fallback 경로 그대로.

**비목표**: 헤드라인 반복 억제(별도 작업), ETF 슬롯 구조 재설계(Tier 3), 산문 톤 변경.
프롬프트 수정은 배정 주입·출처 제한 등 **데이터성 지시 최소 추가**로 한정한다(스타일 지시 추가 금지).

## 설계

### R1. Characters 카드-산문 일치 (ETF)

1. `selectStoryCharacters`·`StoryCharacters`·`findQuoteByName`·`isTacticalEtf`(의존 시)를
   renderer.ts에서 새 모듈 **`lib/etf/story-characters.ts`**로 이동, export.
   renderer.ts와 claude-client.ts 양쪽에서 import (순환 import 없음 확인됨).
2. `buildMorningPrompt`의 characters 지시(claude-client.ts:404-406)에 실제 배정을 주입:
   `primary: {name} ({code}) — 이 ETF에 대해 쓸 것. 오늘 왜 주목되는지…` 형식.
   슬롯의 ETF가 undefined면 해당 줄은 기존 일반 지시 유지.
3. `validateMorningReportQuality`에 hard 검사 추가: 각 슬롯 산문(존재 시)이 해당 카드 ETF의
   **정규화된 종목명 또는 6자리 코드**를 포함해야 한다. 정규화: 공백 제거 후 비교
   (chip 표기 "KODEX 반도체(091160)"·"KODEX 반도체 (091160)" 변형 흡수).
   시그니처 변경: `validateMorningReportQuality(report, data, strategy)`는 이미 data를 받으므로
   내부에서 `selectStoryCharacters(data.quotes)` 호출.
4. Tier 1 fallback(narrativeNotes drop) 시 산문이 없으므로 검사는 자연히 skip — 기존 경로 무변경.

### R2. 날짜-요일-상대시제 정합 (market + ETF 공유)

새 모듈 **`lib/temporal-consistency.ts`** (기존 temporal-framing은 프롬프트 주입용이라 별도):

```
checkAndFixTemporal(text: string, reportDate: string /* YYYY-MM-DD */)
  → { fixed: string, softFixes: string[], violations: string[] }
```

- 패턴 A: `(오늘|내일|모레)\s*\(\s*(\d{1,2})\/(\d{1,2})\s*[,·]?\s*([월화수목금토일])\s*\)`
- 패턴 B: `(\d{1,2})\/(\d{1,2})\s*\(\s*([월화수목금토일])\s*\)` (상대어 없는 형태)
- **날짜를 앵커로 신뢰**한다(Claude는 날짜를 캘린더 데이터에서 복사하므로 가장 신뢰도 높음).
  날짜가 reportDate−3 ~ +14일 창 안이면: 날짜로부터 요일·상대어(오늘/내일/모레 = +0/+1/+2 캘린더일)를
  계산해 불일치 토큰을 **soft fix로 교정**. 창 밖(비상식 날짜)이면 **hard violation**.
  상대어가 +0/+1/+2 어디에도 안 맞는 날짜(예: "내일(07/28)")는 상대어를 제거할 수 없으므로 hard violation.
- 연도 경계: reportDate 기준 창 판정이므로 12월↔1월도 안전. 요일 계산은
  `koreanWeekday`(lib/market-calendar) 재사용.
- 적용 방식: **JSON 문자열 레벨**에서 수행. 파싱 성공 확인 후
  `JSON.stringify(content)` → fix → re-parse. 교정 문자열(한글·숫자·괄호)은 JSON
  메타문자를 포함하지 않아 바이트 안전. field-by-field 매핑 코드가 불필요해진다.
- 배선:
  - market: `generateReport`의 재시도 루프(lib/claude-client.ts:479-533) 안에서 파싱 성공 직후
    수행. violations 있으면 파싱 실패와 동일하게 re-roll(재생성 사유 로그). maxRetries 소진 시
    **마지막 콘텐츠로 발송 진행 + 경고 로그** ("품질 낮아도 전송 > 침묵" 원칙 — market엔 Tier 1이 없으므로).
  - ETF: `validateMorningReportQuality` 서두(soft fix 단계)에서 수행. violations는 기존
    violations 배열에 합류 → 기존 재시도·Tier 1 경로 그대로.

### R3. 출처 인용 화이트리스트 (market + ETF 공유)

새 모듈 **`lib/quotable-sources.ts`**:

- `QUOTABLE_SOURCES`: 이름 인용이 허용되는 매체. 초기값(운영하며 조정):
  연합뉴스, 연합인포맥스, 한국경제, 매일경제, 서울경제, 머니투데이, 이데일리, 아시아경제,
  헤럴드경제, 조선비즈, 파이낸셜뉴스, 블로터, 전자신문, 로이터, Reuters, 블룸버그, Bloomberg,
  월스트리트저널, WSJ, 파이낸셜타임스, Financial Times, CNBC, 니혼게이자이, 닛케이.
- `softFixUnquotableSources(text, todaySources: string[])`:
  그날 수집된 뉴스 source 중 화이트리스트에 **없는** 이름 각각에 대해 인용 프레임
  (`{name}에 따르면` / `{name} 보도에 따르면` / `{name}이|가 전한` / `{name} 등 외신에 따르면`)을
  "외신 보도에 따르면"/"외신이 전한"으로 치환. 프레임 밖에 남은 비승인 이름은 soft-warn 로그.
  검출이 그날 소스 목록 기반이므로 오탐 없음(임의 정규식으로 이름을 추측하지 않는다).
- "에 따르면" 빈도: 리포트 전체 8회 이상 hard violation, 5회 이상 soft-warn 로그
  (기존 weakActionCount 관례를 따름, report-quality.ts:310-313).
- 프롬프트에 데이터성 지시 각 1줄 추가(market A1 뉴스 블록·ETF 뉴스 블록):
  "매체명을 본문에 인용할 수 있는 것은 다음뿐: {목록}. 그 외 매체 기사는 내용은 쓰되
  매체명 대신 '외신'으로 지칭." — 스타일 지시가 아닌 데이터 규칙.
- 배선: R2와 같은 지점(문자열 레벨 soft fix + 빈도 hard 검사).

### R4. 미확보 메트릭 렌더 생략 (ETF renderer)

검증이 아닌 렌더 규칙 (lib/etf/renderer.ts):

- Warning Board(전술형 카드)·metric 계열: 값이 null인 메트릭은 '미확보' 표기 대신 **항목 생략**.
- 카드의 모든 메트릭이 null이고 등락률도 null이면 **카드 생략**. 섹션에 카드가 0장이면 **섹션 생략**.
- 등락률만 있으면 카드는 유지(등락률 + 코멘트).
- Characters 카드의 `change: '미확보'`(renderer.ts:996)도 동일 규칙.

## 실패 처리 요약

| 파이프라인 | soft fix | hard violation 시 | 최종 실패 시 |
|---|---|---|---|
| ETF | R2 교정·R3 치환 (기존 soft fix 단계) | 기존 재시도(2회) | 기존 Tier 1 fallback (무변경) |
| market | R2 교정·R3 치환 (파싱 직후) | re-roll (기존 maxRetries=3 루프 공유) | **발송 진행 + 경고 로그** (침묵 방지) |

## 테스트 계획 (node:test, 기존 관례)

- `lib/temporal-consistency.test.ts`: 요일 교정, 상대어 교정(7/21 실사례 "내일(07/23, 목)"→"모레(07/23, 목)"),
  창 밖 날짜 hard, 상대어 불능 hard, 연도 경계, 무패턴 텍스트 무변경.
- `lib/quotable-sources.test.ts`: 비승인 소스 치환(실사례 "Crypto Briefing이 전한"),
  승인 소스 보존, 빈도 카운트.
- `lib/etf/story-characters.test.ts`: 선택 로직 이동 후 동작 보존(기존 renderer 선택과 동일 결과),
  validator 일치/불일치 검출(7/21 실사례 재현).
- 렌더러 생략은 renderer 내부 순수 함수 export 후 단위 테스트(가능 범위).

## 리스크

- JSON 문자열 레벨 치환: 교정 문자열에 JSON 메타문자가 없음을 치환 함수에서 보장
  (교정 대상 패턴이 한글·숫자·`/`·`(),·` 만 포함 — `"`·`\` 불포함 검증 후 치환).
- R1 배정 주입으로 Claude가 배정 ETF명을 앵무새처럼 반복할 가능성 → 지시에 "이름·코드는
  1회 명시 후 자연스럽게" 한 줄 포함, 산문 톤 지시는 추가하지 않음.
- R3 화이트리스트 누락 매체 → 초기엔 soft fix라 발행은 되고 로그로 관찰, 목록만 조정하면 됨.
