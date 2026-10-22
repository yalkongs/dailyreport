# iM AI Daily Report

> 매일 평일 개장 전 아침에 발송되는 두 개의 시장 리포트 — Daily Market · ETF Today를 06:40 KST에 함께 생성해 ~06:55에 연달아 발송(08:00 전 도착). Claude Sonnet으로 본문을 작성하고 맥미니 launchd → GitHub Actions + Vercel + Telegram으로 전달한다.

---

## 목표

한국 개인 투자자가 **장 개장 전 아침(06:40 KST 정시 트리거, 두 리포트 모두 08:00 전 도착)** 에 그날의 시장 흐름을 한 호흡으로 파악할 수 있는 보고서를 매일 자동으로 만든다.

- **사실 정합성**: 숫자는 코드가 데이터에서 렌더하고, 문장 속 숫자·기간·환율 방향·근거는 자동 검증(수치 대조 등)을 거친다
- **이야기**: 단편 데이터 나열이 아닌 한 호흡의 narrative
- **실행 가능성**: 09:00 개장 후 무엇을 어떤 순서로 볼지를 구체적으로 안내
- **신뢰성**: 새벽 자동화 + 검증 실패 시에도 Telegram 침묵 방지

---

## 두 개의 리포트

2026-10-19 개편으로 두 리포트를 짧은 구성으로 바꿨다(섹션 순서는 아래 "리포트 구성"). 설계 전문: [`docs/superpowers/specs/2026-10-17-morning-reports-redesign-design.md`](./docs/superpowers/specs/2026-10-17-morning-reports-redesign-design.md).

### 1. Daily Market — 어제와 오늘

- 전일 한국·미국 시장의 **분위기를 말로** 풀고 오늘 볼 것을 알려 준다 — 세 줄 요약 + 핵심 지표 6개 + 4~6문단(사건 → 근거 있는 원인 → 시장 반응)
- 오늘 볼 것은 최대 3개(한국시간 순서), 한국 시장에 주는 의미는 2~3개("확인되면 / 어긋나면")
- 시장 모드(event/normal/quiet)는 "어제 무슨 일이 있었나"의 **분량(3~6문단) 조절에만** 쓴다. 횡보일에는 어제 이야기를 딥다이브 주제로 풀지만 분량은 같다. 자산군 관점은 ETF Today가 맡는다

### 2. ETF Today — 내 자산군 관점

- Yahoo Finance(전일 종가·등락·거래량, 거래대금은 종가×거래량 추정) · FRED · ECOS · 뉴스 RSS 등 다층 데이터 소스 통합. KRX OpenAPI(전일분 ~08:00 게시)는 06:40에 보통 게시 전이라(월요일 포함) 병합되지 않는다(아래 "데이터 시점")
- 세 줄 요약 + **자산군별 판단 재료 카드 최대 6개**(대표 ETF "예시", 등락은 코드 렌더, 데이터가 없는 자산군은 빠짐) + 오늘 확인할 것 3가지 + 레버리지·인버스 주의(변동성 큰 날만)
- **이상 탐지**(`lib/etf/analyzer.ts`)는 화면에 그리지 않는다. ETF 모드(event/normal/quiet) 판정과 근거 로그(`data/etf-evidence-log.json`)에만 쓰인다(텔레그램 캡션에도 싣지 않는다). 06:40에는 KRX NAV·괴리율이 보통 없어 추적오차·괴리율 룰은 입력이 없고 거래량 급증 룰이 남는다(KRX가 병합된 날은 괴리율 룰도 발동할 수 있다)
- ETF Today의 모든 ETF 언급은 **Google Finance 링크 chip**으로 자동 변환

> 개편 전(~2026-10-16) 구성 — Market의 paragraph 12+ 블록·자산군 온도계, ETF의 Big Picture·Story Spine·Characters·Resolutions·Strategy Map·이상 탐지 카드 — 은 새 형식에서 화면에서 빠졌다(Market의 pullQuote는 0~1개로 줄었고 dataCard는 쓰지 않는다. 렌더러는 옛 콘텐츠용으로 두 블록을 그대로 그린다). 과거 리포트 HTML과 주소는 그대로 남아 있다.

---

## 리포트 구성

독자는 주식·금융상품 경험이 조금 있는 개인 금융 고객(iM뱅크 직원은 고객 응대 소재로도 사용)이다. 텔레그램은 URL만 전달하므로 **웹 페이지가 본체**, 링크 미리보기 카드가 첫인상이며 대부분 모바일에서 열린다. 두 리포트는 역할을 나눈다 — Daily Market은 시장 전체의 어제와 오늘, ETF Today는 자산군별 판단 재료. 숫자는 코드가 데이터에서 렌더하고 모델은 문장(해석)을 쓴다. 법적 고지는 두 페이지 모두 맨 끝.

### Daily Market — 어제와 오늘 (`/reports/YYYY-MM-DD`)

1. 머리글 + **스트라이프**(최근 20거래일 코스피 띠, 한 줄 설명)
2. 제목·부제 (미리보기 카드와 같은 제목)
3. **세 줄 요약** — 어제(분위기를 말로) / 오늘 볼 것 / 내 자산은 → ETF Today 링크. 첫 줄 라벨은 직전 한국 거래일에 맞춘다(어제·지난 금요일·직전 거래일, `lib/session-label.ts`)
4. 핵심 지표 6개 — 코스피·S&P500·나스닥·원/달러·미 10년물 + 그날 변수 1개(유가·금·비트코인 중 등락 최대)
5. 어제 무슨 일이 있었나 — 4~6문단(사건 → 근거 있는 원인 → 시장 반응). 제목의 "어제"도 위 라벨을 따른다
6. 오늘 볼 것 — 최대 3개, 한국시간 순서(미국 발표는 "장 마감 후 → 다음 거래일 반영")
7. 한국 시장에 주는 의미 — 2~3개, "확인되면 / 어긋나면"
8. 펼쳐 보기(기본 접힘) — 전체 지표 13개, 이번 주 일정표, 과거 비교
9. 참고한 뉴스 · 데이터 기준(수집 시각·전일 대비) · 푸터(마무리 한 문장·법적 고지 — 맨 끝)

### ETF Today — 내 자산군 관점 (`/etf-reports/YYYY-MM-DD`)

1. 머리글 + **모자이크**(Korea / USA ETF, 한 줄 설명)
2. 제목·부제
3. **세 줄 요약** — 해외 신호 / 국내 상태 / 오늘 핵심
4. 자산군별 판단 재료 최대 6개 카드(국내 대형주 · 국내 반도체·IT · 그날 움직인 국내 섹터 · 미국 주식(환노출) · 채권 · 금·원자재) — 카드마다 어제 움직임(대표 ETF "예시", 등락은 코드 렌더) / 이유(근거 있을 때만) / 갖고 있다면 / 새로 본다면. 자산군·대표 ETF·순서(대표 ETF 등락 폭이 큰 순)는 코드가 정하고(`lib/etf/asset-classes.ts`), 데이터가 없는 자산군은 카드에서 빠진다. 모델이 빠뜨린 카드는 숫자만 있는 카드로 그린다. "갖고 있다면·새로 본다면"은 조건·관찰형 문장만(매수·매도 권유 금지)
5. 오늘 확인할 것 3가지 — 시각 + 비교 기준 + 어긋나면 버릴 가설
6. 레버리지·인버스 주의(변동성이 큰 날에만)
7. 펼쳐 보기 — 국내·미국 ETF 표(등락, 추정 거래대금)
8. 참고한 뉴스 · 데이터 기준(전일 종가, NAV·괴리율은 "주문 전 장중 iNAV 확인") · 법적 고지(맨 끝)

- **데이터 시점**: ETF는 전일 종가·등락·거래량을 Yahoo에서 받고, 표의 거래대금은 항상 종가×거래량 추정값이다. KRX OpenAPI는 전일분을 익영업일 08:00 KST쯤 게시하므로 06:40 정시 실행에서는 **월요일을 포함한 모든 평일에** 보통 게시 전이다 — 조회는 하지만 응답 행의 `BAS_DD`가 직전 한국 거래일과 다르면 KRX 값을 병합하지 않는다(`lib/etf/krx-session.ts`, stale/none → 병합 안 함, 날짜 혼합 금지). 월요일도 금요일분이 월요일 08:00쯤 게시되므로 06:40에는 병합되지 않는다(2026-10-19 월 06:40 실행 로그: `KRX BAS_DD=20261015 기대=20261016 → stale — KRX 값을 병합하지 않습니다`). 즉 ETF Today는 평소 KRX 없이 발행되고, KRX 거래대금·NAV·괴리율은 기대 `BAS_DD`가 게시된 뒤 실제로 생성하는 늦은 실행(맥미니가 죽은 날 늦게 발화한 백업 cron, 08:00 이후 수동 재생성 등)에서만 병합된다. 판정은 실행 로그 `[etf-data] KRX BAS_DD=… 기대=… → prev-session|stale|none`에 남는다.
- 제거된 화면 요소: Market의 자산군 온도계, ETF의 Decision Frame·Story·Characters·전략 지도·매칭표·이슈 카드·액션 보드·규칙 점수. (ETF의 시장 국면·규칙 점수·리스크 알림은 프롬프트의 참고 입력(`lib/etf/morning-strategy.ts`)으로만 남고 화면에는 나오지 않는다.)
- **F02 정책 유지: "품질 낮아도 전송 > 침묵"**. 사실 검증·구조·형식 문제는 1·2회차에는 재생성 사유이고, 마지막 축소판(ETF Tier 1 · Market 3회차)에서는 경고로만 남기거나 코드가 고쳐서 발송한다. ETF는 **매수·매도 권유 표현과 필수 필드 누락만** 마지막 시도에서도 막고, Market은 비거나 빠진 세 줄 요약·카드 한 줄을 기본 문장으로 채워 발송한다(매수·매도 권유 금지는 프롬프트 규칙). 마지막 호출을 못 하거나(예산 초과) 실패·파싱 실패하면, 파싱된 앞선 결과 중 가장 나은 것을 같은 축소판 기준으로 발송한다. 발송할 결과가 하나도 없을 때만 생성 job이 실패(exit 1)하고 07:20 2차 트리거가 다시 시도한다.

---

## 미리보기 카드

텔레그램·카카오톡 등 링크 미리보기의 첫인상. 휴대폰에서 카드 폭이 약 300pt이므로 **큰 요소 2~3개만** 두고 제목 외 글자를 최소화한다. 숫자는 숫자 자체가 뉴스일 때만 제목 안에 넣고, 지수 등락률처럼 다른 곳에서 보는 숫자는 넣지 않는다. 세부는 메신저가 자체 글꼴로 보여주는 `og:description`(90자 이내 한 문장 — Market은 세 줄 요약의 어제+오늘 줄, ETF는 해외 신호 · 오늘 핵심 줄)이 맡는다.

| 항목 | Daily Market | ETF Today |
|------|--------------|-----------|
| 배경 데이터 | 최근 20거래일 코스피 **스트라이프**(하루 = 세로 줄, 휴장일 없음, 마지막 줄 아래 ▼ = 어제) | 분석한 ETF **모자이크**(Korea 왼쪽 / USA 오른쪽, 레버리지·인버스 제외, 분류(지수·해외지수·섹터·테마·팩터·채권·대안) 순으로 묶고 그 안에서 등락률 오름차순, 면당 최대 50개) |
| 제목 아래 한 줄 | 배경 한 문장(라벨 없는 평서문). 입력 근거가 있을 때만 단정, 약하면 같은 자리에 오늘 확인점 | "○○를 갖고 있다면" + 관찰형 문장(○○ = 모델이 고른 자산군 `card.key`, 기본은 코드가 정해 프롬프트로 알려 주는 "국내 자산군 중 그날 가장 크게 움직인 것". 그 자산군 구성원 ETF 타일은 검은 테두리) |

- **규격**: 서버에서 PNG 렌더, 1080×1350, 바탕 #FFFFFF, 위쪽 끝 민트 그라데이션 테두리 12px(#00BFA5 → #8BE08F), 하단 띠 없음. 로고는 `public/im-bank-logo.png` 원본을 비율 그대로 내용 영역만 잘라 표시(변형 금지). 글꼴 Pretendard(`assets/fonts/Pretendard-{SemiBold,Bold,ExtraBold}.otf`, OFL), 최소 40px.
- **글꼴·줄바꿈**: PNG는 sharp가 시스템 글꼴로 그리므로 Pretendard는 Actions 러너에 사용자 글꼴로 등록한다(아래 "실행 환경"). 줄바꿈은 Pretendard 실측 글자폭으로 계산해(`lib/preview/data-card.ts`) 글꼴이 없어 Noto CJK로 그려지면 폭이 조금 어긋날 수 있다. 제목·한 줄이 길면 글자를 단계적으로 줄이고(제목 94/88→72px, 한 줄 58→48px 등 `CARD_TEXT_RULES`), 그래도 규칙 안에 안 들어가면 1·2회차에는 모델이 다시 쓰게 한다. 마지막 수단으로 렌더러가 마지막 줄을 '…'로 줄여 항상 카드 안에 그린다.
- **색**: 상승 빨강·하락 파랑 연속 색, |5%|에서 최대, 밝기 차이로 색약 대비. 스트라이프 띠는 0~560px 전폭, 모자이크 띠는 0~600px.
- 페이지 머리에도 같은 그림을 두고 아래에 무엇인지 한 줄로 설명한다(범례는 카드에 넣지 않는다).
- `og:site_name`은 "iM뱅크"(텔레그램이 이 이름을 표시). 카카오톡 도메인 표시는 별도 과제(하위 도메인).

---

## 측정

Vercel Web Analytics를 사이트 전체에 적용했다(`@vercel/analytics`, `src/app/layout.tsx`의 `<Analytics />`). **Vercel 프로젝트 설정에서 Web Analytics를 활성화**해야 수집된다. 텔레그램 링크에는 `?utm_source=telegram`이 붙는다(카카오톡·앱은 사람이 링크를 옮겨 구분되지 않을 수 있다). 개발 모드에서는 수집하지 않는다.

---

## 아키텍처

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Data sources │→ │ Code pre-fill│→ │ Claude prompt│
│              │  │ (수치·슬롯)    │  │ (서사·해설)    │
│  • KRX(조건부)│  │              │  │              │
│  • Yahoo Fin │  │ 수치·점수·     │  │ headline,    │
│  • FRED      │  │ 슬롯·구조      │  │ 세 줄 요약,   │
│  • ECOS      │  │              │  │ 카드 문장     │
│  • Google RSS│  └──────────────┘  └──────────────┘
└──────────────┘            ↓               ↓
                    ┌──────────────────────────┐
                    │ Soft fix + Hard validator│
                    │ (어휘 자동 교정 / 차단)      │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Renderer → HTML + PNG    │
                    │ (chip 변환·띠·카드·표)       │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Git push → Vercel deploy │
                    │ → Telegram sendPhoto     │
                    └──────────────────────────┘
```

### 실행 환경
- **GitHub Actions** `workflow_dispatch` — 맥미니 launchd(`ops/macmini/`)가 월~금 06:40·07:20 KST에 `only=both`로 호출(Market·ETF 병렬 생성 → 발송 job 하나가 Market → ETF 순으로 발송). 3순위 백업 `schedule` cron `30 22 * * 0-4` UTC = 07:30 KST
  - 러너는 **`ubuntu-24.04`로 고정**(기본 이미지가 Ubuntu 26으로 바뀌는 2026-10-19~와 개편이 겹치지 않게). `daily-report`·`delivery-monitor`·`ci`·`refresh-kr-macro` 네 workflow 모두 같다. Node 20.
  - **글꼴 설치**(생성 job 둘, 러너에는 CJK 글꼴이 없다): `fonts-noto-cjk`를 apt로 설치하되 각 시도에 timeout을 걸어 3회 재시도하고(step 상한 5분), 모두 실패하면 `::error::`로 job을 실패시킨다(CJK 글꼴 없이는 프리뷰 PNG가 깨진다). 이어 `assets/fonts/Pretendard-*.otf`를 `~/.local/share/fonts`에 등록한다 — 파일이 없거나 등록에 실패하면 step은 실패시키지 않고(전송 > 침묵) `::error::` 주석만 남기며 카드는 Noto CJK로 렌더된다. 카드가 쓰는 굵기(800·600)가 어느 글꼴로 잡혔는지 `fc-match` 결과를 로그에 남긴다.
- **Vercel** Next.js 16 (App Router) 정적 배포 + Open Graph 프리뷰
- **Telegram Bot API** `sendPhoto` 로 PNG 프리뷰 + 헤드라인 캡션 + 리포트 링크

---

## 핵심 특장점

### 1. 코드 vs Claude 역할 분담
- **코드**: 핵심 지표·ETF 등락·추정 거래대금 등 모든 숫자, 자산군 슬롯(카드 구성·대표 ETF·순서·미리보기 카드 자산군), 레버리지·인버스 주의 조건(전술형 ETF |등락| 10% 이상인 날만), 시장 모드(분량 조절), 이상 탐지 — 결정론적·검증 가능 영역
- **Claude**: 제목, 세 줄 요약, 해석 문장 — 자유로운 서술 영역(문장 속 숫자는 수치 대조 검증을 거친다)
- 양쪽이 보완: 코드는 "어떤 데이터인지", Claude는 "이게 무엇을 의미하는지"

### 2. 서사 앵글 시스템
- 매일 자동으로 다른 관점 적용 → 같은 데이터·같은 시장이어도 매번 다른 각도의 글
- **Market**: 10종 앵글(`lib/narrative-angles.ts`)에서 최근 5일 미사용 앵글을 무작위로 골라 프롬프트의 "오늘의 관점"으로 준다. 제목(근거가 단단한 날의 은유)과 "한국 시장에 주는 의미"가 이 관점을 따르고, 사용 이력은 `data/narrative-log.json`에 최근 30건 보관
- **ETF**: 8종 서사 앵글(`lib/etf/narrative-angle.ts`)과 7종 분석 렌즈(`lib/etf/analysis-lens.ts`)를 같은 방식(최근 5회 미사용 우선)으로 골라 프롬프트에 한 줄 관점 가이드로 넣는다(`scripts/run-etf.ts` → `lib/etf/claude-client.ts`). 이력은 `data/etf-narrative-angle-log.json`·`data/etf-lens-log.json`에 최근 30건. 개편 전 본문 필드(`narrativeNotes` 등)는 출력 스키마에서 사라졌으므로 앵글은 본문을 관통하는 뼈대가 아니라 세 줄 요약·자산군 카드 문장·제목의 방향 힌트로만 작동한다

### 3. 표제어체 헤드라인
- 제목은 한 호흡의 **표제어체**(명사 종결 또는 기사체 '~다', 존댓말 종결 금지). 길이는 Market 15~25자·ETF 14~26자 권장(ETF 최대 28자). 미리보기 카드의 큰 제목이기도 하다
- 수치 앵커는 제목이 아니라 부제가 받친다 — ETF 제목은 티커·6자리 코드 대신 한국어 명칭을 쓰고 등락률·티커를 제목 맨 앞에 두지 않는다
- 근거 상태(tier: strong/thin/hollow)가 은유 강도를 정한다. 근거가 약하면(hollow) 은유 없이 사실 모드로 쓴다. 최근 헤드라인(Market 로그 5건·ETF 최근 7건)의 핵심 단어·구문 틀 반복은 프롬프트로 피하게 한다
- "지수·시장·증시" 단독 표기는 ETF 커버(제목·부제)에서 1·2회차 재생성 사유(마지막 시도는 경고, 한국 독자의 KOSPI 오해 방지). Market에는 이 규칙이 없다(프롬프트는 시장을 행위자로 세우는 의인화 주어만 막는다)
- **클리셰 방지 = 규칙→취향** (2026-06): 단어 금지 리스트 대신 목표 보이스 예시+원칙(`lib/voice-exemplars.ts`)으로 결을 따르게 하고, 단어뿐 아니라 구조·구문 틀("X가 그린 Y" 류) 반복도 피하게 지시

### 4. 2단계 품질 검증 시스템
- **ETF**(`lib/etf/report-quality.ts`): **Soft fix**(자동 치환)는 "구조입니다" → "흐름입니다", "시사합니다" → "말해 줍니다" 등 16종, 시점·출처 정합 교정, 매수 권유성 어휘 중립화(`lib/etf/report-language.ts`). **Hard validation**(재생성 사유)은 투자 권유 표현 · 사실 오류(수치 대조·주간 둔갑·환율 방향) · 출력 구조(필수 필드·자산군 key·확인 3개) · 카드 문구 규칙 · 표기 형식 · 시점·인용 빈도 등. Soft가 먼저 적용된 후 Hard가 통과/실패 판정
- **Market**(`lib/claude-client.ts`): 시점·출처 soft fix(`lib/temporal-consistency.ts`·`lib/quotable-sources.ts`) 뒤 시점 정합·세 줄 요약·카드 한 줄(길이·질문형·라벨·카드 글자 맞춤) 검증으로 재생성 여부를 정한다
- 사실·형식 검사는 마지막 시도에서 경고로 바뀐다(위 F02)

### 5. 생성 fallback 경로
- **ETF**(`generateMorningReportWithFallback`): 엄격 검증 최대 2회 → 못 통과하면 **Tier 1 fallback** = 한 번 더 생성해 축소판 검증(사실·형식은 경고, 구조는 교정, 준법·필수 필드만 막음) → 그것도 안 되면 앞선 결과 중 가장 나은 것을 같은 축소판 검증으로 발송 → 발송할 결과가 없을 때만 실패(exit 1)
- **Market**(`generateReport`): 최대 3회 생성(Tier 1 없음). 마지막 시도의 위반은 경고로 두고 발송하며, 마지막 호출을 못 하거나 실패하면 앞선 결과로 발송한다. 비거나 빠진 세 줄 요약·카드 한 줄은 기본 문장으로 채운다(`fillMarketSummaryDefaults`)
- 두 경로 모두 생성 예산(Market 14분·ETF 10분, `lib/claude-budget.ts`)을 넘기면 새 호출을 시작하지 않는다
- "품질 낮아도 전송" > "Telegram 침묵" 트레이드오프 — 새벽 자동화의 최악 시나리오 차단

### 6. 뉴스 수집 다각화
- RSS 분산 수집 — ETF 9개 피드(국내증시 · 환율금리 · 미증시 · 정책지정학 · 원자재 · 연합뉴스 · 국제 반도체 3종), Market 10개 피드(대형주 이벤트 · 수급 · 증시 · 환율금리 · 미증시 · 연합뉴스 경제·마켓 · 국제 반도체 3종)
- 48시간 초과 기사 자동 제외, 신선 기사가 부족하면 72시간까지 확장 (호르무즈 stale news 사고 방지)
- Source 다양성 라운드로빈 선별(source당 최대 3건), 국제 반도체 기사는 최소 건수 예약

### 7. ETF Chip 자동 렌더링 (ETF Today)
- 본문의 모든 ETF 언급(KODEX·TIGER·SOXX 등)이 자동으로 Google Finance 링크 chip으로 변환
- "KODEX 반도체 (091160)" (공백 포함) / "KODEX 반도체(091160)" / "SOXX" 등 다양한 형태 후보 등록

---

## 구현 방식

### 디렉토리 구조
```
.
├── .github/workflows/
│   ├── daily-report.yml                  # 생성(market·etf 병렬) + 발송(deliver) — ubuntu-24.04
│   ├── delivery-monitor.yml              # 07:45 도착 감시
│   ├── ci.yml                            # push·PR마다 npm test + typecheck
│   └── refresh-kr-macro.yml              # 주간 한국 매크로 일정 갱신
├── ops/macmini/                          # launchd 트리거(morning·monitor plist, dispatch.sh, monitor.sh, install.sh)
├── assets/fonts/                         # Pretendard OTF(카드 PNG 글꼴, OFL) — Actions 러너에 사용자 글꼴로 등록
├── scripts/
│   ├── run.ts                            # Market 파이프라인 진입점
│   ├── run-etf.ts                        # ETF 파이프라인 진입점
│   ├── delivery-state.ts                 # 발송 판정·상태 기록(resolve·status·mark·classify)
│   ├── check-delivery.ts                 # 도착 감시 판정
│   ├── check-published.ts                # 발행물 정확성 검사(공개 페이지 ↔ 원천 시세)
│   └── collect-data.ts                   # 데이터 수집 단독 실행
├── lib/                                  # Market 리포트 코드 (테스트는 각 모듈 옆 *.test.ts)
│   ├── claude-client.ts                  # Claude API + 프롬프트 + 검증·재생성(최대 3회)
│   ├── claude-budget.ts                  # 생성 예산·요청 타임아웃
│   ├── narrative-angles.ts               # 10종 앵글
│   ├── narrative-memory.ts               # 최근 로그 회피
│   ├── sideways-detector.ts              # 횡보 감지(딥다이브 주제)
│   ├── market-mode.ts                    # event/normal/quiet 모드(분량 조절)
│   ├── market-data.ts                    # 시장 데이터 + 코스피 20거래일 일간 등락(스트라이프)
│   ├── market-summary.ts                 # 세 줄 요약·카드 한 줄 텍스트 도구(og:description)
│   ├── session-label.ts                  # 직전 한국 거래일 라벨(어제·지난 금요일·직전 거래일)
│   ├── fred-data.ts / ecos-data.ts       # 거시 데이터
│   ├── news-collector.ts                 # RSS 수집
│   ├── report-renderer.ts                # Market HTML 생성
│   ├── delivery-state.ts                 # 발송 상태 판정(순수 함수)
│   ├── market/preview.ts                 # Market 미리보기 카드 PNG 저장
│   ├── preview/                          # 미리보기 카드 공용 모듈
│   │   ├── data-card.ts                  # 스트라이프·모자이크·카드 SVG/PNG, 글자 맞춤(페이지 머리 띠도 같은 그림)
│   │   ├── card-size.ts                  # 카드 크기(1080×1350)
│   │   └── brand-logo.ts                 # 로고 로더
│   └── etf/                              # ETF 리포트 코드
│       ├── claude-client.ts              # ETF Claude + 프롬프트 + 검증·재생성(2회 + Tier 1)
│       ├── narrative-angle.ts            # 8종 ETF 앵글
│       ├── analysis-lens.ts              # 7종 데이터 렌즈
│       ├── etf-data.ts                   # Yahoo 시세(전일 종가·등락·거래량), KRX는 날짜가 맞을 때만 병합
│       ├── krx-session.ts                # KRX 응답이 직전 거래일분인지 판정(prev-session|stale|none)
│       ├── asset-classes.ts              # 자산군 슬롯(카드 구성·대표 ETF·순서·카드 자산군)
│       ├── morning-strategy.ts           # 시장 국면·규칙 점수 — 프롬프트 참고 입력(화면 표시는 제거)
│       ├── analyzer.ts                   # 이상 탐지(화면 미표시 — 모드·로그·텔레그램 캡션용)
│       ├── etf-mode.ts / etf-evidence.ts # ETF 모드·근거 tier 판정
│       ├── story-characters.ts           # 레버리지·인버스(전술형) ETF 판정(isTacticalEtf)
│       ├── news.ts                       # ETF 전용 뉴스
│       ├── renderer.ts                   # ETF HTML·미리보기 PNG 렌더
│       ├── report-preview.ts             # og 메타·미리보기 URL
│       ├── report-quality.ts             # Soft + Hard 검증
│       └── report-language.ts            # 어휘 정규화
├── src/app/                              # Next.js App Router
│   ├── layout.tsx                        # 공통 레이아웃 + Vercel Web Analytics(<Analytics />)
│   ├── page.tsx                          # 홈
│   ├── archive/page.tsx                  # 과거 리포트 아카이브
│   ├── reports/[date]/page.tsx           # Market 리포트(/reports/YYYY-MM-DD)
│   └── etf-reports/[date]/page.tsx       # ETF 리포트(/etf-reports/YYYY-MM-DD)
├── docs/superpowers/{specs,plans}/       # 설계·구현 계획(개편: 2026-10-17-morning-reports-redesign)
├── data/                                 # 운영 로그 (커밋됨)
│   ├── reports-index.json                # Market 인덱스
│   ├── etf-reports-index.json            # ETF 인덱스
│   ├── narrative-log.json                # Market 앵글·제목 로그(최근 30건)
│   ├── etf-lens-log.json                 # ETF 렌즈 로그
│   ├── etf-narrative-angle-log.json      # ETF 앵글 로그
│   └── etf-evidence-log.json             # ETF 근거 tier·모드·KRX 세션 일별 로그
└── public/
    ├── reports/                          # 발행된 Market HTML + 카드 PNG(YYYY-MM-DD-preview.png)
    ├── etf-reports/                      # 발행된 ETF HTML + 카드 PNG
    └── im-bank-logo.png                  # 로고 원본(카드·머리글)
```

### 파이프라인 (ETF 기준)

0. **가드**: 한국 휴장(주말·휴일)이면 생성·발송 없이 종료(silent skip), 같은 날 리포트가 이미 있으면 종료(`FORCE_REGENERATE=true`면 재생성), 휴일 캘린더에 그 해가 없으면 실패
1. **데이터 수집** (병렬): ETF 시세(Yahoo, KRX는 직전 거래일분이 게시된 경우만 병합) + 자금흐름 + 투자자별 매매 + 거시 지표 + 지수 실측 + 미국 지표 일정 + 뉴스
2. **데이터 검증**: 시장별(국내 50·미국 50) 유니버스 대비 60% 이상, 전체 실패율 40% 이하 수집 성공 확인(미달이면 실패)
3. **분석 렌즈 + 서사 앵글 선택**: 최근 5일 미사용 우선 무작위
4. **이상 탐지** → ETF 모드·근거 tier 판정(화면에는 그리지 않음)
5. **Claude 생성**: 시스템 프롬프트 + 자산군 슬롯 + 레버리지·인버스 조건 + 앵글 가이드 + 헤드라인 규칙. 엄격 검증 최대 2회 → Tier 1 fallback → 앞선 결과 (위 "생성 fallback 경로")
6. **HTML·카드 PNG 렌더링**: 슬롯·등락·표는 코드가 그리고 모델 문장을 채운다(모델이 빠뜨린 슬롯은 숫자만 있는 카드). 미리보기 카드 PNG도 함께 만든다
7. **인덱스 갱신** + **앵글·렌즈·근거 로그 저장**
8. **GitHub Actions**: 생성 job은 변경 커밋 → push까지, 발송 job이 Vercel 배포·공개 자산 확인 → Telegram sendPhoto

Market(`scripts/run.ts`)도 같은 흐름이다: 가드(휴장·중복·가격 해시) → 시장·컨텍스트 수집 → 반복 방지 준비(앵글·횡보·모드·근거 tier) → Claude 생성(최대 3회) → HTML·카드 PNG·인덱스 → 내러티브 로그 저장.

### 트리거 옵션
- **정시 트리거 (1순위): 맥미니 launchd → `workflow_dispatch`.** 월~금 **06:40 KST에
  `only=both`** 한 번의 dispatch로 요청 → Market·ETF 생성 job이 **병렬**로 시작 → 각자
  생성·검증·커밋(~06:50) → **발송 job 하나**(`deliver`)가 Vercel 배포·공개 자산 확인 후
  두 리포트를 Market → ETF 순으로 연달아 발송(~06:55). 생성 job은 발송하지 않는다. 발송 job은
  두 생성 job이 끝나면(성공·실패 무관) 돌고, 종류마다 `resolve <kind>`(보낼지 판정) →
  `wait vercel <kind>`(배포 대기) → `send <kind> (Telegram)` step을 서로 독립으로 실행해
  한쪽 생성·발송이 실패해도 준비된 다른 쪽은 보낸다(전송 > 침묵). (아래 "아침 트리거" 참조)
- **2차 트리거 (2순위): 맥미니 재호출.** 07:20 `only=both`(같은 plist의 두 번째 시각).
  정시 실행이 리포트를 남겼으면 중복 가드가 생성 전에 종료하고, 생성이 빠진 리포트만
  만들어 보내며, 발송만 실패했으면 commit status를 보고 재발송한다(`scripts/delivery-state.ts`).
  간격(40분)이 생성 job timeout(20·15분)보다 길어 2차 실행의 중복 가드가 정시 실행의 커밋을 본다. 발송은 concurrency 그룹이 직렬화한다(발송 job timeout 25분).
- **3순위 백업: GitHub `schedule` cron.** `30 22 * * 0-4`(07:30 KST 목표, 실제 발화는
  09시대로 만성 지연). 맥미니가 죽은 날에만 의미 있는 유일한 독립 경로라
  그대로 둔다. 두 생성 job을 모두 돌리고 중복 가드에 맡긴다. ETF는 KRX 게시(08:00)를
  기다리지 않으므로 어느 시각에 돌아도 데이터가 깨지지 않는다(KRX 병합 여부는 응답 날짜
  판정이 정하므로 늦게 돌면 KRX 값이 더 들어갈 뿐이다).
- `workflow_dispatch` 수동 옵션:
  - `dry_run` (커밋·Telegram 발송 안 함, 생성 HTML·PNG를 아티팩트로 보관). 실행한 ref(`--ref`)의 코드를 체크아웃하므로 브랜치 코드로 점검할 수 있다
  - `force_regenerate` (오늘자 이미 있어도 재생성)
  - `only` (market / etf / both, 기본 both) — `both` = Market·ETF **병렬 생성**(맥미니 정시·2차 트리거가 쓰는 값). 한쪽만 다시 만들 때는 `only=market` 또는 `only=etf`.
  - `test_date` (`YYYY-MM-DD`, **`dry_run`일 때만 반영**) — 리포트 날짜를 지정한 날짜로 돌린다(`TEST_DATE`·`ETF_REPORT_DATE`로 전달). 주말은 휴장 판정으로 생략되므로 평일 날짜를 지정한다.
  - `resend_telegram_only` (생성 스킵, Telegram만 재발송) — `only`로 종류를 지정한다: `only=both`면 두 리포트를 모두, `only=market|etf`면 그 종류만 다시 보낸다

#### 리허설 (dry-run)

실제 데이터로 생성까지만 하고 커밋·발송은 하지 않는다. 형식 변경·운영 전환 전 점검용:

```bash
gh workflow run 260067407 --ref main -f only=both -f dry_run=true -f force_regenerate=true -f test_date=YYYY-MM-DD
# 병합 전 브랜치 코드로 점검하려면 --ref <브랜치> (예: --ref feat/morning-redesign) — 운영 main에는 영향이 없다
```

- 결과 HTML·미리보기 PNG는 실행 페이지의 아티팩트(`market-dry-run-<날짜>`·`etf-dry-run-<날짜>`, 보관 3일)로 받는다(`gh run download`). 발송 job은 `dry_run`이면 보내지 않고 건너뛴다. 생성 시각·검증 통과율·카드 품질을 확인한다.
- `test_date`는 리포트 날짜 라벨·파일명만 바꾸고 시세는 실행 시점의 현재 데이터를 쓴다(아래 "로컬 실행"의 백필과 같다).

#### 되돌리기

main의 병합 커밋을 되돌리고 옛 launchd 트리거를 다시 설치한다 — 순서: `ops/macmini/install.sh uninstall`(새 라벨 `morning`·`monitor` 제거) → `git revert -m 1 <병합 커밋>` push → 맥미니 checkout을 pull한 뒤 `ops/macmini/install.sh`(되돌려진 옛 스크립트가 git 이력의 옛 plist 4개 — `OLD_LABELS`의 `market`·`etf`·`monitor.market`·`monitor.etf` — 를 재설치). 과거 리포트·주소는 영향 없음.
`uninstall` 없이 revert했다면 옛 스크립트가 새 라벨을 모르므로 직접 정리한다: `launchctl bootout gui/$(id -u)/com.yalkongs.dailyreport.morning`·`...monitor` 후 `rm ~/Library/LaunchAgents/com.yalkongs.dailyreport.{morning,monitor}.plist`(남기면 다음 로그인에 다시 올라온다).

### 아침 트리거 (맥미니 launchd → GitHub workflow_dispatch)

정시·2차 트리거는 운영 맥미니의 launchd가 전담한다(2026-09-28 전환, 외부 cron 서비스
미사용). 2026-10-19 개편으로 Market·ETF가 **하나의 plist**를 공유한다. 설정은 repo 안
`ops/macmini/`에 있다.

| 파일 | 역할 |
|------|------|
| `ops/macmini/dispatch.sh` | `gh workflow run 260067407 --ref main -f only=<market\|etf\|both>`, 실패 시 30초 간격 3회. `DRY_RUN=1`이면 `dry_run=true` |
| `ops/macmini/com.yalkongs.dailyreport.morning.plist` | 월~금 06:40·07:20 → `dispatch.sh both` (Market·ETF 동시) |
| `ops/macmini/com.yalkongs.dailyreport.monitor.plist` | 월~금 07:45 → `monitor.sh all` (아래 "도착 감시") |
| `ops/macmini/install.sh` | 옛 라벨(`market`·`etf`·`monitor.market`·`monitor.etf`)과 새 라벨 2개를 먼저 모두 내린 뒤(재설치 포함), 위 두 plist를 `plutil -lint` 후 `~/Library/LaunchAgents`에 복사 + `launchctl bootstrap` (`uninstall` 인자면 설치 없이 6개 라벨을 모두 제거) |

- 워크플로는 파일명이 아니라 **ID `260067407`** 로 지정 → 파일명이 바뀌어도 안 깨짐.
- 인증은 맥미니의 `gh auth`(scope `workflow` 필요). 시각은 시스템 시간대(Asia/Seoul) 기준.
- 맥미니 전제: AC 전원 잠자기 끔, 자동 로그인(재부팅 후 LaunchAgent가 뜨려면 필요).
- 로그: `~/Library/Logs/dailyreport/trigger.log`(dispatch 결과), `monitor.log`(감시 dispatch 결과), plist별 `*.out.log`·`*.err.log`.
- 상태 확인: `launchctl print gui/$(id -u)/com.yalkongs.dailyreport.morning | grep -E "state|runs|last exit"`.
- 수동 점검: `launchctl kickstart gui/$(id -u)/com.yalkongs.dailyreport.morning`(당일 발송분이
  있으면 중복 가드가 skip) 또는 `DRY_RUN=1 ops/macmini/dispatch.sh both`.
- plist 수정 후에는 `ops/macmini/install.sh`를 다시 실행해야 반영된다.
- **운영 규칙: 평일 06:30~08:00에는 맥미니 재부팅·OS 업데이트 금지.** launchd는 꺼져
  있던 동안 놓친 실행을 부팅 후 되살리지 않는다(잠자기였다면 깨어날 때 1회 실행).
  정시를 놓쳤으면 2차 트리거가, 둘 다 놓쳤으면 수동 dispatch 또는 3순위 schedule이 맡는다.
- 같은 시각 요청이 겹쳐도 생성 job concurrency(`daily-report-market|etf`)와 발송 job
  concurrency(`daily-report-deliver`)로 직렬화되고 뒤 실행은 중복 가드·발송 상태
  (`action=skip — 이미 발송됨`)로 끝난다.
- 미국 서머타임 종료(11/1) 후 미국 장 마감은 한국시간 06:00 — 06:40 트리거에 40분 여유가 있다.

- **이력: ETF 08:15 트리거(폐기, 2026-10-19 개편).** KRX OpenAPI는 전일 ETF
  일별매매정보(NAV·괴리율·거래대금)를 익영업일 **08:00 KST 직후**에 게시한다
  (2026-09-21~23 관측: 08:00:41~08:00:47). 06:40에 수집하면 이틀 전 세션이 와서
  "전일"로 서술되는 문제가 있어 ETF를 08:15로 늦췄었다. 개편으로 ETF가 KRX 상세(괴리율·NAV)에
  의존하지 않게 되어(전일 종가·등락·거래량은 Yahoo) 06:40으로 되돌렸다. `lib/etf/krx-session.ts`는 남아
  있어 응답 행의 `BAS_DD`가 직전 한국 거래일과 다르면 KRX 값을 병합하지 않는다(날짜 혼합 금지).
  06:40에는 월요일을 포함해 보통 직전 거래일분이 게시 전이라(금요일분도 월요일 08:00쯤 게시) 병합되지 않고,
  기대 `BAS_DD`가 게시된 뒤 실제로 생성하는 늦은 실행(늦게 발화한 백업 cron·08:00 이후 수동 재생성 등)에서만 KRX 값이 병합된다.
  판정 결과는 실행 로그 `[etf-data] KRX BAS_DD=… 기대=… → prev-session|stale|none`과
  `data/etf-evidence-log.json`의 `krxSession`에 남는다. 설계 전문:
  [`docs/superpowers/specs/2026-09-20-etf-data-accuracy-design.md`](./docs/superpowers/specs/2026-09-20-etf-data-accuracy-design.md).

### 도착 감시 (2026-10-16, 감사 F06)

생성 workflow가 아예 돌지 않은 날(트리거 누락)과 돌았지만 미발송·결과 불명으로 끝난 날을 독립적으로
잡는다. 판정은 `scripts/check-delivery.ts <market|etf|all> [YYYY-MM-DD]` — 한국 휴장일은 통과, 영업일에는
그날 리포트 커밋의 `telegram/<kind>` status가 `success`일 때만 통과하고 아니면 exit 1(→ GitHub 실패 메일).
`all`은 두 리포트를 모두 판정해 **하나라도 미발송이면 실패**한다.

2026-10-19 개편 후 감시는 **07:45 하나**가 두 리포트를 함께 본다(ETF 09:00 감시는 폐기). 2차 트리거(07:20) 이후,
08:00 전 도착 목표의 마감선이다.

| 경로 | 시각(KST) | 비고 |
|------|-----------|------|
| `ops/macmini/monitor.sh all` + `com.yalkongs.dailyreport.monitor.plist` | 월~금 07:45 | `delivery-monitor.yml`을 dispatch. Market·ETF 둘 다 판정 |
| `.github/workflows/delivery-monitor.yml` schedule | 같은 시각(UTC cron `45 22 * * 0-4`) | 늦은 백업 — GitHub schedule은 수 시간 지연된다 |

- 경보 수단은 **GitHub Actions 실패 메일**이다(저장소 소유자 알림 설정 필요).
- 발송 결과가 불명(pending/error 잔존)이면 발송 job의 `resolve market`·`resolve etf` step(해당 종류)이 실패한다(이전엔 경고만 남기고 녹색).
  자동 재발송은 하지 않는다 — 구독자 채널을 확인한 뒤 필요하면 `resend_telegram_only=true`(+`only=<종류>`)로 수동 재발송.
- 발송 직전에 텔레그램이 가져갈 프리뷰 PNG(200 + `image/png`)와 본문(200)을 확인하고, 아니면 보내지 않는다.
- **발행물 정확성 검사(2026-10-23)** — 같은 job의 다음 step(`if: always()`)이 공개 페이지를 Yahoo 원천 시세와 대조한다:
  `npx tsx scripts/check-published.ts [--date YYYY-MM-DD] [--base URL] [--kind market|etf|all]`(판정 `lib/published-check.ts`).
  Market: 코스피 줄무늬 맨 끝 날짜(M1)·등락(M2), 핵심 지표(M3), 제목·카드·요약 지수 수치(M4), og 메타·PNG(M5).
  ETF: 예시 ETF(E1), 모자이크(E2), 제목·요약 지수 수치(E3), og 메타·PNG(E4). FAIL이 하나라도 있으면 실패 메일.
  한국 장이 열린 뒤 실행되면 한국 시세 대조만 SKIP(장중), 과거 날짜는 시세 대조를 SKIP하고 M1·M5·E4만 판정한다.

**⚠️ Timezone 규약.** launchd 시각은 맥미니 로컬(KST) 기준이다. GitHub `schedule`
3순위 백업은 반대로 항상 UTC(`30 22 * * 0-4`) — 자정 UTC를 넘기면 요일 매핑이 깨진다.

**이력: cron-job.org (2026-06~09, 폐기).** 이전에는 외부 cron-job.org가 GitHub
dispatch API를 PAT로 호출했다(설계: [`docs/superpowers/specs/2026-06-02-morning-trigger-reliability-design.md`](./docs/superpowers/specs/2026-06-02-morning-trigger-reliability-design.md)).
2026-09-28 맥미니 전담으로 전환하며 폐기 — cron-job.org 작업 삭제와 그 작업용
Fine-grained PAT(Actions write 전용) 폐기가 정리 절차다. 남아 있으면 body 없는
요청이 `only=both`로 06:40에 ETF까지 돌려 KRX 게시 전 stale 리포트를 먼저 발송했다(2026-09-29·30 실제 발생). 2026-10-19 개편 후에는 `only=both`가 정상 경로(06:40 병렬 생성)이고 ETF도 KRX에 의존하지 않으므로 잔존 요청의 영향은 중복 호출뿐이다 — 생성은 job 동시성·중복 가드가, 발송은 발송 job 동시성·발송 상태가 한 번만 처리한다. 그래도 전환 전에 삭제한다(운영자).

---

## 품질 개선 이력

2026-04-22 ~ 2026-04-30 일주일간 단계적 개선:

| 단계 | 주제 | 핵심 변경 |
|---|---|---|
| **Tier 1** | 어휘 자연화 | 하드코딩 문구 변주 도입, 강제 대체어 → 지향 가이드 |
| **Tier 2** | 본문 이관 | 5개 섹션 (storySpine/characters/resolutions/checklist/strategyProse)을 코드 → Claude로 이관, Tier 1 fallback 유지 |
| **P0** | 안전망 | 뉴스 48h 날짜 필터, 독자 컨텍스트 프롬프트, validator 재시도 2회 + Tier 1 fallback 경로 |
| **P1** | Validator 재설계 | Soft fix(자동 치환) + Hard validation(재생성) 2단계 분리, splitter decimal-period 버그 수정 |
| **P2** | 뉴스 다각화 | 쿼리 5종 분산, 같은 source 점유 제한, 라운드로빈 선별 |
| **P3** | 페르소나 프롬프트 | "지수/시장/증시" 단독 표기 hard 차단, 시장명 명시 의무, 섹션별 독자 목적 명시 |
| **Chip 보강** | 렌더링 누락 수정 | Characters/Executive/매칭표/공백 포함 코드 등 누락 4건 수정 |
| **Plan B** | 이야기 구조 회복 | 서사 어휘 금지 해제, 8종 앵글 도입, bigPicture 4~6문장 신설, 본문 길이 확장 |
| **압축 헤드라인** | Market 패턴 차용 | 두 절 압축형(concrete anchor + thematic clause), 14~26자 권장, 앵글별 함의 가이드 |

위 표는 당시 기록이다. 2026-10-17 개편으로 Tier 2의 5개 섹션·Plan B의 bigPicture·압축 헤드라인의 "수치 anchor 앞 절" 구조는 출력 스키마·화면에서 빠졌다(현재 구성은 위 "리포트 구성"·"핵심 특장점"). 상세 회고는 [`docs/etf-report-quality-todo.md`](./docs/etf-report-quality-todo.md) 참조.

---

## 사용 기술

- **언어/런타임**: TypeScript 5 · Node.js 22 (GitHub Actions 4개 워크플로의 `node-version`, 2026-10-20 20→22 — yahoo-finance2가 22 이상 요구) · tsx
- **프레임워크**: Next.js 16 App Router · React 19 · Tailwind CSS 4
- **AI**: Anthropic Claude Sonnet (`claude-sonnet-4-6`) · `max_tokens`: ETF 16384 · Market 64000(스트리밍)
- **데이터 소스**: Yahoo Finance · KRX OpenAPI(조건부 병합) · FRED · ECOS · Google News RSS · 연합뉴스 RSS
- **이미지**: Sharp (SVG → PNG 변환) · Pretendard(`assets/fonts`, 러너에 사용자 글꼴로 등록)
- **배포**: Vercel (정적 + Open Graph 프리뷰) · Vercel Web Analytics(`@vercel/analytics`, `<Analytics />` — Vercel 프로젝트 설정에서 활성화 필요)
- **자동화**: 맥미니 launchd(트리거·도착 감시 dispatch) → GitHub Actions(생성·발송, 러너 `ubuntu-24.04`; `schedule` cron은 3순위 백업)
- **전달**: Telegram Bot API (`sendPhoto` with `--form-string`)

---

## 로컬 실행

```bash
# 1. 환경 변수 설정 (.env.local)
ANTHROPIC_API_KEY=...
FRED_API_KEY=...
KRX_AUTH_KEY=...
ECOS_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# 2. 의존성 설치
npm install

# 3. Market 리포트 생성
npm run generate

# 4. ETF 리포트 생성
npx tsx scripts/run-etf.ts

# 5. (선택) Next.js 개발 서버
npm run dev

# 6. 테스트·타입 검사 (CI: .github/workflows/ci.yml — push·PR마다 자동 실행)
npm test            # tsx --test lib/*.test.ts lib/etf/*.test.ts lib/preview/*.test.ts (카드 테스트 포함)
npm run typecheck   # tsc --noEmit -p .
```

특정 날짜로 백필 생성:
```bash
TEST_DATE=2026-04-30 FORCE_REGENERATE=true npm run generate
ETF_REPORT_DATE=2026-04-30 FORCE_REGENERATE=true npx tsx scripts/run-etf.ts
```

- Market의 날짜 override는 `TEST_DATE`(`lib/market-data.ts`), ETF는 `ETF_REPORT_DATE`(`scripts/run-etf.ts`)다. Market 생성(`npm run generate`)은 `REPORT_DATE`를 읽지 않는다.
- 두 override 모두 **리포트 날짜 라벨·파일명만 바꾸고 시세는 실행 시점의 현재 데이터**를 쓴다. 과거 시세를 재현하는 백필이 아니다.
- 같은 날짜의 리포트가 이미 있으면 중복 실행 가드가 종료시키므로 덮어쓰려면 `FORCE_REGENERATE=true`를 함께 준다.
- 로컬에서 만든 카드 PNG는 시스템에 Pretendard(`assets/fonts/Pretendard-*.otf`)가 설치돼 있지 않으면 대체 글꼴(Noto Sans CJK KR 등)로 그려진다. 운영 러너는 workflow가 설치한다.

---

## 운영 통계 (2026-04-22 ~ 2026-05-14, 개편 전 기록)

- **총 발행**: Market·ETF 각 약 16건 (평일 기준)
- **자동 발화 성공률**: ~95% (월 1~2회 GitHub Actions schedule drop 사고)
- **Claude 1회차 통과율** (Plan B 적용 후): 80% 이상
- **Tier 1 fallback 발동**: 약 5% (모두 Telegram 정상 발송)
- **평균 실행 시간**: 7~10분 (데이터 수집 1분 + Claude 2~3분 + 렌더 1분 + 배포·발송 2~3분)

---

## 향후 개선 방향

### Tier 3 — ETF 리포트 전면 리팩토링 (2026-10-19 개편으로 대체)
- 당초 구상(Market의 paragraph 12+ 자유 본문 패턴 이식)은 하지 않았다. 대신 독자 중심의 짧은 구성(세 줄 요약·자산군 카드·확인 3가지)으로 바꿨다 — 위 "리포트 구성" 참조.

### 신뢰성 보강
- GitHub Actions schedule drop 대응: 이중 cron (21:30 + 22:30 UTC) 또는 Dead-man 모니터링(07:45 도착 감시가 일부 맡는다 — 위 "도착 감시")
- KRX OpenAPI 401/403 우회 라우트 추가 가능성 검토

### 데이터 품질
- 거시 데이터 극단값 sanity check (예: 일간 채권 ETF ±3% 초과 경고)
- 뉴스 출처 다양화 (현재 RSS 피드: ETF 9개·Market 10개)
- 외국인 매매 정보 보강

### 페르소나 분기
- "내부 트레이더 / 일반 개인투자자" 등 독자 페르소나별 변형 검토

---

## 라이선스 / 기여

이 프로젝트는 사적 운영용입니다. 코드 리뷰·이슈는 환영하지만 PR 머지는 운영자 판단에 따릅니다.

---

*마지막 업데이트: 2026-10-17*
