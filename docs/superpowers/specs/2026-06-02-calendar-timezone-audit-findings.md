# 캘린더·Timezone·날짜 정합성 — 감사 findings

작성일: 2026-06-02
상태: 감사 완료 (수정 설계 전 단계 — 브레인스토밍 입력 자료)
방법: 4개 병렬 감사 에이전트(1개 소켓오류 미반환분은 직접 grep으로 보완) + 웹 검증

> 목적: "넓게 감사" 결과를 영속화. 이 문서는 spec이 아니라 발견 목록이며,
> 여기서 sub-project로 분해해 각각 spec → plan으로 진행한다.

---

## 🔴 URGENT — 임박한 실전 오류

### KR 휴일 데이터 누락 (한국 시장 휴장일에 리포트 발송됨)
`lib/market-calendar.ts:44-61` (`KR_HOLIDAYS_2026`)

`getKrStatus`가 휴일 맵에 없는 평일을 `open`으로 판정 → `run.ts:171`·`run-etf.ts:86`의
silent-skip이 안 걸림 → **휴장일에 "오늘 코스피 개장" 리포트를 생성·발송**.

웹 검증된 2026 누락 휴장일:
| 날짜 | 휴일 | 비고 |
|------|------|------|
| **2026-06-03 (수)** | 제9회 전국동시지방선거 (임시공휴일) | **내일 — KRX 휴장 확정(서울경제)** |
| 2026-07-17 (금) | 제헌절 (2026 공휴일 부활) | KRX 휴장(서울경제) — 에이전트도 놓침 |
| 2026-05-01 (금) | 근로자의 날 | KRX 휴장 (이미 경과, 회귀성) |
| 2026-08-17 (월) | 광복절 대체공휴일 (08-15 토) | 대체공휴일 |
| 2026-10-05 (월) | 개천절 대체공휴일 (10-03 토) | 대체공휴일 |

→ 손으로 추린 목록도 불완전(07-17 누락)했음. **공식 KRX 목록을 데이터 소스로** 써야 함.

검증 출처: [서울경제 "6월 3일·7월 17일 증시 쉰다"](https://www.sedaily.com/article/20046212),
[중앙선관위 지방선거 일정](https://www.nec.go.kr/site/nec/ex/bbs/View.do?cbIdx=1104&bcIdx=289351)

---

## 🟠 HIGH

### H1. 휴일 캘린더 정적·2027+ 공백 (위 URGENT의 근본 원인)
`lib/market-calendar.ts:36-79` — `KR_HOLIDAYS_2026`/`US_HOLIDAYS_2026` 하드코딩, 2027년엔
맵이 비어 주말만 잡힘. KR 휴일 → 휴장일 발송, US 휴일 → 가드레일 불발.

### H2. 버그 #1 — US 휴장 가드레일이 잘못된 KST 날짜로 평가 (market·ETF 양쪽)
`lib/market-calendar.ts:167` → `lib/claude-client.ts:282,296-307`, `lib/etf/claude-client.ts:188,198-204`
`isUsClosedOnly`를 `getUsStatus(D)`(KST 날짜)로 계산하지만, 리포트가 다루는 US 세션은
**전날 US 날짜(≈D-1)**. "간밤 미국 휴장, 직전 영업일 종가" 가드레일이 엉뚱한 날 켜지고,
정작 필요한 날(예: MLK 월 01-19 다음날 KST 화 01-20)엔 안 켜져 stale 데이터를 단정.

**제안 predicate**: `getPrevTradingDay(D,"us") !== weekendOnlyPrevDay(D)`일 때 발화.
(주말만 건너뛴 직전일 vs 휴일까지 건너뛴 직전일이 다르면 = 휴일이 간밤 세션을 없앤 것.)
워크드 예시 — MLK: 발화✓ / 일반 화: 침묵✓ / 정상 금 다음 월: 침묵✓(주말 과발화 안 함) / Good Friday 다음 월: 발화✓.

### H3. FRED 경제 캘린더 쿼리 오류 (timezone 무관, 별 버그)
`lib/economic-calendar.ts:42-49` → `claude-client.ts:551-562` → 렌더 `report-renderer.ts:317-341`
`/fred/releases/dates`에서 `realtime_start/end`를 "릴리즈 날짜 창"으로 오해. 실제로는
vintage 기간 파라미터이고 기본 정렬이 `release_date desc`. 클라이언트 날짜 필터 없음 →
"이번 주 주요 일정"에 **과거 릴리즈**가 표시됨. (`kr-macro-calendar.ts:87`은 올바르게 클램프함.)

---

## 🟡 MED

### M1. KR 대칭 갭 — 직전 KR 세션이 휴일일 때 가드레일 없음
`lib/market-calendar.ts:166` → claude-client KR 분기(단, 그 분기는 dead code: run.ts/run-etf.ts가
krStatus!=open이면 generateReport 전 종료). KR 개장일인데 직전 KR 세션이 휴일이면
"어제 코스피 마감"을 정상 세션처럼 단정. 예: 06-03 휴장 후 KST 목 06-04 → "어제 종가"는 실은 06-02.
H2와 대칭 predicate로 처리 가능.

### M2. EU/JP/CN 휴일 캘린더 부재 → stale 외부 데이터를 "간밤"으로 서술
`lib/market-data.ts:39-52`(지수 수집) — 캘린더는 KR·US만. EU/JP/CN 휴일에 stale 종가를
"간밤 마감"으로 framing. 완화: 휴장 시 Yahoo가 price==previousClose(0.00%) 반환 →
"보합" 오라벨 수준. 예: Easter Monday 2026-04-06 (EU 휴장, KR·US 개장) DAX 며칠 stale.

### M3. 24시간 상품(암호화폐·환율·원자재)을 "간밤 마감"으로 라벨
`lib/market-data.ts:92-98`(fetchQuote `regularMarketPrice`), `etf/claude-client.ts:227`("간밤 해외… 환율 야간")
BTC/ETH/KRW=X/JPY=X/CL=F/GC=F 등은 ~24h 거래라 06:40 KST 시점 **실시간 틱**. % 변화 기준도
롤링 reference. 렌더 카드는 중립("+X.XX%")이나 리포트 프레임이 전체를 "간밤 마감"으로 묶음.
→ `marketState`/`regularMarketTime` 읽어 24h 상품은 "실시간(수집시각 기준)"으로 태깅 필요.

### M4. stale-data 해시 가드 무력 + marketState 미점검
`run.ts:210-224` 해시는 KR+US+forex만, KR 개장일에만 도달 → 사실상 never trip, EU/JP/crypto stale 못 잡음.
`marketState`/`regularMarketTime`을 어디서도 안 읽음 → 겨울 US +30분 정착을 검증 없이 신뢰(latent).

---

## 🟢 LOW (latent — 전부 `TZ=Asia/Seoul`로 가려짐, 비-KST 실행시 깨짐. 패턴 일관성 위해 통합 가치)

- 로컬 시간 `getDay()`/날짜 포맷 ~6곳: `market-data.ts:195`(커버 요일), `kr-macro-calendar.ts:102`,
  `etf/morning-report-plan.ts:53`, `economic-calendar.ts:76`, `ecos-data.ts:35-36`, `weekday-rhythm.ts:21`(폴백).
  `weekday-rhythm.ts:17-19`는 `Date.UTC().getUTCDay()`로 올바름 → **하드닝이 불균등**. TZ-safe 문자열 파싱으로 통일 권장.
- `collectHistoricalData`(`market-data.ts:266-285`): 5일 창에서 `quotes[0]` 선택 → "1주/1개월 전" 기준선이
  몇 세션 어긋날 수 있음. 스파크라인 근사치, 헤드라인 수치 영향 없음.

---

## ✅ 검증된 정상 (조치 불필요 — false positive 방지용 기록)

- 핵심 KST "오늘" 날짜 산출: `market-data.ts:16-18`(오프셋), `run-etf.ts:53`(toLocaleDateString sv-SE Asia/Seoul) — TZ 무관 정확.
- `getPrevTradingDay`/`getNextTradingDay`(`:122-145`): 자기 제외·30일 캡·Date.UTC 문자열 — 정확.
- US 2026 휴일 날짜 전부 정확. KR 음력(설날 02-17, 부처님 05-25 대체, 추석 09-25) 정확. 추석 09-26은 토요일이라 비-버그.
- evidence-log retention(count 기반), narrative-memory date-key(KST 일관), kr-macro 윈도·TZ 정합, ETF renderer KST 라벨 — 정상.

---

## 제안 분해 (sub-project)

| | 범위 | 우선도 | 의존 |
|--|------|--------|------|
| **A** | 캘린더 데이터 정확성·지속가능성 (공식 KRX 목록, 2027+ 해결) ← URGENT 06-03 포함 | P0 | — |
| **B** | 휴일 인지 서사 가드레일 (H2 US 하루어긋남 + M1 KR 대칭 + M2 EU/JP/CN) | P1 | A |
| **C** | 데이터 신선도 태깅 (M3 24h 상품 라벨 + M4 marketState/해시) | P2 | — |
| **D** | FRED 경제캘린더 쿼리(H3) — 단독, timezone 무관 | P1 | — |
| **E** | 로컬시간 날짜 하드닝(LOW) — 정리성, TZ-safe 통일 | P3 | — |

권장 순서: **A(긴급) → B·D 병행 → C → E**. 단, 06-03이 내일이라 A의 데이터 패치는
정식 spec 전 **즉시 핫픽스**가 필요할 수 있음.
