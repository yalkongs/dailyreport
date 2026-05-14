# iM AI Daily Report

> 매일 새벽 06:30 KST에 자동 발송되는 두 개의 시장 리포트 (Market · ETF). Claude Sonnet으로 본문을 작성하고 GitHub Actions + Vercel + Telegram으로 전달한다.

---

## 목표

한국 개인 투자자가 **장 개장 30분 전(06:30 KST)** 에 그날의 시장 흐름을 한 호흡으로 파악할 수 있는 보고서를 매일 자동으로 만든다.

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

---

## 아키텍처

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Data sources │→ │ Code pre-fill│→ │ Claude prompt│
│              │  │ (전략·국면)  │  │ (서사·해설)  │
│  • KRX OAPI  │  │              │  │              │
│  • Yahoo Fin │  │ 수치·점수·  │  │ headline,    │
│  • FRED      │  │ 슬롯·구조   │  │ bigPicture,  │
│  • ECOS      │  │              │  │ narrativeNotes│
│  • Google RSS│  └──────────────┘  └──────────────┘
└──────────────┘            ↓               ↓
                    ┌──────────────────────────┐
                    │ Soft fix + Hard validator│
                    │ (어휘 자동 교정 / 차단)  │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Renderer → HTML + PNG     │
                    │ (chip 변환·차트·테이블)   │
                    └──────────────────────────┘
                                ↓
                    ┌──────────────────────────┐
                    │ Git push → Vercel deploy │
                    │ → Telegram sendPhoto     │
                    └──────────────────────────┘
```

### 실행 환경
- **GitHub Actions cron** `30 21 * * 0-4` UTC = 06:30 KST 월~금
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
8. **GitHub Actions**: 변경 커밋 → push → Vercel 재배포 → Telegram sendPhoto

### 트리거 옵션
- 정상 스케줄: 매일 06:30 KST 월~금 자동
- `workflow_dispatch` 수동 옵션:
  - `dry_run` (Telegram 발송 안 함)
  - `force_regenerate` (오늘자 이미 있어도 재생성)
  - `only` (market / etf / both)
  - `resend_telegram_only` (생성 스킵, Telegram만 재발송)

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

- **언어/런타임**: TypeScript 5 · Node.js 24 LTS · tsx
- **프레임워크**: Next.js 16 App Router · React 19 · Tailwind CSS 4
- **AI**: Anthropic Claude Sonnet (`claude-sonnet-4-6`) · `max_tokens: 16384`
- **데이터 소스**: Yahoo Finance · KRX OpenAPI · FRED · ECOS · Google News RSS · 연합뉴스 RSS
- **이미지**: Sharp (SVG → PNG 변환)
- **배포**: Vercel (정적 + Open Graph 프리뷰)
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
```

특정 날짜로 백필 생성:
```bash
REPORT_DATE=2026-04-30 npm run generate
ETF_REPORT_DATE=2026-04-30 FORCE_REGENERATE=true npx tsx scripts/run-etf.ts
```

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

*마지막 업데이트: 2026-05-14*
