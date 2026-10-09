# ETF 렌더러 하드코딩 정리 — 설계

- 날짜: 2026-10-09
- 브랜치: `fix/etf-renderer-hardcode`
- 범위: ETF HTML 렌더러(`lib/etf/renderer.ts`)의 고정 티커·라벨·문구, KRX 병합의 `dailyIndexGap`
- 범위 밖: 리포트 생성 프롬프트(모델 입력은 바뀌지 않음), 유니버스 종목 추가·삭제, `morning-report-plan.ts:58`("자금이 어디로 먼저 몰리는지", 프롬프트 측 — 메모만)

## 배경 (10-06~08 실제 리포트로 확인)

1. **고정 티커가 옛 유니버스 기준.** 09-20 유니버스 35종 교정 때 렌더러 목록은 따라가지 않아, 렌더러의 고정 티커 14개(SCHD·VIG·SMH·IVV·379800·379810·381180·453850·476550·429000·458730·233740·251340·364970)가 수집 대상이 아니다. 결과: 이슈 카드 '배당·인컴'이 시세 없이 "SCHD VIG 458730.KS"를 원코드로 노출, 매칭표 '배당성장'·'장기 미국채' 행이 가격 없는 이름만 표시, 브리지의 '국내 성장 테마 ETF' 자리는 늘 대체 문구. 유니버스에는 배당 ETF가 하나도 없다.
2. **태그 판정이 이름 정규식.** `inferEtfTag`(`renderer.ts:472`)의 `/금/`이 '금융'·'금리'에 걸려 TIGER 200 금융·TIGER 미국달러SOFR금리액티브가 '원자재'. 반대로 KODEX 골드선물(H)·글로벌리튬은 '지수'.
3. **'지수대비'가 의미 없는 숫자인 경우가 많다.** `dailyIndexGap = ETF 등락률 − 기초지수 등락률`(`etf-data.ts:72`).
   - 해외 기초지수: 한국 장 세션과 해외 지수 날짜가 어긋난다. 지수 변화가 0으로 들어오면 자기 등락률이 그대로(10-07 390390 +1.94%p, 10-08 458250 −0.98%p), 0이 아니어도 시차 잡음(10-06 261220 WTI: ETF +3.06%, 지수대비 +4.96%p).
   - 레버리지·인버스: 배수를 무시하고 1배로 뺀다(10-08 인버스2X +4.29% → 지수대비 +6.49%p).
4. **자금 흐름 표현.** 실제 flow 데이터가 없는데 렌더러 고정 문구가 "자금이 몰리는 자리", "이 자금이 어디로 쏠리는지", "자금이 이동하는 흐름"을 쓴다(ETF 프롬프트는 같은 표현을 금지 — `claude-client.ts:411`).

## 결정

- 배당 테마는 **삭제**(사용자 결정 A, 10-09). 유니버스 추가는 수집·프롬프트 입력까지 바뀌어 범위 밖.
- 렌더러의 모든 고정 티커는 유니버스 구성원이어야 한다. 테스트로 고정한다.
- 지수대비 무효화는 **데이터 병합 단계**에서 한다. 렌더러 사용처(`:415` 카드 막대, `:1257` 전술 보드 메트릭, `:1288~1289` 액션 보드 필터·정렬 → `:1321` 출력)가 한 번에 따라온다. `metricItemsHtml`·`renderMetricBar`는 이미 null을 생략한다.

## 변경

### 1. 유니버스: `foreignUnderlying` 표시 (`lib/etf/types.ts`, `lib/etf/universe.ts`)

`EtfDefinition`에 선택 필드 `foreignUnderlying?: boolean` 추가(주석: "국내 상장이지만 기초지수가 해외 세션 — 한국 장 등락률과 지수 등락률의 날짜가 어긋나 지수대비 비교 불가").

`true`로 표시하는 13종(정확히 이 목록):
`360750.KS` `133690.KS` `195930.KS` `099140.KS` `241180.KS` `390390.KS` `394670.KS` `458250.KS` `305080.KS` `132030.KS` `261220.KS` `329750.KS` `456610.KS`

국내 지수(`278540.KS` MSCI Korea TR, 국고채·통안채 등)는 표시하지 않는다.

### 2. KRX 병합에서 지수대비 무효화 (`lib/etf/etf-data.ts`)

`mergeKrxIntoQuotes`에서 `dailyIndexGap`을 다음 조건일 때 `null`로 둔다.
- `getEtfByTicker(q.ticker)?.foreignUnderlying === true`, 또는
- 레버리지·인버스: `isTacticalEtf`(`story-characters.ts`)를 병합 후 이름(`krx.name || q.name`)에 적용해 true.

`underlyingIndexName`·`underlyingIndexClose`·`underlyingIndexChangePercent`는 원값 유지(액션 보드 문구가 지수 이름을 쓴다). `mapKrxEtfDailyTrade`는 바꾸지 않는다(원자료 그대로).

### 3. 태그 판정 (`lib/etf/renderer.ts` `inferEtfTag`, export해서 테스트)

호출부 2곳: 일반 카드 `:419`, 액션 보드 행 `:1337`. 둘 다 같은 함수를 쓰므로 함수만 바꾼다.

순서:
1. `isTacticalEtf(q)` → `'전술'`
2. `getEtfByTicker(q.ticker)`가 있으면 category 기준: `'채권'`→`'채권'`, `'테마'`→`'테마'`, `'섹터'`→`'섹터'`, `'해외지수'`→`'해외지수'`, `'팩터'`→`'팩터'`, `'지수'`→`'지수'`, `'대안'`→ 이름이 `/골드|gold|silver|원유|oil|wti|commodity|원자재/i`면 `'원자재'`, 아니면 `'대안'`(VNQ·BITO).
3. 유니버스 밖: 기존 정규식에서 단독 `금` 제거 — 원자재 정규식은 `/골드|gold|silver|원유|oil|wti|commodity|원자재/i`. 나머지 분기(테마·채권·지수)는 유지.

### 4. 고정 티커 교체 (`lib/etf/renderer.ts`)

- `ETF_LABEL_OVERRIDES` 삭제. `formatKnownTicker`는 유니버스 → 코드 순으로 폴백.
- 원코드 폴백 2곳(`renderIssueEtfs`의 `renderPlainTickerLink(ticker, ticker, …)`, `renderGlobalKrMatching`의 global 폴백)을 `formatKnownTicker(ticker)` 라벨로.
- `renderGlobalKrMatching`
  - 미국 S&P 500: global `SPY` `VOO`, kr `360750.KS`
  - 미국 나스닥 100: global `QQQ`, kr `133690.KS`
  - 반도체: global `SOXX`, kr `091160.KS` `396500.KS` `471760.KS`
  - 장기 미국채: global `TLT` `IEF`, kr `458250.KS` `305080.KS`
  - 배당성장: **행 삭제**
- `renderGlobalKoreaBridge`: `364970.KS` → `365040.KS`(TIGER AI코리아그로스액티브, 대체 문구 '국내 성장 테마 ETF' 유지)
- `renderMarketHeatmap`
  - 반도체·AI: meta `SOXX·국내 반도체`, tickers `SOXX` `091160.KS` `396500.KS`
  - 한국 ETF: meta `수집 KR 50 평균` → `수집 국내 ETF 평균`(실제 50종이지만 고정 숫자를 두지 않는다; 개수는 sampleText가 이미 표시)
  - 환노출 해외: tickers `360750.KS` `133690.KS`
  - 레버리지/인버스: tickers `122630.KS` `252670.KS`
- `renderIssueEtfs`
  - 반도체·AI: tickers `SOXX` `091160.KS` `396500.KS`; reason → `'미국 반도체 흐름이 국내 반도체 ETF 거래대금으로 이어지는지가 오늘의 관전 포인트입니다.'`
  - 배당·인컴: **카드 삭제**
  - 장기채·금리: tickers `TLT` `IEF` `458250.KS`
  - 환노출 미국주식: tickers `360750.KS` `133690.KS`
  - 레버리지·인버스: tickers `122630.KS` `252670.KS`
  - 금·원자재: 변경 없음

### 5. 자금 흐름 문구 (`renderDomesticActionBoard` `liquidityNotes`)

- `[1]` `'자금이 몰리는 자리입니다. 방향보다 변동폭의 크기를 먼저 가늠합니다.'` → `'거래대금이 가장 두꺼운 축입니다. 방향보다 변동폭의 크기를 먼저 가늠합니다.'`
- `[2]` `'수급이 두텁습니다. …'` → `'거래가 두텁습니다. 지표나 거시 변화에 평소보다 민감하게 반응할 수 있습니다.'`
- `[3]` `'유동성은 풍부합니다. 이 자금이 어디로 쏠리는지 함께 살필 타이밍입니다.'` → `'유동성은 풍부합니다. 장 초반 거래대금이 어느 쪽으로 늘어나는지 함께 살핍니다.'`
- `[0]` 유지. 배당·인컴 카드의 "자금이 이동하는 흐름"은 카드 삭제로 사라진다.

## 테스트

- `lib/etf/universe.test.ts`: `foreignUnderlying === true`인 티커 집합이 위 13종과 정확히 같다.
- `lib/etf/etf-data.merge.test.ts`: prev-session 병합 시 (기존 fixture는 gap이 항상 0이므로 **0이 아닌 gap**으로 새 fixture를 만든다)
  - 국내 1배(`069500.KS`, gap 0이 아닌 값)는 `dailyIndexGap` 유지
  - `foreignUnderlying`(`390390.KS`)은 `null`, `underlyingIndexName`·`underlyingIndexClose`·`underlyingIndexChangePercent`는 유지
  - 레버리지(`122630.KS`, KRX 이름 'KODEX 레버리지')·인버스(`252670.KS`, 'KODEX 200선물인버스2X')는 `null`
  - KRX 이름이 빈 문자열이면 `q.name`으로 판정(Yahoo 이름 'KODEX 레버리지' → `null`)
- 신규 `lib/etf/renderer-hardcode.test.ts`
  - `inferEtfTag`: TIGER 200 금융→`'섹터'`, TIGER 미국달러SOFR금리액티브(합성)→`'채권'`, KODEX 골드선물(H)→`'원자재'`, KODEX WTI원유선물(H)→`'원자재'`, KODEX 레버리지→`'전술'`, KODEX 미국반도체→`'테마'`, TIGER 글로벌리튬&2차전지SOLACTIVE(합성)→`'테마'`, TIGER 미국S&P500→`'해외지수'`, MTUM→`'팩터'`, VNQ→`'대안'`, 유니버스 밖 이름 '○○ 금융'→원자재 아님
  - 소스 스캔: `renderer.ts`의 티커 리터럴(따옴표 안 `[0-9][0-9A-Z]{5}\.KS` — `0098F0.KS` 같은 영숫자 코드 포함 — 및 2~5자 대문자) 전부가 유니버스 구성원. 비티커 대문자 상수(NAV·VIX·WTI 등)는 스캔 대상에서 제외하는 허용 목록을 둔다.
  - 소스 스캔: `renderer.ts`에 `/자금이[^.'`]{0,10}(몰|쏠|이동)/`("자금이 어디로 쏠리는지" 포함), `/자금\s*유[입출]/`, `/순유[입출]/` 없음; `ETF_LABEL_OVERRIDES` 없음; `/배당/` 부분 일치 없음(배당성장·배당·인컴 모두)
- 렌더 회귀(신규, 같은 파일): 최소 `CollectedData`·`MorningReport` fixture로 `renderMorningHtml` 실행
  - 병합 결과를 그대로 넣었을 때 해외지수·전술 ETF 행에 '지수대비'가 없고, 국내 1배 ETF는 gap이 `0`이어도 생략되지 않고 `0.00%p`로 표시된다(null만 생략, 0은 유효값)
  - TIGER 200 금융 카드 태그가 '원자재'가 아니다
  - 그룹 시세가 전부 없을 때(quotes에 해당 티커 없음) 이슈 카드·매칭표 폴백이 원코드(`.KS`)를 노출하지 않는다
  - HTML에 '배당'·'자금이 몰리는'이 없다
- 기존 전체: `npx tsx --test lib/*.test.ts lib/etf/*.test.ts` 통과, `npx tsc --noEmit -p .` 통과
- 수동: 머지 전 렌더 회귀 테스트가 만든 HTML을 열어 배치가 깨지지 않았는지 눈으로 확인

## 위험

- 지수대비 패널 후보가 국내 1배 ETF로 줄어 일부 날 패널이 비거나 1~2개만 나올 수 있다. 세 패널이 모두 비면 기존 로직대로 보드 전체가 생략된다 — 허용.
- `isTacticalEtf`를 `etf-data.ts`에서 import: `story-characters.ts`는 types만 import하므로 순환 없음.
- 이 변경은 HTML 표시만 바꾼다. 모델 입력(프롬프트·evidence)은 `dailyIndexGap`을 쓰지 않음(grep 확인) — 품질 검증·재시도 동작에 영향 없음.
