# market job 재실행 복원력 — checkout `ref: main` + push 전 rebase

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
| push 전 | 없음 (`:114-120`) | `git pull --rebase origin main \|\| true` (`:261`) |

etf job에 있는 두 안전장치가 market job에는 둘 다 없다. 평소엔 market이 먼저
push하니 드러나지 않다가, **market이 죽고 etf만 성공한** 이 순서에서 터졌다.

### 원인 ③ 백업 cron 지연 (범위 밖)

07:30 KST 목표 백업이 10:35에 발화. GitHub `schedule`의 만성 지연은
[`2026-06-02-morning-trigger-reliability-design.md`](./2026-06-02-morning-trigger-reliability-design.md)에
이미 실측·문서화된 알려진 성질이다. 통제 밖.

## 이 결정이 뒤집는 것

6/02 설계는 이 변경을 **명시적으로 "하지 않음"으로 닫아뒀다**:

> **범위 밖 / 후속**: 시장 job에 `git pull --rebase` 추가(ETF와 대칭) —
> fallback 시각 분리로 불필요해지나, 원하면 옵션 하드닝. 기본은 **하지 않음**.

당시 근거는 "06:40 정시 발화와 22:30 백업은 **시각이 분리돼** 동시 실행 push
충돌 레이스가 원천 제거된다"였다. 그 전제 자체는 지금도 유효하다.

무너진 것은 전제가 아니라 **가정의 범위**다. 6/02 설계는 push 충돌을 오직
"두 트리거의 동시 실행" 문제로만 봤고, **같은 run 안에서 market이 죽고 etf만
성공해 main이 앞서가는 경로**는 상정하지 않았다. 시각 분리로는 이 경로를 막을
수 없다. 6/02 문서 해당 항목에 뒤집힘 표기를 남긴다.

## 목표 / 비목표

**목표.** market job이 재실행되거나 로컬이 main보다 뒤처진 상태에서도 push가
성공한다. 사람이 재실행 버튼을 눌렀을 때 그것이 실제로 복구 수단으로 작동한다.

**비목표.**
- 러너 미배정 대응 (GitHub 인프라, 통제 밖)
- 실패 Telegram 알림 — 후속 후보로만 기록
- 외부 2차 트리거(cron-job.org 07:40 추가) — 후속 후보로만 기록
- `timeout-minutes` 조정 — **의도적으로 하지 않는다.** 러너를 못 잡는 상황에선
  조기 실패가 오히려 백업 cron에 자리를 넘겨주는 쪽이 낫다. 늘리면 실패를
  늦출 뿐이다.
- 연산 파이프라인(`scripts/run.ts`) 변경 0줄

## 변경 내용

`.github/workflows/daily-report.yml`의 market job, 2줄.

### ① checkout에 `ref: main` (`:58-61`)

```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    ref: main          # 재실행 시 트리거 SHA가 아닌 최신 main을 잡는다
```

### ② push 전 rebase (`:114-120`)

```yaml
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git pull --rebase origin main || true
  REPORT_DATE=${{ steps.report.outputs.date }}
```

etf job(`:261`)과 **완전 동형**으로 맞춘다. `|| true`까지 그대로 복사한다.

## 왜 두 줄 다 필요한가

`ref: main`이 1차 방어다. 재실행이 최신 main에서 시작하므로 non-fast-forward가
발생할 여지 자체가 사라진다. `git pull --rebase`는 2차 방어로, checkout 이후
push 직전 사이에 새 커밋이 들어와도 흡수한다.

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

**검증된 패턴이다.** etf job은 `f6a6cc8`(2026-04-18, etfreport 흡수)에서 두
안전장치를 함께 갖고 태어나 **약 16주간** 동일 구성으로 무사고 운영됐다.

**정상 실행에는 no-op이다.** 트리거 SHA = main 최신이므로 checkout 결과가
같고, rebase는 가져올 커밋이 없다.

## 리스크

`|| true`가 rebase 실패를 삼킨다. 그 경우 push가 다시 거부되고 job은 실패한다.
다만 **현재보다 나빠지지 않는다** — 지금도 같은 상황에서 실패한다. etf와의
동형성을 우선한 선택이며, 두 job을 나란히 읽을 때 헷갈릴 여지를 없애는 값이
실패 로그가 한 단계 덜 명확해지는 값보다 크다고 봤다.

`ref: main`은 트리거 SHA가 아닌 최신 main의 워크플로로 도는 것을 뜻한다.
트리거 직후 워크플로가 수정되면 새 버전이 실행된다. etf job이 이미 그렇게
동작 중이므로 새로 생기는 위험이 아니다.

## 검증 계획

워크플로 2줄 변경이라 단위 테스트가 없다. `dry_run=true`는 push 스텝을
건너뛰므로(`:113`) rebase 경로를 타지 않고, 실제 인시던트 조건(러너 미배정)은
재현할 수 없다. 따라서:

1. **다음 평일 정상 실행 회귀 확인** — market job 로그에서 `git pull --rebase`
   라인이 no-op으로 통과하는지, checkout이 main을 잡는지, push·Telegram이
   평소대로 완료되는지 확인.
2. 그 이후 재실행 상황이 실제로 생기면 그때가 진짜 검증이다.

정직하게 말해 이 spec의 가장 약한 부분이다. 근거는 "etf에서 약 16주간 검증된
동일 구성을 그대로 복사한다"에 기댄다.

## 후속 후보 (이번에 안 함)

- market job 실패 시 Telegram 알림 — 이번엔 사용자가 실패를 알아채는 데
  1시간 47분이 걸렸다.
- cron-job.org 2차 트리거(예: 07:40 KST) — GitHub `schedule` 백업의 만성 지연
  (그날 3시간)을 우회.
