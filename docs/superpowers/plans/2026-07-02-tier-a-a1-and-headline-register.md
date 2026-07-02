# Tier A A1 + 제목 표제어체 — 구현 플랜

> 실행: 인라인(동일 세션) + 엄격 검증. 검증 게이트 = `npx tsc --noEmit` clean + 전체 단위 스위트 통과 + 백필 육안.

**스펙 정정:** 스펙(2026-07-01)은 "단일 모듈(news-collector.ts)"을 가정했으나, 실측 결과 **뉴스 수집기가 둘로 갈라져 있음** — 마켓 `lib/news-collector.ts`(`NewsHeadline`, url 없음, 연합=`yna.co.kr`), ETF `lib/etf/news.ts`(`NewsItem`, url 있음, category 없음, 연합=`yonhapnewstv.co.kr`). 두 모듈·두 타입 병렬 수정.

**TrendForce 정정:** 공개 RSS 부재(전 후보 404). → Google News EN 쿼리 `TrendForce memory HBM DRAM price`(89건 반환)로 대체, 같은 메모리·HBM 리서치 시그널 확보.

---

## 관심사 1 — 국제 AI·반도체 편입 (브랜치 `report-intl-semi-research`)

### Task 1: 타입 확장
- `lib/types.ts` `NewsHeadline`: `category` 에 `"semiconductor"` 추가, `snippet?: string` 추가.
- `lib/etf/types.ts` `NewsItem`: `category?: "korea" | "global" | "economy" | "semiconductor"` 추가, `snippet?: string` 추가.
- 검증: `npx tsc --noEmit`.

### Task 2: 마켓 수집기 `lib/news-collector.ts`
- `FEEDS` 에 반도체 EN 3종(category `"semiconductor"`):
  - `NVIDIA OR TSMC OR Micron HBM AI chip` (source `Google News 반도체벨웨더`)
  - `semiconductor export control chip` (source `Google News 반도체정책`)
  - `TrendForce memory HBM DRAM price` (source `Google News 메모리리서치`)
- `SNIPPET_SOURCES = new Set(["연합뉴스 경제", "연합뉴스 마켓"])`.
- `parseRssItems` 를 export + `<description>` 파싱 추가: 소스가 화이트리스트면 CDATA/HTML 태그 제거·엔티티 디코드·240자 컷 → `snippet`. 아니면 미설정.
- 순수 선별 함수 `selectBalanced(sorted, {topN, maxPerSource, minSemiconductor})` 추출·export: 1차로 semiconductor 최소 `minSemiconductor`(=2)건 예약(maxPerSource 준수), 2차 기존 라운드로빈으로 잔여 채움.
- 검증: Task 5 단위테스트.

### Task 3: ETF 수집기 `lib/etf/news.ts`
- `RssSource` 에 `category` 추가, 기존 6종에 category 라벨링(국내증시=korea, 환율금리=economy, 미증시=global, 정책지정학=global, 원자재=economy, 연합=economy).
- 반도체 EN 3종 추가(category `"semiconductor"`, limit 2씩).
- `SNIPPET_SOURCES = new Set(["연합뉴스"])`.
- `fetchRss` 의 파싱부를 순수 `parseEtfRssItems(xml, source, category, limit)` 로 추출·export: description 파싱 + 화이트리스트 snippet + item 에 category 실음.
- 선별부에 semiconductor 최소 예약(마켓과 동일 로직) — `selectBalanced` 재사용 또는 동형 구현. (모듈 경계상 ETF 내부에 동형 함수 두고 export.)
- 검증: Task 5 단위테스트.

### Task 4: 프롬프트 snippet 노출 + 가드레일
- `lib/claude-client.ts` 뉴스 블록(:186-193): 항목에 `snippet` 있으면 제목 아래 `    ↳ ${snippet}` 한 줄. 블록 말미에 가드레일 3줄:
  - 해외 뉴스·리서치發 주장은 **출처(기관/매체) 명시**.
  - 리서치·전망을 **매수/매도 권유로 번역 금지**(기존 :87 확장).
  - 원문 문단 복제 금지 — 헤드라인·요약의 **사실 인용**만.
- `lib/etf/claude-client.ts` 뉴스 블록(:287-291): 동일 snippet 노출 + 동일 가드레일 3줄.
- 검증: `tsc` + 백필.

### Task 5: 단위테스트
- `lib/news-collector.test.ts`(신규): `parseRssItems` — 화이트리스트 소스 snippet 추출·태그제거·240컷 / Google News 소스 snippet 미설정 / CDATA·엔티티 회귀. `selectBalanced` — semiconductor 최소 예약 보장, topN·maxPerSource 준수.
- `lib/etf/news.test.ts`(신규): `parseEtfRssItems` — 화이트리스트 snippet / category 실림 / limit 준수. 선별 semiconductor 예약.
- 검증: `npx tsx --test $(find lib scripts -name "*.test.ts")` 전부 통과.

### Task 6: 백필 육안 + 머지
- market·etf 백필 1회 → 반도체 뉴스·snippet 이 프롬프트에 들어가고 출처 명시 서술 확인. `git checkout -- public/ data/` 원복.
- `tsc` clean + 전체 스위트 통과 확인 → main 머지 + push.

---

## 관심사 2 — 제목 표제어체 (브랜치 `report-headline-register`, A1 머지 후 main에서 분기)

방향(사용자 승인): **표제어체(명사 종결 또는 기사체 `~다`), 존댓말 `~습니다` 금지, 완결 서술문 지양, 은유는 유지.** ETF 접두어 계약 고정.

### Task 7: 마켓 제목 규칙 `lib/claude-client.ts` "### 제목 작성 규칙"
- 규칙 추가:
  - **표제어체로 쓰십시오** — 명사로 끝맺거나(권장) 기사체 `~다`. **존댓말 `~습니다`·완결 서술문("…했다"는 허용, "…했습니다"·"…을 갈라놓았다" 같은 산문 술어는 지양) 금지.** 신문 표제처럼 조사·어미를 덜어 압축.
  - **의인화 주어 주의** — "서울이 …갈라놓았다"처럼 시장을 능동 행위자로 세워 인과를 뒤집지 말 것. 엇갈린 주체(종목·섹터)를 주어로.
  - 은유·관점은 그대로 살릴 것(위 규칙과 상충하지 않음).

### Task 8: ETF 제목 규칙 `lib/etf/claude-client.ts:319` "[cover.headline 작성 규칙]"
- 동일 표제어체 규칙 추가. 특히 **`~습니다` 종결 금지**(현 07-02 사고 지점).
- 접두어 계약 명시: "출력 headline 은 `오늘의 초점 · ` 뒤에 붙는 **표제어 조각**이다. 완결문·존댓말이면 접두어와 문법 충돌."

### Task 9: ETF 접두어 계약 `lib/etf/renderer.ts:829`
- `오늘의 초점은 ${...}` → `오늘의 초점 · ${...}` (주제격 `은` 제거, 중점 라벨). 헤드라인 종결형과 무관하게 문법 안전.
- 검증: 백필로 story-title 렌더 확인.

### Task 10: 백필 + 머지
- market·etf 백필 → 제목이 표제어체로 나오고 ETF 접두어 걸림 해소 확인.
- `tsc` + 스위트 → main 머지 + push.
