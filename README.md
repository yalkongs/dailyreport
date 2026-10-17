# iM AI Daily Report

> 매일 평일 개장 전 아침에 발송되는 두 개의 시장 리포트 — Daily Market · ETF Today를 06:40 KST에 함께 생성해 ~06:55에 연달아 발송(08:00 전 도착). Claude Sonnet으로 본문을 작성하고 맥미니 launchd → GitHub Actions + Vercel + Telegram으로 전달한다.

---

## 목표

한국 개인 투자자가 **장 개장 전 아침(06:40 KST 정시 트리거, 두 리포트 모두 08:00 전 도착)** 에 그날의 시장 흐름을 한 호흡으로 파악할 수 있는 보고서를 매일 자동으로 만든다.

- **사실 정합성**: 수치·뉴스·이상 탐지 결과를 단정적으로 인용
- **이야기**: 단편 데이터 나열이 아닌 한 호흡의 narrative
- **실행 가능성**: 09:00 개장 후 무엇을 어떤 순서로 볼지를 구체적으로 안내
- **신뢰성**: 새벽 자동화 + 검증 실패 시에도 Telegram 침묵 방지

---

## 두 개의 리포트

### 1. Market Report — 거시 시장 해설

- 전 세계 시장(미·유럽·아시아)의 전일 흐름과 한국 개장 영향을 **paragraph 12+ 블록 + pullQuote + dataCard**로 풀어냄
- 10가지 **narrativeAngle 로테이션** (산업 체인 추적 · 역사적 데자뷰 · 반대편 풍경 · 세대별 지갑 · 글로벌 도미노 · 숨은 변수 · 데이터 해부학 · 시간여행 · 직업별 풍경 · 구조적 렌즈)
- 횡보 시장 자동 감지 시 **딥다이브 에세이 모드**로 전환

### 2. ETF Report — 국내·해외 ETF 실행 가이드

- KRX OpenAPI · Yahoo Finance · FRED · ECOS · 뉴스 RSS 등 다층 데이터 소스 통합
- **Big Picture 단락** (narrative spine 4~6문장) + Story Spine 3막 + Characters 4인 + Resolutions 3 시나리오 + Today Watch 체크리스트 + Strategy Map
- 8가지 **narrativeAngle 로테이션** (글로벌→국내 전이 · 환율 양면성 · 섹터 분리 · 안전자산↔위험자산 · 구조 vs 일시 · 확인 지표 체인 · 시간대별 관전 · 어제와 오늘 갭)
- **이상 탐지** 5종 (괴리율·AUM 변화·추적오차·거래량 스파이크·연속 매도) 자동 표시
- 모든 ETF 언급은 **Google Finance 링크 chip**으로 자동 변환

> 2026-10-19 개편으로 **화면 구성**이 아래 "리포트 구성"처럼 짧게 바뀌었다. 위 목록의 Story Spine·Characters·전략 지도·괴리율 이상 탐지 등 화면에서 빠진 요소는 개편 전 설명이며, 거래량 급증 탐지와 수치·사실 검증은 그대로다. 설계 전문: [`docs/superpowers/specs/2026-10-17-morning-reports-redesign-design.md`](./docs/superpowers/specs/2026-10-17-morning-reports-redesign-design.md).

---

## 리포트 구성

독자는 주식·금융상품 경험이 조금 있는 개인 금융 고객(iM뱅크 직원은 고객 응대 소재로도 사용)이다. 텔레그램은 URL만 전달하므로 **웹 페이지가 본체**, 링크 미리보기 카드가 첫인상이며 대부분 모바일에서 열린다. 두 리포트는 역할을 나눈다 — Daily Market은 시장 전체의 어제와 오늘, ETF Today는 자산군별 판단 재료. 숫자는 코드가 데이터에서 렌더하고 모델은 문장(해석)을 쓴다. 법적 고지는 두 페이지 모두 맨 끝.

### Daily Market — 어제와 오늘 (`/reports/YYYY-MM-DD`)

1. 머리글 + **스트라이프**(최근 20거래일 코스피 띠, 한 줄 설명)
2. 제목·부제 (미리보기 카드와 같은 제목)
3. **세 줄 요약** — 어제(분위기를 말로) / 오늘 볼 것 / 내 자산은 → ETF Today 링크
4. 핵심 지표 6개 — 코스피·S&P500·나스닥·원/달러·미 10년물 + 그날 변수 1개(유가·금 등)
5. 어제 무슨 일이 있었나 — 4~6문단(사건 → 근거 있는 원인 → 시장 반응)
6. 오늘 볼 것 — 최대 3개, 한국시간 순서(미국 발표는 "장 마감 후 → 다음 거래일 반영")
7. 한국 시장에 주는 의미 — 2~3개, "확인되면 / 어긋나면"
8. 펼쳐 보기 — 전체 지표 13개, 이번 주 일정표, 과거 비교
9. 참고한 뉴스 · 데이터 기준 · 법적 고지(맨 끝)

### ETF Today — 내 자산군 관점 (`/etf-reports/YYYY-MM-DD`)

1. 머리글 + **모자이크**(Korea / USA ETF, 한 줄 설명)
2. 제목·부제
3. **세 줄 요약** — 해외 신호 / 국내 상태 / 오늘 핵심
4. 자산군별 판단 재료 5~6개 카드(국내 대형주 · 국내 반도체·IT · 그날 움직인 국내 섹터 · 미국 주식(환노출) · 채권 · 금·원자재) — 카드마다 어제 움직임(대표 ETF "예시", 등락은 코드 렌더) / 이유(근거 있을 때만) / 갖고 있다면 / 새로 본다면. 그날 중요한 순서. "갖고 있다면·새로 본다면"은 조건·관찰형 문장만(매수·매도 권유 금지)
5. 오늘 확인할 것 3가지 — 시각 + 비교 기준 + 어긋나면 버릴 가설
6. 레버리지·인버스 주의(변동성이 큰 날에만)
7. 펼쳐 보기 — 국내·미국 ETF 표(등락, 추정 거래대금)
8. 참고한 뉴스 · 데이터 기준(전일 종가, NAV·괴리율은 "주문 전 장중 iNAV 확인") · 법적 고지(맨 끝)

- 데이터: ETF는 KRX OpenAPI(08:00 게시)를 쓰지 않는다. 국내 ETF는 전일 종가·등락(Yahoo), 거래대금은 가격×거래량 추정이다. KRX 조회 코드는 남아 있으나 06:40에는 데이터가 없어 기존 안전장치(stale/none → 병합 안 함)로 자동 생략된다.
- 제거된 화면 요소: Market의 자산군 온도계, ETF의 Decision Frame·Story·Characters·전략 지도·매칭표·이슈 카드·액션 보드·규칙 점수.
- F02 정책 유지: "품질 낮아도 전송 > 침묵". 사실 검증은 1·2회차 재생성 사유, 마지막 축소판에서는 경고만 남기고 발송한다.

---

## 미리보기 카드

텔레그램·카카오톡 등 링크 미리보기의 첫인상. 휴대폰에서 카드 폭이 약 300pt이므로 **큰 요소 2~3개만** 두고 제목 외 글자를 최소화한다. 숫자는 숫자 자체가 뉴스일 때만 제목 안에 넣고, 지수 등락률처럼 다른 곳에서 보는 숫자는 넣지 않는다. 세부는 메신저가 자체 글꼴로 보여주는 `og:description`(세 줄 요약을 한 문장으로, 약 80자 이내)이 맡는다.

| 항목 | Daily Market | ETF Today |
|------|--------------|-----------|
| 배경 데이터 | 최근 20거래일 코스피 **스트라이프**(하루 = 세로 줄, 휴장일 없음, 마지막 줄 아래 ▼ = 어제) | 분석한 ETF **모자이크**(Korea 왼쪽 / USA 오른쪽, 레버리지·인버스 제외, 자산군별 묶음 → 그 안에서 등락순) |
| 제목 아래 한 줄 | 배경 한 문장(라벨 없는 평서문). 입력 근거가 있을 때만 단정, 약하면 같은 자리에 오늘 확인점 | "○○를 갖고 있다면" + 관찰형 문장(○○ = 그날 가장 크게 움직였거나 서사의 중심인 자산군, 해당 ETF 타일은 검은 테두리) |

- **규격**: 서버에서 PNG 렌더, 1080×1350, 바탕 #FFFFFF, 위쪽 끝 민트 그라데이션 테두리 12px(#00BFA5 → #8BE08F), 하단 띠 없음. 로고는 `public/im-bank-logo.png` 원본을 비율 그대로 내용 영역만 잘라 표시(변형 금지). 글꼴 Pretendard(서버 렌더에 포함), 최소 40px, 제목이 길면 글자를 단계적으로 줄이되 자르지 않는다.
- **색**: 상승 빨강·하락 파랑 연속 색, |5%|에서 최대, 밝기 차이로 색약 대비. 스트라이프 띠는 전폭, 모자이크 띠는 0~600px.
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
│              │  │ (전략·국면)    │  │ (서사·해설)    │
│  • KRX OAPI  │  │              │  │              │
│  • Yahoo Fin │  │ 수치·점수·     │  │ headline,    │
│  • FRED      │  │ 슬롯·구조      │  │ bigPicture,  │
│  • ECOS      │  │              │  │ narrativeNotes│
│  • Google RSS│  └──────────────┘  └──────────────┘
└──────────────┘            ↓               ↓
                    ┌──────────────────────────┐
                    │ Soft fix + Hard validator│
                    │ (어휘 자동 교정 / 차단)      │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Renderer → HTML + PNG    │
                    │ (chip 변환·차트·테이블)      │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Git push → Vercel deploy │
                    │ → Telegram sendPhoto     │
                    └──────────────────────────┘
```

### 실행 환경
- **GitHub Actions** `workflow_dispatch` — 맥미니 launchd(`ops/macmini/`)가 월~금 06:40·07:20 KST에 `only=both`로 호출(Market·ETF 병렬 생성 → 발송 job 하나가 Market → ETF 순으로 발송). 3순위 백업 `schedule` cron `30 22 * * 0-4` UTC = 07:30 KST
- **Vercel** Next.js 16 (App Router) 정적 배포 + Open Graph 프리뷰
- **Telegram Bot API** `sendPhoto` 로 PNG 프리뷰 + 헤드라인 캡션 + 리포트 링크

---

## 핵심 특장점

### 1. 코드 vs Claude 역할 분담
- **코드**: 수치, 시장 국면 점수, ETF 전략 지도, 이상 탐지 — 결정론적·검증 가능 영역
- **Claude**: headline, narrative spine, prose 해설 — 자유로운 서술 영역
- 양쪽이 보완: 코드는 "어떤 데이터인지", Claude는 "이게 무엇을 의미하는지"

### 2. 서사 앵글 시스템
- 매일 자동으로 다른 관점 적용 → 같은 데이터·같은 시장이어도 매번 다른 각도의 글
- 최근 5일 미사용 앵글 우선 선택, 30일 사용 이력 로그 보관
- 헤드라인부터 본문까지 앵글이 일관된 narrative spine 으로 작동

### 3. 압축·함의형 헤드라인
- 두 절 구조: 앞 절 = 구체 수치 anchor, 뒤 절 = 함의·관점
- 예: `"SOXX +2.57%, 선행과 확인 사이의 한 박자"`, `"1,488원 해부학, 숫자 하나에 담긴 5가지 의미"`
- "지수·시장·증시" 단독 표기는 hard validator로 차단 (한국 독자의 KOSPI 오해 방지)
- **클리셰 방지 = 규칙→취향** (2026-06): 단어 금지 리스트 대신 목표 보이스 예시+원칙(`lib/voice-exemplars.ts`)으로 결을 따르게 하고, anti-repetition이 단어뿐 아니라 구조·구문 틀("X가 그린 Y" 류) 반복까지 차단

### 4. 2단계 품질 검증 시스템
- **Soft fix** (자동 치환): "구조입니다" → "흐름입니다", "시사합니다" → "말해 줍니다" 등 18종
- **Hard validation** (재생성 사유): 투자 권유 어휘 · 사실 오류 · 포맷 위반 · 단정 표현 등
- Soft가 먼저 적용된 후 Hard가 통과/실패 판정

### 5. Tier 1 Fallback 경로
- Claude 2회 모두 실패 시 → `narrativeNotes` drop 후 Tier 1 하드코딩 본문으로 발송
- "품질 낮아도 전송" > "Telegram 침묵" 트레이드오프
- 새벽 자동화의 최악 시나리오 차단

### 6. 뉴스 수집 다각화
- 5개 카테고리 RSS 분산 수집 (국내증시 · 환율금리 · 미증시 · 정책지정학 · 원자재)
- 48시간 초과 기사 자동 제외 (호르무즈 stale news 사고 방지)
- Source 다양성 라운드로빈 선별

### 7. ETF Chip 자동 렌더링
- 본문의 모든 ETF 언급(KODEX·TIGER·SOXX 등)이 자동으로 Google Finance 링크 chip으로 변환
- "KODEX 반도체 (091160)" (공백 포함) / "KODEX 반도체(091160)" / "SOXX" 등 다양한 형태 후보 등록

---

## 구현 방식

### 디렉토리 구조
```
.
├── .github/workflows/daily-report.yml   # GitHub Actions 트리거
├── scripts/
│   ├── run.ts                            # Market 파이프라인 진입점
│   ├── run-etf.ts                        # ETF 파이프라인 진입점
│   └── collect-data.ts                   # 데이터 수집 단독 실행
├── lib/                                  # Market 리포트 코드
│   ├── claude-client.ts                  # Claude API + 프롬프트
│   ├── narrative-angles.ts               # 10종 앵글
│   ├── narrative-memory.ts               # 최근 로그 회피
│   ├── sideways-detector.ts              # 횡보 모드 감지
│   ├── market-data.ts                    # 시장 데이터
│   ├── fred-data.ts / ecos-data.ts       # 거시 데이터
│   ├── news-collector.ts                 # RSS 수집
│   ├── report-renderer.ts                # HTML 생성
│   └── etf/                              # ETF 리포트 코드
│       ├── claude-client.ts              # ETF Claude + 프롬프트
│       ├── narrative-angle.ts            # 8종 ETF 앵글
│       ├── analysis-lens.ts              # 7종 데이터 렌즈
│       ├── etf-data.ts                   # KRX + Yahoo 통합
│       ├── morning-strategy.ts           # ETF 전략 지도
│       ├── analyzer.ts                   # 이상 탐지 5종
│       ├── news.ts                       # ETF 전용 뉴스
│       ├── renderer.ts                   # ETF HTML 렌더
│       ├── report-quality.ts             # Soft + Hard 검증
│       └── report-language.ts            # 어휘 정규화
├── src/app/                              # Next.js App Router
│   ├── page.tsx                          # 홈
│   └── archive/page.tsx                  # 과거 리포트 아카이브
├── data/                                 # 운영 로그 (커밋됨)
│   ├── reports-index.json                # Market 인덱스
│   ├── etf-reports-index.json            # ETF 인덱스
│   ├── narrative-log.json                # Market 30일 로그
│   ├── etf-lens-log.json                 # ETF 렌즈 로그
│   └── etf-narrative-angle-log.json      # ETF 앵글 로그
└── public/
    ├── reports/                          # 발행된 Market HTML + PNG
    └── etf-reports/                      # 발행된 ETF HTML + PNG
```

### 파이프라인 (ETF 기준)

1. **데이터 수집** (병렬): ETF 시세 + 자금흐름 + 투자자별 매매 + 거시 지표 + 뉴스
2. **데이터 검증**: 100개 ETF 중 N개 이상 수집 성공 확인
3. **분석 렌즈 + 서사 앵글 선택**: 최근 5일 미사용 우선 무작위
4. **이상 탐지**: 5종 룰 (괴리율·추적오차 등)
5. **Claude 생성** (최대 2회): 시스템 프롬프트 + 데이터 슬롯 + 앵글 가이드 + 헤드라인 규칙
6. **HTML 렌더링**: Tier 2 narrativeNotes 우선, 없으면 Tier 1 하드코딩
7. **인덱스 갱신** + **앵글·렌즈 로그 저장**
8. **GitHub Actions**: 생성 job은 변경 커밋 → push까지, 발송 job이 Vercel 배포·공개 자산 확인 → Telegram sendPhoto

### 트리거 옵션
- **정시 트리거 (1순위): 맥미니 launchd → `workflow_dispatch`.** 월~금 **06:40 KST에
  `only=both`** 한 번의 dispatch로 요청 → Market·ETF 생성 job이 **병렬**로 시작 → 각자
  생성·검증·커밋(~06:50) → **발송 job 하나**가 Vercel 배포·공개 자산 확인 후 두 리포트를
  Market → ETF 순으로 연달아 발송(~06:55). 생성 job은 발송하지 않으며, 준비된 리포트는
  다른 쪽을 기다리지 않고 보낸다(전송 > 침묵). (아래 "아침 트리거" 참조)
- **2차 트리거 (2순위): 맥미니 재호출.** 07:20 `only=both`(같은 plist의 두 번째 시각).
  정시 실행이 리포트를 남겼으면 중복 가드가 수집 전에 종료하고, 생성이 빠진 리포트만
  만들어 보내며, 발송만 실패했으면 commit status를 보고 재발송한다(`scripts/delivery-state.ts`).
  간격은 job timeout보다 길다.
- **3순위 백업: GitHub `schedule` cron.** `30 22 * * 0-4`(07:30 KST 목표, 실제 발화는
  09시대로 만성 지연). 맥미니가 죽은 날에만 의미 있는 유일한 독립 경로라
  그대로 둔다. 두 생성 job을 모두 돌리고 중복 가드에 맡긴다. ETF는 이제 KRX 게시(08:00)를
  기다리지 않으므로 이 경로에서도 시각에 따른 데이터 저하가 없다.
- `workflow_dispatch` 수동 옵션:
  - `dry_run` (커밋·Telegram 발송 안 함, 생성 HTML·PNG를 아티팩트로 보관)
  - `force_regenerate` (오늘자 이미 있어도 재생성)
  - `only` (market / etf / both) — `both` = Market·ETF **병렬 생성**(맥미니 정시·2차 트리거가 쓰는 값). 한쪽만 다시 만들 때는 `only=market` 또는 `only=etf`.
  - `test_date` (`YYYY-MM-DD`, **`dry_run`일 때만 반영**) — 리포트 날짜를 지정한 날짜로 돌린다(`TEST_DATE`·`ETF_REPORT_DATE`로 전달). 주말은 휴장 판정으로 생략되므로 평일 날짜를 지정한다.
  - `resend_telegram_only` (생성 스킵, Telegram만 재발송)

#### 리허설 (dry-run)

실제 데이터로 생성까지만 하고 커밋·발송은 하지 않는다. 형식 변경·운영 전환 전 점검용:

```bash
gh workflow run 260067407 --ref main -f only=both -f dry_run=true -f force_regenerate=true -f test_date=YYYY-MM-DD
```

- 결과 HTML·미리보기 PNG는 실행 페이지의 아티팩트(보관 3일)로 받는다. 생성 시각·검증 통과율·카드 품질을 확인한다.
- `test_date`는 리포트 날짜 라벨·파일명만 바꾸고 시세는 실행 시점의 현재 데이터를 쓴다(아래 "로컬 실행"의 백필과 같다).

#### 되돌리기

순서: `ops/macmini/install.sh uninstall`(새 라벨 `morning`·`monitor` 제거) → 병합 커밋 revert → `ops/macmini/install.sh`(되돌려진 옛 스크립트가 이전 plist 4개 재설치). revert 후에는 옛 스크립트가 새 라벨을 모르므로 먼저 내리지 않으면 `launchctl bootout gui/$(id -u)/com.yalkongs.dailyreport.morning`(`.monitor`도 같이)으로 직접 내린다. 과거 리포트·주소는 영향 없음.

### 아침 트리거 (맥미니 launchd → GitHub workflow_dispatch)

정시·2차 트리거는 운영 맥미니의 launchd가 전담한다(2026-09-28 전환, 외부 cron 서비스
미사용). 2026-10-19 개편으로 Market·ETF가 **하나의 plist**를 공유한다. 설정은 repo 안
`ops/macmini/`에 있다.

| 파일 | 역할 |
|------|------|
| `ops/macmini/dispatch.sh` | `gh workflow run 260067407 --ref main -f only=<market\|etf\|both>`, 실패 시 30초 간격 3회. `DRY_RUN=1`이면 `dry_run=true` |
| `ops/macmini/com.yalkongs.dailyreport.morning.plist` | 월~금 06:40·07:20 → `dispatch.sh both` (Market·ETF 동시) |
| `ops/macmini/com.yalkongs.dailyreport.monitor.plist` | 월~금 07:45 → `monitor.sh all` (아래 "도착 감시") |
| `ops/macmini/install.sh` | 옛 라벨(`market`·`etf`·`monitor.market`·`monitor.etf`)을 내리고 위 두 plist를 `~/Library/LaunchAgents`에 복사 + `launchctl bootstrap` (`uninstall` 인자로 제거) |

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
  "전일"로 서술되는 문제가 있어 ETF를 08:15로 늦췄었다. 개편으로 ETF가 KRX 상세(괴리율·NAV)를
  쓰지 않게 되어(전일 종가·등락은 Yahoo) 06:40으로 되돌렸다. `lib/etf/krx-session.ts`는 남아
  있어 응답 행의 `BAS_DD`가 직전 한국 거래일과 다르면 KRX 값을 병합하지 않는다(날짜 혼합 금지).
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
- 발송 결과가 불명(pending/error 잔존)이면 발송 job의 `resolve` step이 실패한다(이전엔 경고만 남기고 녹색).
  자동 재발송은 하지 않는다 — 구독자 채널을 확인한 뒤 필요하면 `resend_telegram_only=true`로 수동 재발송.
- 발송 직전에 텔레그램이 가져갈 프리뷰 PNG(200 + `image/png`)와 본문(200)을 확인하고, 아니면 보내지 않는다.

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

상세 회고는 [`docs/etf-report-quality-todo.md`](./docs/etf-report-quality-todo.md) 참조.

---

## 사용 기술

- **언어/런타임**: TypeScript 5 · Node.js 20 (GitHub Actions `daily-report.yml`의 `node-version`) · tsx
- **프레임워크**: Next.js 16 App Router · React 19 · Tailwind CSS 4
- **AI**: Anthropic Claude Sonnet (`claude-sonnet-4-6`) · `max_tokens: 16384`
- **데이터 소스**: Yahoo Finance · KRX OpenAPI · FRED · ECOS · Google News RSS · 연합뉴스 RSS
- **이미지**: Sharp (SVG → PNG 변환)
- **배포**: Vercel (정적 + Open Graph 프리뷰) · Vercel Web Analytics(`@vercel/analytics`)
- **자동화**: GitHub Actions cron
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
npm test
npm run typecheck
```

특정 날짜로 백필 생성:
```bash
TEST_DATE=2026-04-30 FORCE_REGENERATE=true npm run generate
ETF_REPORT_DATE=2026-04-30 FORCE_REGENERATE=true npx tsx scripts/run-etf.ts
```

- Market의 날짜 override는 `TEST_DATE`(`lib/market-data.ts`), ETF는 `ETF_REPORT_DATE`(`scripts/run-etf.ts`)다. Market 생성(`npm run generate`)은 `REPORT_DATE`를 읽지 않는다.
- 두 override 모두 **리포트 날짜 라벨·파일명만 바꾸고 시세는 실행 시점의 현재 데이터**를 쓴다. 과거 시세를 재현하는 백필이 아니다.
- 같은 날짜의 리포트가 이미 있으면 중복 실행 가드가 종료시키므로 덮어쓰려면 `FORCE_REGENERATE=true`를 함께 준다.

---

## 운영 통계 (2026-04-22 ~ 2026-05-14)

- **총 발행**: Market·ETF 각 약 16건 (평일 기준)
- **자동 발화 성공률**: ~95% (월 1~2회 GitHub Actions schedule drop 사고)
- **Claude 1회차 통과율** (Plan B 적용 후): 80% 이상
- **Tier 1 fallback 발동**: 약 5% (모두 Telegram 정상 발송)
- **평균 실행 시간**: 7~10분 (데이터 수집 1분 + Claude 2~3분 + 렌더 1분 + 배포·발송 2~3분)

---

## 향후 개선 방향

### Tier 3 — ETF 리포트 전면 리팩토링 (계획 단계)
- 현재 ETF 본문은 슬롯 그리드 + Plan B의 bigPicture 절충. Market 리포트의 paragraph 12+ 자유 본문 패턴으로 전면 재설계 검토.
- 코드 슬롯을 "데이터 입력"으로 격하하고 Claude가 본문을 완전히 풀어내는 방향.

### 신뢰성 보강
- GitHub Actions schedule drop 대응: 이중 cron (21:30 + 22:30 UTC) 또는 Dead-man 모니터링
- KRX OpenAPI 401/403 우회 라우트 추가 가능성 검토

### 데이터 품질
- 거시 데이터 극단값 sanity check (예: 일간 채권 ETF ±3% 초과 경고)
- 뉴스 출처 다양화 (현재 6개 → 10개)
- 외국인 매매 정보 보강

### 페르소나 분기
- "내부 트레이더 / 일반 개인투자자" 등 독자 페르소나별 변형 검토

---

## 라이선스 / 기여

이 프로젝트는 사적 운영용입니다. 코드 리뷰·이슈는 환영하지만 PR 머지는 운영자 판단에 따릅니다.

---

*마지막 업데이트: 2026-10-17*
