# Tier A A1 — 국제 AI·반도체 뉴스/리서치를 리포트 근거로 편입 (설계)

**작성일:** 2026-07-01
**상태:** 설계 (리뷰 대기)
**워크플로우:** brainstorm(본 문서) → writing-plans → subagent-driven-development

---

## 배경 / 문제

두 리포트(Market·ETF)의 뉴스 근거는 전량 **한국 관점** 피드로만 수집된다
(`lib/news-collector.ts` FEEDS 7종: 국내 대형주·수급·증시·환율 5 + 미국증시 1 +
연합뉴스 2). AI·반도체發 **해외 뉴스·연구기관 리서치**가 한국 시장·기업(SK하이닉스·
삼성전자)을 점점 강하게 움직이는데, 그 채널이 파이프라인에 **아예 없다**.

- `parseRssItems`(:96-122)는 `<title>`만 추출 — 기사 요약(`<description>`)을 버린다.
- 미국 관점 피드는 "US stock market" 범용 쿼리 1개뿐 — 반도체 벨웨더(NVIDIA·TSMC·
  Micron) 이벤트를 직격하지 못한다.
- TrendForce·WSTS 같은 메모리/반도체 전문 리서치 소스가 없다.

이 스펙은 IB 리서치 통합 로드맵(Tier A/B/C) 중 **무료 계층 A**의 **첫 슬라이스 = A1**을
정의한다. A2(반도체 벨웨더 실적 캘린더)·A3(공식기관 전망 BOK/IMF/OECD/Fed/WSTS)는
별도 데이터 배관(cron)이 필요하므로 후속 슬라이스로 분리한다.

## 목표 (Goal)

한국 시장·기업에 영향을 주는 **국제 AI·반도체 뉴스와 리서치 헤드라인/요약**을
기존 뉴스 수집기에 편입해, 두 리포트가 그 사실을 **출처 명시하에 근거로** 서술할 수
있게 한다. 기존 동작(한국 피드·신선도·라운드로빈)은 100% 보존한다.

## 범위 (Scope)

### 포함 (A1)
1. **글로벌 반도체 벨웨더 뉴스 쿼리** — 영어 Google News 피드 2~3개 추가.
   - 벨웨더: `NVIDIA OR TSMC OR Micron HBM AI chip` (실적·가이던스·수요)
   - 정책/공급망: `semiconductor export control OR chip act` (미국 수출규제 등)
2. **TrendForce 리서치 RSS** — DRAM·NAND·HBM 가격/수급 리서치. SK하이닉스·삼성 직결.
3. **RSS `<description>` 소스별 발췌** — `parseRssItems`가 실질 요약을 담는 소스
   (연합뉴스·TrendForce)에서만 `snippet`을 추출. Google News description은 링크
   마크업뿐이라 **의도적으로 버린다**(무가치·노이즈).
4. **`NewsHeadline` 타입 확장** — `category`에 `"semiconductor"` 추가 + 선택적
   `snippet?: string` 필드.
5. **가드레일 확장** — 리서치 뷰를 매수/매도 추천으로 번역 금지, 출처 명시, 원문
   재배포 금지 규칙을 두 프롬프트에 명시.

### 제외 (후속 슬라이스 / Tier B·C)
- A2 반도체 벨웨더 실적 캘린더(별도 cron)
- A3 공식기관 전망(BOK ECOS·IMF WEO·OECD·Fed·WSTS)
- 유료 컨센서스 API(Finnhub/FMP/FnGuide)
- 기사 **원문 전체** 크롤링/스크래핑 (느리고 취약 — RSS 요약 한도 내에서만)

## 아키텍처

단일 모듈 확장 중심. 새 서비스·새 cron 없음.

```
lib/news-collector.ts   ← FEEDS 확장 + parseRssItems가 snippet 추출
lib/types.ts            ← NewsHeadline.category += "semiconductor", + snippet?
lib/claude-client.ts    ← 뉴스 블록에 snippet 노출 + 가드레일 문구
lib/etf/claude-client.ts← 동일
lib/etf/report-language.ts ← (필요 시) 리서치 뷰 우회 어휘 차단
```

### 컴포넌트별 책임

**`news-collector.ts` (확장)**
- `FEEDS`에 반도체 카테고리 피드 3종 추가 (Google News EN ×2 + TrendForce ×1).
- `SNIPPET_SOURCES: Set<string>` — description을 신뢰할 소스 라벨 화이트리스트.
- `parseRssItems(xml, source, category)` — `<description>` 파싱 추가. 소스가
  화이트리스트에 있을 때만 CDATA/HTML 태그 제거 후 앞 N자(예: 240자)를 `snippet`에
  실음. 화이트리스트 밖이면 `snippet` 미설정(기존과 동일).
- 라운드로빈 `MAX_PER_SOURCE`·`TOP_N`·신선도 로직은 **그대로**. 단 반도체 카테고리가
  한국 뉴스를 밀어내지 않도록, 카테고리 균형을 위한 최소 배정을 고려(설계 판단은
  plan에서 — 예: `semiconductor` 최소 2건 확보 후 나머지 라운드로빈).

**`types.ts` (확장)**
- `category: "global" | "korea" | "economy" | "semiconductor"`
- `snippet?: string` (요약 발췌, 있을 때만)

**프롬프트 (`claude-client.ts` ×2) (확장)**
- 뉴스 렌더링에 `snippet`이 있으면 제목 아래 한 줄로 노출.
- 가드레일 3줄 추가(아래 §가드레일).

### 데이터 흐름

```
collectNews()
  → FEEDS(한국 7 + 반도체 3) 병렬 fetch
  → parseRssItems: title (+ 화이트리스트 소스면 snippet)
  → dedup(title) → 신선도 필터(48h/72h) → 최신순 정렬
  → 카테고리 균형 + 라운드로빈 선별(TOP_N)
  → NewsHeadline[] (일부에 snippet)
  → 프롬프트 뉴스 블록에 제목 + (snippet) 렌더
  → Claude가 출처 명시하에 사실 서술
```

## 가드레일 / 적법성

리서치·해외뉴스를 근거로 쓰되 다음을 프롬프트에 명시(두 파이프라인 공통):

1. **추천 번역 금지** — "TrendForce가 HBM 가격 상승 전망" 같은 리서치 사실을
   "그러니 SK하이닉스 매수" 같은 매수·매도 권유로 옮기지 말 것. 기존
   `claude-client.ts:87` 원칙의 리서치 뷰 확장.
2. **출처 명시** — 리서치·해외뉴스發 주장은 반드시 출처(기관/매체)를 문장에 드러낼 것.
   출처 없는 수치·전망 날조 금지(`:70-71` 원칙 확장).
3. **원문 재배포 금지** — 헤드라인·짧은 요약의 **사실 인용**만. 리서치 원문 문단
   복제·전문 인용 금지(저작권). 우리는 RSS 요약 한도의 사실만 다룬다.

법적 근거: 뉴스 사실의 출처 명시 인용은 허용. 유료 IB 리포트 원문 재배포는 하지 않음
(Tier A는 무료 공개 소스 + 공개 RSS만 사용).

## 오류 처리

- 신규 피드도 기존 `Promise.allSettled` 경로를 탄다 — 한 피드 실패는 로그 후
  **무시**, 나머지로 진행(graceful degradation). 새 피드가 다운돼도 리포트는 생성됨.
- TrendForce RSS 스키마가 예상과 다르면 `parseRssItems`가 빈 배열 반환 → 무해.
- `snippet` 추출 실패는 `undefined`로 폴백 — title-only 기존 동작과 동일.

## 테스트

- **단위(`news-collector.test.ts` 신규 또는 확장):**
  - `parseRssItems`가 화이트리스트 소스의 `<description>`에서 snippet 추출, HTML 태그
    제거, 길이 제한 적용을 검증.
  - 화이트리스트 밖(Google News) 소스는 snippet 미설정 검증.
  - CDATA/엔티티 디코딩·pubDate 파싱 회귀 검증.
  - 카테고리 균형 선별이 `semiconductor` 최소 배정을 지키는지 검증.
- **통합/백필:** market·etf 백필 1회 생성 후, 반도체 뉴스·snippet이 실제 프롬프트에
  들어가고 리포트가 출처 명시하에 이를 서술하는지 육안 검증. `git checkout -- public/ data/`로 원복.
- `npx tsc --noEmit` clean, 기존 전체 테스트 통과.

## 리스크 / 한계

- **Google News description은 무가치** — 링크 마크업뿐. 그래서 snippet은 소스
  화이트리스트로 제한(연합·TrendForce). 이 한계를 코드 주석에 명시.
- **TrendForce RSS 가용성** — 공개 RSS 엔드포인트가 바뀌거나 rate-limit 걸릴 수 있음.
  실패해도 graceful. plan 단계에서 정확한 URL 검증 필요.
- **프롬프트 비대화** — snippet 추가로 뉴스 블록이 커짐. `TOP_N`·snippet 길이(240자)로
  상한. 반도체 카테고리가 한국 뉴스를 과도하게 밀어내지 않도록 균형 배정.
- **영어 헤드라인 혼입** — 반도체 피드는 영어. Claude가 한국어로 소화해 서술하므로
  문제없으나, 프롬프트에 "출처는 원어, 서술은 한국어" 정도만 안내.

## 후속 (참고)

A1 안착 후: A2(벨웨더 실적 캘린더 — kr-macro-calendar 패턴 재사용), A3(공식기관 전망
주간 cron). Tier B(Finnhub 컨센서스)는 별도 의사결정.
