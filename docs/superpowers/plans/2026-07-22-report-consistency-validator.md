# 구현 계획 — 정합성 Validator

spec: `docs/superpowers/specs/2026-07-22-report-consistency-validator-design.md`
브랜치: `report-consistency-validator` · 실행: 태스크 순차 (T2→T3→T1→T4), 각 태스크 TDD

## T2. lib/temporal-consistency.ts (신규, 공유)

1. 테스트 먼저: `lib/temporal-consistency.test.ts`
   - "내일(07/23, 목)" + reportDate 2026-07-21 → "모레(07/23, 목)" soft fix
   - "내일(07/22, 목)" (요일 오기) → "내일(07/22, 수)" soft fix
   - "07/23(금)" (요일 오기, 상대어 없음) → "07/23(목)" soft fix
   - "내일(09/15, 화)" (창 밖) → hard violation, 텍스트 무변경
   - "내일(07/28, 화)" (상대어 +0/+1/+2 불능, 날짜는 창 안·요일 정합) → hard violation
   - 연말 경계: reportDate 2026-12-31 + "내일(1/1, 금)" → 2027-01-01 금요일 확인
   - 패턴 없는 텍스트 → 무변경, 빈 결과
2. 구현: `checkAndFixTemporal(text, reportDate)` → `{ fixed, softFixes, violations }`
   - 요일 계산은 `koreanWeekday`(lib/market-calendar) 재사용. KST 고정(Date UTC 파싱 주의 — 기존 market-calendar 관례 따름)
   - 날짜 앵커 원칙·창(−3~+14일)은 spec 참조

## T3. lib/quotable-sources.ts (신규, 공유)

1. 테스트: `lib/quotable-sources.test.ts`
   - "Crypto Briefing이 전한 Micron의 전망" + todaySources ["Crypto Briefing","연합뉴스"] → "외신이 전한 Micron의 전망"
   - "연합뉴스 마켓 보도에 따르면" → 무변경 (승인)
   - "Crypto Briefing과 finance.biggo.com 등 외신에 따르면" → "외신에 따르면" 계열로 정리
   - countAccordingTo("…에 따르면"×6) → 6
2. 구현: `QUOTABLE_SOURCES`(spec 목록), `softFixUnquotableSources(text, todaySources)`, `countCitationPhrases(text)`

## T1. ETF characters 정합

1. `lib/etf/story-characters.ts` 신규: renderer.ts에서 `selectStoryCharacters`·`StoryCharacters`·
   `findQuoteByName`(+`isTacticalEtf` 의존이면 함께) 이동·export. renderer는 import로 전환.
   기존 렌더 결과 불변 확인(이동만, 로직 무변경).
2. 테스트: `lib/etf/story-characters.test.ts` — 선택 로직 스냅샷 + 일치 검증 함수
   (`validateCharacterProse(report, quotes)` 형태): 7/21 사례(카드 나스닥100 ↔ 산문 S&P500) 재현해 검출.
   정규화 비교: 공백 제거, 종목명 또는 6자리 코드 중 하나 포함이면 통과.
3. `buildMorningPrompt`(lib/etf/claude-client.ts:404-406): 배정 주입 —
   각 슬롯에 `{name} ({code})` 명시 + "이 ETF에 대해 쓸 것" + "이름·코드는 1회 명시 후 자연스럽게".
   슬롯 undefined면 기존 문구 유지.
4. `validateMorningReportQuality`(lib/etf/report-quality.ts): hard 검사 추가 (data.quotes로 선택 재계산).

## T2/T3 배선 (T1 이후, report-quality·claude-client 충돌 방지 위해 이 단계에서 일괄)

- ETF: `validateMorningReportQuality` 서두 soft fix 단계에서
  `JSON.stringify(report)` → temporal fix + source fix → re-parse로 report 교체(in-place 반영은 호출부 시그니처 유지 방식으로 — 기존 `applySoftFixesInPlace` 관례처럼 mutate).
  reportDate·todaySources가 필요하므로 시그니처에 최소 추가(기존 호출부 run-etf.ts·claude-client.ts 동반 수정).
  temporal violations + "에 따르면" ≥8 → violations 합류.
- market: `generateReport` 루프(lib/claude-client.ts:479-533) 파싱 성공 직후 —
  rawJson(파싱 검증 완료된 문자열)에 temporal fix + source fix 적용 후 re-parse.
  violations 있으면 re-roll(사유 로그), maxRetries 소진 시 마지막 콘텐츠로 진행 + `⚠️` 로그.
  reportDate는 run.ts에서 내려주거나 기존 REPORT_DATE 처리 경로 재사용.
- 프롬프트 데이터성 지시 각 1줄: market 뉴스 블록·ETF 뉴스 블록에 인용 가능 매체 목록.

## T4. renderer 미확보 생략 (lib/etf/renderer.ts)

- 전술형 보드(≈380-450)·`renderCharacterCard`(≈994-1016): null 메트릭 항목 생략,
  전부 null + 등락률 null → 카드 생략, 카드 0장 → 섹션 생략.
- 가능하면 판정 헬퍼를 순수 함수로 분리해 단위 테스트.

## 완료 기준

- `npx tsc --noEmit` 통과, `npx tsx --test lib/*.test.ts lib/etf/*.test.ts` 전부 통과(기존 68 + 신규)
- `npx eslint .` 신규 에러 0
- 수동 검증: 로컬 dry-run 생성 1회로 (a) characters 배정 주입 확인, (b) 발행 산출물에 '미확보' 미노출 — 단 API 호출 비용이 드므로 사용자 승인 후
