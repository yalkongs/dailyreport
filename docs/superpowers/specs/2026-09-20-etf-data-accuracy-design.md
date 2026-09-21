# ETF 국내 시세 기준일 정확성 — KRX 기준일 가드 + 08:10 발송 전환

작성: 2026-09-20
상태: 설계 승인됨 (2026-09-20, 구현 대기)
계기: 2026-09-19 운영 점검에서 ETF 리포트가 이틀 전 세션의 국내 ETF 시세를 "전일"로 서술해 온 것이 확인됨
검토 이력: Codex(GPT-6) 교차 점검 2회 — 1차 설계(날짜 혼합 폴백)는 결함이 확인돼 폐기하고 이 문서로 재작성

## 문제

`lib/etf/etf-data.ts:338-358`의 병합은 Yahoo에서 받은 국내 ETF(.KS) 시세를 KRX OpenAPI
(`etp/etf_bydd_trd`) 값으로 덮어쓴다(`price: krx.close ?? q.price`, `changePercent`, `volume` …).
KRX 조회는 오늘→D-1→D-2… 순으로 **처음 비어 있지 않은 날짜**를 쓴다(`:101-119`).
06:40 KST에는 전일 데이터가 아직 게시되지 않아 매일 이틀 전 세션이 잡힌다.

| 실행 | 요청 기준일(로그) | 직전 세션 |
|---|---|---|
| 09-18(금) 06:45 | `20260916` | 09-17 |
| 09-16(수) 06:45 | `20260914` | 09-15 |
| 09-14(월) 06:45 | `20260910` | 09-11 |
| 08-21(금) **07:54** | `20260819` | 08-20 |

독자 영향: 09-16 ETF 제목 "코스피 3.65% 급락…밀린 날", 본문 "전일 코스피가 3…" — 실제 직전
세션(09-15)은 −0.85%였고 −3.26%는 09-14. 같은 아침 마켓 리포트와 하루 어긋난다.
같은 D-2 값이 이벤트/조용 모드 판정(`etf-mode.ts:85`)·이상 탐지(`analyzer.ts:19-30`)에도 들어간다.

KRX OpenAPI는 전일 데이터를 익영업일 08:00경 갱신한다고 알려져 있다(비공식 출처. 07:54
실행에서도 D-2였던 로그와는 일치). **공식 확인은 없다.**

## 사용자 결정 (2026-09-19~20)

1. ETF만 08:10 KST 전후 발송. 마켓은 06:40 유지.
2. KRX가 전일 세션이 아닌 날은 **KRX 보조지표를 비운다**(날짜를 섞지 않는다).
3. KRX 게시 시각은 **수집 전용 관측**으로 먼저 측정한다.
4. 개장(09:00) 이후 실행 가드는 이번 범위에서 제외(보류 과제 M4).
5. Fear&Greed 통일(CNN)은 별도 브랜치·별도 머지로 분리(마켓엔 사실상 신규 입력).

## 폐기한 1차 설계와 그 이유

1차 설계는 stale일 때 "가격은 Yahoo D-1, NAV·괴리율·거래대금은 KRX D-2 유지 + 기준일 표기"였다.
재검증으로 확인한 결함:

- **리포트 전체 미발송**: `validateData`(`lib/etf/pipeline-utils.ts:45-55`)는 국내 ETF 한 종이라도
  `|price−nav|/nav > 10%`면 throw한다. D-1 가격과 D-2 NAV를 섞으면 2X 상품(KODEX 레버리지·
  인버스2X)이 하루 10% 넘게 움직인 날 걸린다. 스냅샷 112일 중 |코스피|≥5%가 25일(22%).
- **stale 괴리율의 '오늘' 사실화**: 이상 탐지와 고정 문구 "괴리율이 0.5%를 넘어서는 국내 ETF가
  오늘 N개 관측됩니다"(`morning-strategy.ts:316`), Telegram 이상 탐지 건수는 날짜를 모른 채 값을 쓴다.
- **검증 방법 무효**: 두 job의 checkout이 `ref: main`(`daily-report.yml:227`)이라 브랜치 dispatch는
  main 코드를 실행한다. 중복 가드(`run-etf.ts:68-90`)가 수집 전에 종료하므로 "가드 로그로 게시
  시각 측정"도 불가능했다.

## 설계

### 1. KRX 게시 시각 관측 (먼저 배포, 리포트 무영향)

`daily-report.yml`에 **06:40 KST 정시 dispatch(only=both)에서만** 도는 job `krx-probe`를 추가한다.
새 cron·새 워크플로·cron-job.org 작업이 필요 없다.

> 정정(2026-09-20): 처음엔 07:30 백업 schedule에 편승시켰으나, push 직후 실행 이력을 확인하니
> GitHub schedule 지연으로 08-27 이후 백업의 실제 발화가 09:07~10:20 KST(심하면 12:25·15:12)였다.
> 관측 구간(~09:10)이 통째로 지나가므로 정시 dispatch 편승으로 바꿨다. **이 지연은 Phase 2의
> ETF 백업 cron(08:35 KST 의도)도 사실상 개장 후에 돌게 만든다 — Phase 2 착수 전에 백업 수단을
> cron-job.org 2차 트리거로 바꿀지 재검토한다.**

- `scripts/probe-krx-publish.ts`: `getPrevTradingDay(오늘, "kr")`를 basDd로 5분 간격 조회.
  행이 나오면 `[krx-probe] KST HH:MM:SS 요청=YYYYMMDD 응답 BAS_DD=… N건`을 출력하고 종료.
  09:10 KST까지 안 나오면 "미게시"를 출력하고 종료(exit 0 — 관측 실패가 빨간 배지를 만들지 않음).
- 읽기 전용: 파일 쓰기·커밋·발송 없음. market·etf job과 `needs` 관계 없음. `timeout-minutes: 170`(06:40 시작 → 09:10 마감).
- 한국 휴장일이면 즉시 종료.
- 3~5거래일 로그(`gh run view --log`)로 게시 시각 분포를 보고 발송 시각(08:10)을 확정한다.
  관측이 끝나면 이 job은 제거한다.

### 2. KRX 기준일 가드 (`lib/etf/etf-data.ts`)

- `collectKrxOpenApiEtfDailyTrades`가 **응답 행의 `BAS_DD`**(요청 변수가 아니라)를 함께 반환한다.
- 순수 함수 `resolveKrxSession(rowBasDd, reportDate)` → `'prev-session' | 'stale' | 'none'`.
  기준은 `getPrevTradingDay(reportDate, "kr")`(`lib/market-calendar.ts:145`).
- 병합을 순수 함수 `mergeKrxIntoQuotes(quotes, krxMap, session)`로 분리한다.
  - `prev-session`: 현행 그대로(KRX 공식값이 가격·등락률·거래량·NAV 등을 채움).
  - `stale`·`none`: **KRX 값을 일절 병합하지 않는다.** 국내 quote는 Yahoo 값 그대로이고
    `nav`·`premiumDiscount`·`tradingValue`·`aum`·기초지수 필드는 null.
  - 날짜를 알 수 없는 legacy NAV 경로(`:193-235`)도 `prev-session`이 아니면 쓰지 않는다.
- 하류 동작(기존 코드가 이미 처리, 변경 없음): 국내 NAV가 전부 null이면 `run-etf.ts:123`이
  `krx-nav`를 failedSources에 넣는다 → strong tier·quiet 모드 차단, NAV 10% 검증·괴리율 이상 탐지·
  "오늘 N개 관측" 문구는 값이 없어 발동하지 않는다. 즉 stale인 날은 **"KRX 수집 실패일"과 동일한,
  이미 운영 검증된 경로**로 들어간다(최근 60회 중 14회 발생).
- 매 실행 로그: `[etf-data] KRX BAS_DD=… 기대=… → prev-session|stale|none`.
  `data/etf-evidence-log.json` 엔트리에 `krxBasDd`, `krxSession` 추가(선택 필드).

### 3. 트리거 분리 (워크플로 파일 하나 유지)

> 개정(2026-09-21): 처음엔 백업 schedule을 둘로 나누고 `github.event.schedule`로 job을 분기하려 했으나 폐기했다.
> GitHub schedule의 실제 발화가 09시대로 밀려(9월 15건 전부 09:00 이후) 개장 전 백업으로 쓸 수 없기 때문이다.
> 백업은 cron-job.org 2차 트리거가 맡고 GitHub schedule은 3순위로 그대로 둔다 —
> `docs/superpowers/specs/2026-09-21-backup-and-delivery-recovery-design.md` 참조.

- 워크플로의 `on.schedule`과 job `if`는 바꾸지 않는다. `inputs.only`로만 분리한다.
- ETF 단계에도 `FORCE_REGENERATE` env를 전달한다(현재 market에만 있어 `force_regenerate` 입력이
  ETF에 닿지 않음 — 전환 당일 재생성·검증에 필요).
- cron-job.org(사용자 작업, 4개): 마켓 06:40·07:20 body `{"ref":"main","inputs":{"only":"market"}}`,
  ETF 08:10(관측으로 확정)·08:35 body `{"ref":"main","inputs":{"only":"etf"}}`. 모두 월~금, Asia/Seoul.

### 4. 문구

ETF 프롬프트의 "06:30 KST"(`lib/etf/claude-client.ts:240, 351`) → "한국 증시 개장(09:00) 전".
README·워크플로 주석의 발송 시각 설명 갱신.

## 적용 순서 — 가드와 08:10 전환은 같은 날

가드(설계 2)를 06:40 체제에서 먼저 켜면 **매일** stale 경로가 되어 NAV·괴리율·거래대금이 비고
strong tier가 상시 차단된다(현재 strong 19/60). 사실과 어긋나진 않지만 리포트가 눈에 띄게 얇아진다.
그래서:

1. **관측 job만** main에 머지·push (리포트 무영향). 3~5거래일 관측.
2. 관측 결과로 발송 시각 확정.
3. **가드 + 트리거 분리 + 문구**를 머지·push하고 **같은 날** cron-job.org를 전환한다.
   다음 날 아침부터 ETF는 08:10에만 돌고, KRX가 제때 게시되면 `prev-session` 경로(현행과 같은
   코드 경로, 데이터만 하루 새로워짐)로 들어간다.
4. 첫 3거래일은 로그에서 `krxSession`과 도착 시각을 확인한다. `stale`이 반복되면 발송 시각을 늦춘다.

되돌리기: cron-job.org 두 작업을 원래대로 돌리고 머지를 revert.

## 검증

- 단위 테스트: `resolveKrxSession`(평일·월요일·휴일 다음날·일요일 BAS_DD·빈 응답),
  `mergeKrxIntoQuotes`(세 분기, stale에서 KRX 필드가 하나도 섞이지 않음), stale 입력으로
  `validateData`가 통과하고 괴리율 이상 탐지가 0건인 것(하류 연결 테스트), 관측 스크립트의
  종료 조건. 워크플로 YAML 분기의 정적 assert. `npx tsc --noEmit`, 전체 테스트.
- 실데이터: 로컬엔 KRX 키가 없다. 머지 후 main에서 `only=etf, dry_run=true, force_regenerate=true`
  dispatch로 확인한다(발송·커밋 없음. 08시 전이면 stale 경로, 이후면 prev-session 경로).

## 알려진 한계 (이번 범위 밖)

- 개장 후 실행: Yahoo가 장중가를 주고 시세 시각(`regularMarketTime`)을 보존하지 않는다.
  `prev-session` 경로에서도 KRX 필드가 null인 항목은 `??`로 Yahoo 값이 남는다. 보류 과제 M4.
- 3순위인 GitHub schedule은 08:00 전이나 09:00 이후에 돌 수 있다(전자는 stale 경로, 후자는 장중가 위험 — M4).
- 발송 실패 복구와 실행 간 직렬화는 별도 spec(2026-09-21 backup-and-delivery-recovery)에서 다룬다.
- 두 리포트의 실시간 값(환율·원유·금) 수집 시각이 90분 벌어진다.
- ETF 도착 시각이 06:50 → 08:20 전후로 바뀐다(구독자 체감).
- 투자자별 수급은 별도 KRX 경로이고 원천이 매 실행 403이라 사실상 데이터가 없다.
