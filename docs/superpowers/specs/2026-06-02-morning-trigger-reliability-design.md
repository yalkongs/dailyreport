# 아침 트리거 신뢰성 — cron-job.org 정시 트리거 → GitHub workflow_dispatch

원안: 2026-06-02
갱신: 2026-06-17 (Vercel Hobby 검토로 cron-job.org 재확정 + 컷오버 순서 게이트·여름 첫-런 데이터 점검 추가, 라인 참조 갱신)
상태: 설계 승인됨 (런북 실행 대기)

## 문제

`daily-report.yml`은 `schedule: '30 21 * * 0-4'`(06:30 KST 목표)로 돌지만,
GitHub Actions의 `schedule` 이벤트는 정시 실행을 보장하지 않는다. 실측 결과
최근 5일 모두 **예정보다 60~84분 지연**되어 실제 도착은 07:30~07:55 KST였다.

| 날짜(UTC) | 예정 | 실제 시작 | 지연 |
|-----------|------|-----------|------|
| 05-25 | 21:30 | 22:32 | +62분 |
| 05-26 | 21:30 | 22:44 | +74분 |
| 05-27 | 21:30 | 22:53 | +84분 |
| 05-28 | 21:30 | 22:49 | +80분 |
| 05-31 | 21:30 | 22:30 | +60분 |

추가로 GitHub은 고부하 시 `schedule` tick을 **드롭**(아예 실행 안 함)할 수 있다.

> **2026-06-17 추가 — 왜 Vercel Cron이 아닌가.** 트리거 대안으로 Vercel Cron을
> 검토했으나 현재 플랜이 **Hobby**다. Vercel 공식 문서(cron-jobs/usage-and-pricing,
> 2026-03-04)는 Hobby를 **하루 1회·시간 단위 정밀도(±59분)**로 명시한다 — 원문:
> *"a cron job configured as `0 1 * * *` ... will trigger anywhere between 1:00 am
> and 1:59 am."* 즉 우리가 떠나려는 GitHub schedule 지연과 **동일한 ±59분 병**이다.
> 게다가 Vercel cron은 자기 엔드포인트만 호출 가능해 GitHub dispatch를 부르려면
> **새 API 라우트 코드까지** 추가해야 한다. → Hobby에서 Vercel Cron 탈락, cron-job.org 확정.

## 핵심 발견 (실증)

지연은 **`schedule` 이벤트에만** 발생한다. 2026-06-02 수동 트리거 실험에서
`workflow_dispatch`로 쏜 실행은 **약 5초 만에 queued→running**으로 시작했다.
따라서 "정시 트리거"와 "GitHub의 굼뜬 cron"을 분리하면, 잘 돌아가는 연산
파이프라인은 그대로 두고 지연만 제거할 수 있다.

## 목표 (성공 기준)

06:30 정각 집착이 아니라 **"지금보다 이르고 일정하게"** — 매일 예측 가능한
시각(07:00 한참 이전)에 안정적으로 도착, 변동성(들쭉날쭉)과 드롭 위험 제거.

## 비목표

- 연산 파이프라인(`scripts/run.ts`, `scripts/run-etf.ts`) 변경 — 손대지 않는다.
- 분 단위 정각 06:30 보장 — 불필요.
- Vercel Cron/Function으로의 전체 이관 — 과도한 재설계(ocean), 채택 안 함.

## 아키텍처

```
[cron-job.org]  매일(월~금) 06:40 KST 정시 (Asia/Seoul tz)
      │  HTTPS POST (GitHub dispatch API), HTTP 204 기대
      ▼
[GitHub Actions]  workflow_dispatch 수신 → 수 초 내 실행 시작
      │  기존 파이프라인 그대로: market job → (needs) etf job
      ▼
git push → Vercel 자동 배포(배포 status poll) → Telegram sendPhoto  (~06:55 도착)

[GitHub schedule]  늦은 백업 트리거 — cron-job.org가 죽은 날에만 의미 있음
```

- 트리거 시각 **06:40 KST** → 두 리포트 모두 07:00 직전 도착. 현재 07:30~07:55보다 훨씬 이르고 일정.

### 데이터 신선도 — 계절별 마진 (중요)

US NYSE 마감의 KST 시각은 미국 DST에 따라 달라진다. 한국은 DST 없음.

| 기간 | US 마감(ET 16:00) | KST 환산 | 06:40 수집 시 마진 |
|------|------|---------|----------|
| 여름 EDT (≈3월~11월) | 20:00 UTC | **05:00 KST** | ~100분 (충분) |
| 겨울 EST (≈11월~3월) | 21:00 UTC | **06:00 KST** | **40분 (미검증)** |

- **주의**: 과거 `schedule` 실행은 지연으로 항상 ~07:30 KST에 수집했다. 06:40
  수집 타이밍은 **여름이라도 한 번도 돌려본 적 없다.** 여름엔 마진이 넉넉해
  안전 쪽이나, "이렇게 일찍 돈 적 없다"는 첫-실행 리스크는 존재한다 → 검증
  계획 step 3에 **첫 발화 데이터 정합성 점검**을 둔다.
- **겨울 40분 마진**에서 Yahoo 등 데이터 제공자가 공식 종가를 정착(settle)
  시켰는지는 11월 전에 별도 실검증한다(step 4). 의심되면 그때 시각을 늦춘다.
- KST 기준 단일 시각으로 고정하므로 DST 조건 분기는 불필요(겨울 마감 06:00
  KST보다 뒤에 트리거 → 여름·겨울 모두 커버).

- 한국 공휴일은 `run.ts`/`run-etf.ts`의 기존 silent-skip 로직이 처리한다
  (`run.ts` 한국 휴장 분기, `run-etf.ts` 동일). cron-job.org에 공휴일 로직 불필요.

## 구성 요소

### A. cron-job.org 작업

| 항목 | 값 |
|------|-----|
| URL | `https://api.github.com/repos/yalkongs/dailyreport/actions/workflows/260067407/dispatches` |
| Method | `POST` |
| Headers | `Authorization: Bearer <PAT>`<br>`Accept: application/vnd.github+json`<br>`X-GitHub-Api-Version: 2022-11-28` |
| Body | `{"ref":"main"}` (inputs 생략 → only=both, dry_run=false 기본값 적용) |
| Schedule | **월~금 06:40, timezone = Asia/Seoul** |
| 성공 판정 | HTTP **204 No Content** |
| 실패 알림 | **이메일 알림 활성화 (필수)** |

- workflow는 파일명(`daily-report.yml`) 대신 **ID `260067407`** 로 지정 →
  파일명이 바뀌어도 트리거가 깨지지 않는다. (2026-06-17 `gh api`로 ID active 재확인.)
- `{"ref":"main"}`은 항상 **main 버전의 워크플로**를 실행한다. 이 사실이 아래
  C절 컷오버 순서의 핵심 — 백업 cron 변경은 main에 들어가야 효력이 생긴다.

#### ⚠️ Timezone 규약 — 절대 혼동 금지

cron-job.org와 GitHub은 cron 해석 규약이 **다르다**. 이 차이가 이 작업의 핵심 함정이다.

- **cron-job.org**: 작업의 timezone을 **Asia/Seoul**로 설정하고 요일도 **KST 기준
  월~금**으로 지정한다. GitHub의 "UTC 일~목(`0-4`)" 환산을 **그대로 쓰면 안 된다.**
  실수로 UTC로 두면 06:40 UTC = **15:40 KST(오후)** 에 발화하는 참사.
- **GitHub cron(백업)**: 항상 UTC. 아래 C 참조.

### B. GitHub Fine-grained PAT

- Repository access: **`dailyreport` 단 하나**
- Permissions: **Actions = Read and write** (+ Metadata read 자동 포함)
- 만료일: 설정 (예: 1년). 만료일을 본 문서와 README에 기록.
- 보관 위치: cron-job.org 작업의 `Authorization` 헤더.

#### 보안 범위

이 토큰으로 가능한 것은 **"이 워크플로 실행 트리거"뿐**이다.
- Contents 권한이 없어 워크플로 파일 수정·secret 탈취 불가.
- 유출 시 최대 피해 = 워크플로 반복 실행(Actions 분·Anthropic 크레딧 소모).
- 단일 repo·단일 권한·만료일 있는 fine-grained 토큰 → 개인 프로젝트로 수용 가능.

### C. GitHub schedule 백업 (시각 이동) — ⚠️ 컷오버 순서 게이트 있음

`daily-report.yml`의 schedule cron을 한 줄 **교체**(두 줄 병기 아님 — 백업은 1개):

```yaml
# 변경 전 (현재 main)
schedule:
  - cron: '30 21 * * 0-4'   # 06:30 KST 목표

# 변경 후
schedule:
  - cron: '30 22 * * 0-4'   # 07:30 KST 목표 (늦은 백업)
```

- 이유: 시장 job의 push 스텝(`daily-report.yml` L105 "Commit and push report" → L113 `git push`)에는
  `git pull --rebase`가 **없다**(ETF job L247→L254 `git pull --rebase origin main`에만 있음).
  cron-job.org(06:40)와 백업을 **구조적으로 비겹치게** 분리하면 동시 실행 push 충돌 레이스가 원천 제거된다.
- cron-job.org 06:40 실행이 끝나(리포트 존재) 백업이 늦게 떠도, 중복 가드가
  파이프라인을 종료시켜 push 자체가 일어나지 않는다.
- **GitHub cron 요일 함정**: GitHub cron은 항상 UTC다. `0-4`(UTC 일~목)가
  KST 월~금으로 매핑되는 것은 UTC 시각이 **24:00 미만**일 때만 성립한다. 백업
  시각을 자정 넘겨(예: `30 0 * * ...`) 옮기면 UTC 요일이 하루 밀려 매핑이 깨진다.
  `30 22`(22:30 UTC)는 안전. 이후 수정 시 이 경계를 반드시 지킬 것.

#### ⚠️ 컷오버 순서 게이트 (2026-06-17 추가 — 유일한 롤아웃 블로커)

**백업 cron shift(`30 21`→`30 22`)를 cron-job.org 라이브 검증 전에 main에 머지하지 않는다.**

- 이유: cron-job.org가 아직 안 떴는데 백업만 07:30 목표로 미루면, 공백기엔
  백업만 발화 → **~08:30 도착**(현재 07:30~07:55보다 **늦음 = 고객 대면 회귀**).
- 비대칭이 게이트를 깔끔하게 만든다: cron-job.org **외부 설정**은 main을 대상으로
  하므로(`{"ref":"main"}`) **브랜치 머지 전에도 TEST RUN으로 검증 가능**하다.
  반면 cron 변경은 main에 들어가야 효력. → "외부 검증 먼저, cron 머지는 나중."
- 올바른 순서: **(1) PAT 발급 → (2) cron-job.org 설정 → (3) 로컬 curl·TEST RUN으로
  204 확인 → (4) 첫 평일 06:40 실발화 + 데이터 정합성 확인 → (5) 그 다음에야
  백업 cron shift를 main에 머지.** (4)까지 통과 전엔 현재 `30 21` 백업을 그대로 둔다.

### D. 중복 실행 가드 (기존, 변경 없음 — 의존만 함)

- `scripts/run.ts` L155~ "중복 실행 방지 가드": 오늘 자 HTML 존재 + index 엔트리 있음 →
  `FORCE_REGENERATE != true`면 종료 (L165 분기).
- `scripts/run-etf.ts` L69~ "중복 실행 방지 가드": 동일 (L81 분기).
- 결과: cron-job.org가 06:40에 생성 완료 → 늦게 도는 GitHub schedule은
  "이미 있음 → 종료 → 변경 없음 → Telegram step 자동 skip".

### E. README 문서 산출물 (이 작업의 실질 deliverable)

`README.md`에 "아침 트리거" 섹션 추가:
- cron-job.org 작업 설정(URL/method/headers/body/schedule/tz) 전체
- **Timezone 규약 경고** (cron-job.org = Asia/Seoul KST 월~금 / GitHub = UTC, A·C 참조)
- PAT scope·만료일·재발급 절차
- schedule 백업 설계와 이중화 의도 + **컷오버 순서 게이트**
- 트리거가 repo 밖(외부 계정 + 토큰)에 살기 때문에, 버전관리되는 이 문서가
  6개월 뒤·새 기기에서 복구할 수 있는 유일한 흔적이다.

## 검증 계획 ("done = 실제로 됨")

1. **로컬 curl**: dispatch 엔드포인트를 PAT로 직접 호출 → **HTTP 204** 확인 +
   `gh run list`에 workflow_dispatch 실행이 수 초 내 등장하는지 확인.
2. **cron-job.org TEST RUN 버튼**: 외부 경로 end-to-end 동일 확인(204 + 실행 등장).
3. **첫 평일 06:40 실제 발화**:
   - (a) 도착 시각 기록, 07:00 이전 도착 확인.
   - (b) **데이터 정합성 점검 (2026-06-17 추가).** 06:40 수집은 여름이라도
     사상 최초이므로, 첫 발화 리포트의 US 지수(^GSPC 등) 종가가 **전일 NYSE
     마감값과 일치**하는지 눈으로 확인한다. pre-settlement(미정착) 값을 잡으면
     고객에게 틀린 숫자가 나간다. 불일치 의심 시 트리거 시각을 늦춘다.
4. **겨울 데이터 마진 검증 (11월 전)**: 06:40 수집 시 US EST 종가가 정착됐는지
   확인. US 지수 종가가 당일 마감값과 일치하는지 점검. 의심되면 시각을 늦춘다.

## 범위 밖 / 후속

- 시장 job에 `git pull --rebase` 추가(ETF와 대칭) — fallback 시각 분리로
  불필요해지나, 원하면 옵션 하드닝. 기본은 **하지 않음**.
- PAT 만료 리마인더 → 출시 후 `/schedule`로 만료 전 재발급 알림 설정 (만료일 기준).

## 별건 — 이번 작업과 무관한 기존 버그 (발견만, 여기서 안 고침)

timezone 검증 중 드러난 **기존(pre-existing)** 정합성 문제. 트리거 변경이
일으킨 것이 아니며, 이 스펙 범위 밖. 별도 spec으로 다룰 후보.
(캘린더 감사 sub-project E/F 후보 — [[project-pending-followups]] 참조.)

1. **US 공휴일 콘텐츠 하루 어긋남.** `isUsClosedOnly`는 `getMarketCalendarInfo(KST 날짜)`
   로 계산되지만, 리포트가 다루는 US 세션은 **전날 US 날짜**다. 가드레일 게이트가
   엉뚱한 날 켜진다. 연 ~9회(KST 평일·KR 개장에 걸리는 US 공휴일) 사실 오류 가능.
   올바른 판정: **`addDays(KST날짜,-1)`의 US 상태**를 봐야 한다.
2. **휴일 캘린더 2026 정적.** 2027년엔 맵이 비어 주말만 잡히고 공휴일을 못 거른다.
   2026 연말 전 2027 데이터 갱신 필요.

## 구현 작업 성격 — 런북(순서) 중심, 무거운 plan/subagent 불필요

advisor 검토대로 이 작업은 **~90% 외부 설정 + 문서**다. repo 코드 변경은
**워크플로 cron 1줄 + README 섹션**이 전부이며, 연산 파이프라인 코드는 0줄 변경.
대부분은 cron-job.org 계정 설정·GitHub PAT 발급·검증 실행이며, 이는 **사용자가
직접** 수행한다(외부 계정·토큰은 repo 밖). 따라서 "구현 계획"의 실체는
**순서가 박힌 런북**이다 — TDD subagent 기계는 코드 1줄에 과하다.

**런북 순서 (= 이 작업의 plan):**
1. **GitHub Fine-grained PAT 발급** (B절: dailyreport 단일, Actions R/W, 만료일 기록).
2. **cron-job.org 작업 생성** (A절 표 그대로, **timezone=Asia/Seoul** 함정 주의).
3. **로컬 curl로 204 확인** + `gh run list`에 dispatch 실행 등장 확인 (검증 step 1).
4. **cron-job.org TEST RUN** 버튼으로 외부 경로 동일 확인 (검증 step 2).
5. **첫 평일 06:40 실발화 + 데이터 정합성 확인** (검증 step 3 — 07:00 이전 도착 + ^GSPC 종가 일치).
6. **5 통과 후에야** 백업 cron shift(`30 21`→`30 22`) + README 섹션을 main에 머지 (C절 게이트).
