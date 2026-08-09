# market job 재실행 복원력 — checkout `ref: main` + commit 후 rebase

작성: 2026-08-09
상태: 설계 승인됨 (구현 대기)
계기: 2026-08-07 아침 마켓 리포트 4시간 지연 인시던트

## 문제

2026-08-07(금) 마켓 리포트가 06:40 발송 목표를 놓치고 **10:38에야 도착**했다.
원인은 세 겹이었고, 이 spec은 그중 **두 번째만** 다룬다.

### 인시던트 타임라인 (KST)

| 시각 | 사건 |
|------|------|
| 06:40:08 | cron-job.org가 `workflow_dispatch` 트리거 (run `31128462234`, attempt 1) |
| 06:40:09 → 06:55:12 | **market job이 러너를 배정받지 못한 채 15분 대기 후 취소** |
| 06:55:20 → 06:59:24 | etf job은 러너를 받아 정상 완료 → ETF 커밋 `3489a57` push + Telegram 발송 |
| 08:27:32 | 사용자가 실패 job 재실행 (attempt 2) |
| 08:30:55 → 08:34:28 | 마켓 리포트 생성 성공 (3분 37초, 정상 속도) |
| 08:34:29 | **`git push` 거부 — non-fast-forward** → 발송 중단 |
| 10:35:38 → 10:39 | 백업 schedule cron이 3시간 5분 지연 발화 → 성공, 10:38:28 push |

### 원인 ① 러너 미배정 (이 spec의 범위 밖)

check-run 어노테이션 원문:

> `The job was not acquired by Runner of type hosted even after multiple attempts`

파이프라인이 느렸던 게 아니라 job이 시작조차 못 했다. 러너 대기 시간도
`timeout-minutes: 15`에 포함되어 15분 03초에 취소됐다. attempt 1의 로그가
아예 존재하지 않는 것(`BlobNotFound`)도 실행 자체가 없었기 때문이다.

같은 뿌리의 정황이 하나 더 있다 — 22:30 UTC 백업 cron이 그날 3시간 5분 밀렸다
(평소 지연은 ~1시간). 그날 GitHub Actions 큐가 전반적으로 혼잡했다.

**GitHub 인프라 문제이므로 통제 밖이다. 이 spec은 여기를 고치지 않는다.**

### 원인 ② 재실행 경로의 구조적 결함 (이 spec이 고치는 것)

재실행(re-run)은 **트리거 시점의 SHA**(`f2e5c3e`)를 체크아웃한다. 그사이 같은
run의 etf job이 `3489a57`을 push해둔 상태라 로컬이 1커밋 뒤처졌고, push가
거부됐다.

두 job의 비대칭이 원인이다:

| | market job | etf job |
|---|---|---|
| checkout | `ref` 지정 없음 → 트리거 SHA 고정 (`daily-report.yml:58-61`) | `ref: main` → 항상 최신 (`:194-198`) |
| push 전 | 없음 (`:114-120`) | `git pull --rebase origin main \|\| true` (`:261`) — **단, 아래 참조: 이 줄은 실행된 적이 없다** |

평소엔 market이 먼저 push하니 드러나지 않다가, **market이 죽고 etf만 성공한**
이 순서에서 터졌다.

### 원인 ③ 백업 cron 지연 (범위 밖)

07:30 KST 목표 백업이 10:35에 발화. GitHub `schedule`의 만성 지연은
[`2026-06-02-morning-trigger-reliability-design.md`](./2026-06-02-morning-trigger-reliability-design.md)에
이미 실측·문서화된 알려진 성질이다. 통제 밖.

## 설계 중 발견 — etf의 rebase는 16주간 죽어 있었다

이 spec 초안은 "etf 패턴을 그대로 복사한다"였다. 검증 중 그 패턴 자체가
**작동한 적이 없다**는 것이 드러났다.

etf job(`:254-265`)에서 `git pull --rebase`는 `git add`/`git commit`보다
**앞**에 있다. 그 시점의 작업 트리에는 수정된 `data/*.json`이 있고, git은
거부한다:

```
error: cannot pull with rebase: You have unstaged changes.
error: Please commit or stash them.
exit=128
```

`|| true`가 이 실패를 삼킨다. 더 결정적인 것은 push 스텝의 발동 조건이다 —
`steps.changes.outputs.changed == 'true'`는 `git diff --quiet`의 실패, 즉
**더러운 트리를 보장**한다. 스텝의 전제 조건이 rebase 실패를 보장하는 구조다.
`rebase.autoStash`는 기본값 false(runner git 2.54)라 자동 구제도 없다.

따라서:

- etf가 16주간 무사고였던 것은 rebase 덕분이 아니다. attempt 1(21:58)에서
  etf를 실제로 구한 것은 **`ref: main` 하나**다.
- 초안의 "rebase = 2차 방어" 주장은 **거짓이었다**. 지금 위치에서는 아무것도
  방어하지 않는다.

이 발견으로 변경 범위가 market 2줄 → **market 2줄 + etf 1줄 이동**으로 늘었다.

## 목표 / 비목표

**목표.** market job이 재실행되거나 로컬이 main보다 뒤처진 상태에서도 push가
성공한다. 사람이 재실행 버튼을 눌렀을 때 그것이 실제로 복구 수단으로 작동한다.
덧붙여, 두 job의 rebase 안전망이 **실제로 실행되는** 위치에 놓인다.

**비목표.**
- 러너 미배정 대응 (GitHub 인프라, 통제 밖)
- 실패 Telegram 알림 — 후속 후보로만 기록
- 외부 2차 트리거(cron-job.org 07:40 추가) — 후속 후보로만 기록
- `timeout-minutes` 조정 — **의도적으로 하지 않는다.** 러너를 못 잡는 상황에선
  조기 실패가 오히려 백업 cron에 자리를 넘겨주는 쪽이 낫다. 늘리면 실패를
  늦출 뿐이다.
- `|| true` 제거 — etf와의 동형성 우선 (아래 리스크 참조)
- 연산 파이프라인(`scripts/run.ts`, `scripts/run-etf.ts`) 변경 0줄

## 변경 내용

`.github/workflows/daily-report.yml` 3곳.

### ① market checkout에 `ref: main` (`:58-61`)

```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    ref: main          # 재실행 시 트리거 SHA가 아닌 최신 main을 잡는다
```

### ② market push 스텝에 rebase 추가 — **commit 뒤** (`:114-120`)

```yaml
  git add public/reports/ data/
  git commit -m "Daily Market Report - ${REPORT_DATE} (KST)"
  git pull --rebase origin main || true
  git push
```

### ③ etf push 스텝의 rebase를 commit 뒤로 이동 (`:254-265`)

```yaml
  git add public/etf-reports/ data/
  git commit -m "ETF Daily Report - ${REPORT_DATE} (KST)"
  git pull --rebase origin main || true    # ← git config 직후에서 여기로 이동
  git push
```

etf 스텝 상단의 기존 주석("Pull any market-job commit that landed during this
run so we don't race-fail on push")은 이동 후에야 비로소 사실이 된다.

## 왜 두 장치가 다 필요한가

**`ref: main`이 이번 인시던트의 실질적 해결책이다.** 재실행이 최신 main에서
시작하므로 non-fast-forward가 발생할 여지 자체가 사라진다. 이것만으로 08-07
시나리오는 완전히 막힌다.

**commit 후 rebase는 다른 창을 막는다** — checkout과 push 사이(마켓 기준 약
3~4분)에 다른 커밋이 main에 들어오는 경우. `ref: main`은 checkout 시점의
스냅샷일 뿐이라 이 창을 못 막는다. 지금까지 이 창은 열려 있었고(rebase가 죽어
있었으므로), 두 job의 push 시각이 Vercel 배포 폴링으로 직렬화된 덕에 우연히
사고가 없었다.

`ref: main`에는 부수 효과가 하나 더 있고 이게 실은 작지 않다. 재실행이 **최신
데이터·코드**로 돌게 되면서 `scripts/run.ts`의 중복 실행 가드가 정상 작동한다.
이번 인시던트에서 attempt 2는 옛 SHA를 보고 "오늘자 리포트 없음"으로 판단해
리포트를 통째로 재생성했고(Claude API 비용 중복 지출), 그 결과물은 push 실패로
버려졌다. 헤드라인이 최종본과 다른 것이 그 증거다:

- attempt 2 생성분(버려짐): "코스피 -4.58%, 한 주를 닫는 무게"
- 최종 발송분(`66f1fd3`): "엔비디아발 HBM 셈법 바뀌나, 삼성·SK 온도 갈렸다"

## 안전성 근거

**파일 집합이 겹치지 않는다.** 최근 5회 커밋 실측:

| job | 건드리는 경로 |
|---|---|
| market | `data/{reports-index,narrative-log,market-snapshot}.json`, `data/last-data-hash.txt`, `public/reports/` |
| etf | `data/etf-*.json` (4개), `public/etf-reports/` |

교집합 0개 → rebase 충돌은 사실상 발생하지 않는다.

**`ref: main`은 16주간 검증됐다.** etf job이 `f6a6cc8`(2026-04-18) 이래 이
설정으로 운영됐고, attempt 1에서 실제로 이 장치가 etf를 구했다.

**rebase 배치에 대해서는 "검증됐다"고 말할 수 없다.** etf의 16주 무사고는
push 실패 0건이라는 뜻일 뿐, rebase 분기는 한 번도 실행된 적이 없다. 올바른
배치의 근거는 운영 이력이 아니라 아래 재현 실험이다.

**정상 실행에는 사실상 no-op이다.** 트리거 SHA = main 최신이라 checkout 결과가
같고, rebase는 가져올 커밋이 없어 즉시 통과한다.

## 리스크

`|| true`는 rebase 실패를 계속 삼킨다. 실패 시 push가 거부되고 job이 실패한다
— **현재보다 나빠지지는 않는다**(지금도 같은 상황에서 실패). 두 job을 나란히
읽을 때 헷갈릴 여지를 없애는 값이, 실패 로그가 한 단계 덜 명확해지는 값보다
크다고 봤다. 다만 이제 rebase가 실제로 실행되므로, 이 선택의 무게는 초안
때보다 커졌다 — 첫 실전 rebase가 예상과 다르게 굴면 `|| true` 제거를 재검토한다.

`ref: main`은 트리거 SHA가 아닌 최신 main의 워크플로로 도는 것을 뜻한다.
트리거 직후 워크플로가 수정되면 새 버전이 실행된다. etf job이 이미 그렇게
동작 중이므로 새로 생기는 위험이 아니다.

**etf 변경은 살아있는 발송 경로를 건드린다.** 16주간 (죽은 채로) 안정적이던
스텝이므로, 변경 후 첫 평일 etf 발송을 반드시 확인한다.

## 검증 계획

### 1. 재현 실험 (완료 — 2026-08-09)

스크래치 bare repo로 두 순서를 비교했다. 워크플로 셸 로직의 등가물이다.

| 순서 | 결과 |
|---|---|
| rebase → commit → push (현재) | rebase `exit=128` (`cannot pull with rebase: You have unstaged changes`) → `\|\| true`가 삼킴 → **push 거부** = 인시던트 재현 |
| commit → rebase → push (변경안) | `Successfully rebased and updated refs/heads/main` → **push 성공**, 히스토리는 `market commit` → `etf commit` 순 선형 |

RED→GREEN이 확인됐다.

### 2. 첫 평일 라이브 확인

- market job 로그: checkout이 main을 잡는지, rebase 라인이 no-op으로 통과하는지,
  push·Telegram이 평소대로 완료되는지
- **etf job 발송 확인** (③ 변경의 회귀 감시)

### 3. 실전 재실행

재실행 상황이 실제로 생기면 그때가 진짜 검증이다. 인위적으로 만들지 않는다
(실제 리포트가 생성·발송되므로).

## 후속 후보 (이번에 안 함)

- market job 실패 시 Telegram 알림 — 이번엔 사용자가 실패를 알아채는 데
  1시간 47분이 걸렸다.
- cron-job.org 2차 트리거(예: 07:40 KST) — GitHub `schedule` 백업의 만성 지연
  (그날 3시간)을 우회.
- `|| true` 제거 — 첫 실전 rebase 관찰 후 재검토.
