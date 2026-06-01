# 아침 트리거 신뢰성 — cron-job.org 정시 트리거 → GitHub workflow_dispatch

작성일: 2026-06-02
상태: 설계 승인됨 (구현 계획 대기)

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
[cron-job.org]  매일(월~금) 06:20 KST 정시
      │  HTTPS POST (GitHub dispatch API), HTTP 204 기대
      ▼
[GitHub Actions]  workflow_dispatch 수신 → 수 초 내 실행 시작
      │  기존 파이프라인 그대로: market job → (needs) etf job
      ▼
git push → Vercel 자동 배포 → Telegram sendPhoto  (~06:30~06:40 도착)

[GitHub schedule]  늦은 백업 트리거 — cron-job.org가 죽은 날에만 의미 있음
```

- 트리거 시각 06:20 KST → 두 리포트 모두 07:00 한참 전 도착.
  US 마감(여름 EDT 기준 05:00 KST) 이후라 데이터 신선도 문제 없음. 원래 06:30 의도와도 일치.
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
| Schedule | 월~금 06:20, **timezone = Asia/Seoul** |
| 성공 판정 | HTTP **204 No Content** |
| 실패 알림 | **이메일 알림 활성화 (필수)** |

- workflow는 파일명(`daily-report.yml`) 대신 **ID `260067407`** 로 지정 →
  파일명이 바뀌어도 트리거가 깨지지 않는다.
- cron-job.org가 timezone을 지원하므로 UTC 요일 환산(일~목) 불필요.

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

### C. GitHub schedule 백업 (시각 이동)

`daily-report.yml`의 schedule cron을 한 줄 **교체**(두 줄 병기 아님 — 백업은 1개):

```yaml
# 변경 전
schedule:
  - cron: '30 21 * * 0-4'   # 06:30 KST 목표

# 변경 후
schedule:
  - cron: '30 22 * * 0-4'   # 07:30 KST 목표 (늦은 백업)
```

- 이유: 시장 job의 push 스텝(`daily-report.yml:104-112`)에는 `git pull --rebase`가
  없다(ETF job `:225`에만 있음). cron-job.org(06:20)와 백업을 **구조적으로
  비겹치게** 분리하면 동시 실행 push 충돌 레이스가 원천 제거된다.
- cron-job.org 06:20 실행이 끝나(리포트 존재) 백업이 늦게 떠도, 중복 가드가
  파이프라인을 종료시켜 push 자체가 일어나지 않는다.

### D. 중복 실행 가드 (기존, 변경 없음 — 의존만 함)

- `scripts/run.ts:138-159`: 오늘 자 HTML 존재 + index 엔트리 있음 →
  `FORCE_REGENERATE != true`면 종료.
- `scripts/run-etf.ts:56-75`: 동일.
- 결과: cron-job.org가 06:20에 생성 완료 → 늦게 도는 GitHub schedule은
  "이미 있음 → 종료 → 변경 없음 → Telegram step 자동 skip".

### E. README 문서 산출물 (이 작업의 실질 deliverable)

`README.md`에 "아침 트리거" 섹션 추가:
- cron-job.org 작업 설정(URL/method/headers/body/schedule/tz) 전체
- PAT scope·만료일·재발급 절차
- schedule 백업 설계와 이중화 의도
- 트리거가 repo 밖(외부 계정 + 토큰)에 살기 때문에, 버전관리되는 이 문서가
  6개월 뒤·새 기기에서 복구할 수 있는 유일한 흔적이다.

## 검증 계획 ("done = 실제로 됨")

1. **로컬 curl**: dispatch 엔드포인트를 PAT로 직접 호출 → **HTTP 204** 확인 +
   `gh run list`에 workflow_dispatch 실행이 수 초 내 등장하는지 확인.
2. **cron-job.org TEST RUN 버튼**: 외부 경로 end-to-end 동일 확인.
3. **첫 평일 06:20 실제 발화**: 도착 시각 기록, 07:00 이전 도착 확인.

## 범위 밖 / 후속

- 시장 job에 `git pull --rebase` 추가(ETF와 대칭) — fallback 시각 분리로
  불필요해지나, 원하면 옵션 하드닝. 기본은 **하지 않음**.
- PAT 만료 리마인더 → 출시 후 `/schedule`로 만료 전 재발급 알림 설정 (만료일 기준).

## 구현 작업 성격

advisor 검토대로 이 작업은 **~90% 외부 설정 + 문서**다. repo 코드 변경은
워크플로 cron 1줄 + README 섹션이 전부이며, 연산 파이프라인 코드는 0줄 변경.
대부분은 cron-job.org 계정 설정·GitHub PAT 발급·검증 실행이다.
