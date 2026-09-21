# 백업 수단 재설계 — cron-job.org 2차 트리거 + 발송 실패 복구

작성: 2026-09-21
상태: **초안 — 사용자 검토 대기** (구현 미착수)
계기: 2026-09-20 KRX 관측 job을 올리다, 백업 schedule이 08-27 이후 개장(09:00) 뒤에 발화하고 있음을 발견

## 문제

### 실측 (2026-06-18 이후 평일 68일, `gh run list`)

| 항목 | 결과 |
|---|---|
| cron-job.org 06:40 정시 트리거 | 67/67 발화, 지연 7~30초 |
| 정시 실행이 success가 아닌 날 | 7일(10%): 06-19 취소, 06-23·24 API 키 무효, 07-16 JSON 파싱, 08-07 러너 미배정, 08-18 apt 행, 08-21 ETF 생성 3연속 실패 |
| GitHub 백업 schedule(`30 22 * * 0-4`, 07:30 KST 의도)의 실제 발화 | 월별 중앙값 7월 08:27 · 8월 08:08 · **9월 09:23** (9월 15건 전부 09:00 이후, 최대 15:12) |

1. **백업이 개장 뒤에 돈다.** 열흘에 한 번꼴로 나는 "실행 중 실패"를, 지금의 백업은 개장 후에야 복구한다.
   늦은 발송에 더해 Yahoo가 장중가를 돌려줘 "전 거래일 종가"로 오표기될 수 있다(08-07 10:36 실행의 실제 사례).
   GitHub schedule의 지연은 달마다 20분~2시간으로 흔들려 시각을 조정해도 의미가 없다.
2. **백업은 생성 실패만 복구한다.** 리포트가 커밋된 뒤 Vercel 대기나 Telegram 발송에서 실패하면, 다음 실행은
   중복 가드(`scripts/run.ts:160-175`, `scripts/run-etf.ts:68-90`)로 생성 전에 종료하고 `changed=false`라
   발송 step도 건너뛴다(`daily-report.yml:180`). 그 리포트는 끝내 독자에게 도착하지 않는다.
3. **발송 성공을 확인하지 않는다.** 두 발송 step은 `curl -s`만 호출한다(`daily-report.yml:209-213, 382-386`).
   Telegram이 `{"ok":false}`를 줘도 step은 성공으로 끝난다. 그래서 2번을 고치려 해도 "발송됐는가"를 알 방법이 없다.
4. (같은 step의 기존 결함) LLM이 만든 헤드라인이 `HEADLINE="${{ … }}"`로 셸 소스에 직접 보간된다
   (`daily-report.yml:187, 349`). 큰따옴표·`$(…)`가 들어오면 문법이 깨지거나 명령이 실행된다. 이 step엔 봇 토큰이 있다.

## 사용자 결정 (2026-09-21)

범위는 **A + B + C** — 2차 트리거, GitHub schedule 3순위 유지, 발송 실패 복구까지.
중복 발송은 없어야 한다(구독자 채널에 같은 리포트가 두 번 가는 것은 미발송만큼 나쁘다).

## 설계

### A. cron-job.org 2차 트리거 (코드 변경 없음, 사용자 작업)

같은 워크플로를 한 번 더 dispatch한다. 그날 리포트가 이미 있으면 기존 중복 가드가 수집 전에 종료한다 —
현행 백업 schedule이 매일 밟는, 운영 검증된 경로다. Phase 2(ETF 08:10 전환)와 한 번에 설정한다.

| cron-job.org 작업 | 시각(KST, 월~금) | body |
|---|---|---|
| 마켓 정시(기존 수정) | 06:40 | `{"ref":"main","inputs":{"only":"market"}}` |
| 마켓 2차(신규) | 07:20 | 〃 |
| ETF 정시(신규) | 08:10 — KRX 관측으로 확정 | `{"ref":"main","inputs":{"only":"etf"}}` |
| ETF 2차(신규) | 08:35 | 〃 |

간격은 job timeout(market 20분, etf 15분)보다 길게 잡아 정시 실행과 겹치지 않는다.

### B. GitHub schedule은 3순위로 그대로 둔다

cron-job.org 자체가 죽은 날(68일 중 0일)에만 의미가 있는, 유일하게 독립된 경로다. cron을 바꾸지 않는다.
→ **Phase 2 spec의 "schedule을 둘로 나누고 `github.event.schedule`로 job 분기"는 폐기한다.** schedule 실행은 지금처럼
두 job을 모두 돌리고 중복 가드에 맡긴다. (3순위가 08:00 전에 돌면 ETF는 KRX stale 경로 = NAV 없는 리포트가 되지만,
3순위의 드문 경로에서 받아들일 수 있는 저하다.)

### C. 발송 실패 복구

#### C1. 발송 상태를 commit status로 기록한다

이 워크플로는 이미 Vercel 배포 결과를 commit status로 읽는다(`daily-report.yml:150-177`). 같은 수단으로
"이 리포트가 발송됐는가"를 **리포트 커밋의 SHA에** 기록한다. 상태 파일·추가 커밋이 필요 없고, 다음 실행이 API로 읽을 수 있다.

- context: `telegram/market`, `telegram/etf`
- (없음) — 발송 step에 도달하지 못함(Vercel 대기 실패, job 중단). **재발송 대상**
- `pending` — 발송 **직전에** 먼저 기록한다. 이 상태로 남아 있으면 "보냈는지 모름"(발송 중 job이 죽었거나, 발송 뒤 기록에 실패). **자동 재발송하지 않는다**
- `success` — Telegram이 `ok:true`로 응답함. 완료
- `failure` — Telegram이 `ok:false`로 **명확히 거부**함. **재발송 대상**
- `error` — **결과 불명**(응답 없음·타임아웃·JSON 아님). 실제로는 갔을 수 있으므로 **자동 재발송하지 않는다**

`pending` 기록에 실패하면 보내지 않고 step을 실패시킨다(아무것도 안 나갔고 status도 없으므로 다음 실행이 재발송한다).

권한: `statuses: read` → `statuses: write`.

#### C2. 발송 step이 응답을 검사한다 (기존 bash 유지, 최소 변경)

메시지 조립·`--form-string`·HTML escape·resend cache-bust 등 검증된 부분은 그대로 둔다. 바꾸는 것:

- `curl -s …` → 응답 본문을 변수로 받고 `--max-time 30`. `node -e`로 `ok` 판정:
  `ok:true` → status `success` / `ok:false` → 로그에 `description` 출력, status `failure`, `exit 1` /
  응답 없음·JSON 아님 → status `error`, `exit 1`.
- 헤드라인 등 step output은 `${{ }}` 직접 보간 대신 `env:`로 넘긴다(`HEADLINE_RAW: ${{ … }}` → `HEADLINE="$HEADLINE_RAW"`).
  날짜·이상탐지 건수도 같은 방식.
- `set -x` 제거(명령 echo가 토큰이 든 URL을 찍는다 — GitHub가 마스킹하지만 불필요).

#### C3. 다음 실행이 미발송을 감지해 재발송한다

판정은 작은 TS 스크립트 `scripts/delivery-state.ts`에 두고 순수 함수로 테스트한다(`lib/delivery-state.ts`).

```
decideDelivery({ reportSha, telegramStatus, forceResend }) →
  'send'    : reportSha 있음 && (telegramStatus 없음 | 'failure')
  'skip'    : reportSha 없음(오늘 리포트 커밋이 없음 — 휴장·생성 실패)  또는 telegramStatus 'success'
  'unknown' : telegramStatus 'pending' | 'error' → 보내지 않고 ::warning 으로 사람에게 알림
  forceResend(resend_telegram_only=true)는 항상 'send' (사람의 명시적 의도)
```

- 오늘 리포트 커밋 찾기: checkout이 depth 1이라 git log 대신 API —
  `GET /repos/{repo}/commits?sha=main&since=<오늘 00:00 KST>`에서 메시지가
  `Daily Market Report - <DATE> (KST)` / `ETF Daily Report - <DATE> (KST)`로 시작하는 커밋(rebase로 SHA가 바뀌어도 메시지는 같다).
- 워크플로 흐름(각 job 동일):
  1. 생성 step(기존) → `changed`
  2. **신규 "Resolve delivery" step**: `changed=='true'`면 방금 push한 HEAD가 reportSha.
     아니면 위 API로 찾고 `decideDelivery` 실행 → output `action`, `sha`, `date`, `headline`(인덱스 파일에서).
  3. Vercel 대기 step(기존): 조건에 `action=='send'` 추가. 재발송 경로에선 HEAD(main tip)의 Vercel 상태를 본다 — 사이트가 최신 배포인지 확인.
  4. 발송 step: 조건을 `action=='send'`로 단순화(dry_run 제외). **발송 직전에 status를 한 번 더 읽어 `success`면 보내지 않는다**(수동 re-run·겹친 실행 방어).
- 정상 경로(`changed=='true'`)의 동작은 지금과 같다: push → Vercel 대기 → 발송. 달라지는 건 발송 뒤 status 기록뿐.

#### C4. 같은 job의 동시 실행을 막는다

`market`·`etf` job에 각각 `concurrency: { group: daily-report-market | daily-report-etf, cancel-in-progress: false }`.
정시·2차·3순위·수동 실행이 겹쳐도 같은 종류의 job은 직렬로 돈다 → 뒤 실행은 앞 실행의 커밋과 status를 반드시 본다.
(GitHub는 그룹당 대기 실행을 하나만 유지하고 나머지는 취소한다 — 대기열이 2개 이상 쌓이는 상황은 어차피 중복 실행이라 무해.)
`krx-probe`는 그룹에 넣지 않는다.

### 중복 발송이 생길 수 있는 경로와 방어

| 경로 | 방어 |
|---|---|
| 정시 실행이 끝나기 전에 2차 실행 시작 | C4 직렬화 + 간격 > timeout |
| 발송은 됐는데 결과 기록(`success`)에 실패 | 발송 직전에 써 둔 `pending`이 남는다 → 다음 실행은 '불명'으로 보고 재발송하지 않는다. 결과 기록은 3회 재시도 |
| Telegram 타임아웃(실제로는 전달됨) | `error` → 자동 재발송 안 함 |
| 사람이 실패 job을 re-run | 발송 직전 status 재확인 |

"불명"(`pending`·`error`)이면 `::warning`과 job summary에 상황과 수동 재발송 방법(`resend_telegram_only=true`)을 적는다. 자동으로는 보내지 않는다.

## 검증

- 단위 테스트: `decideDelivery`의 모든 분기(없음·failure→send, success→skip, pending·error→unknown, 리포트 없음→skip, forceResend).
  리포트 커밋 찾기(메시지 매칭, 날짜 경계), Telegram 응답 판정 함수(`ok:true`/`ok:false`/빈 응답/HTML 오류 페이지).
- 워크플로 정적 assert(`lib/workflow-triggers.test.ts`): 권한 `statuses: write`, 두 job의 concurrency 그룹, 발송 step에 `${{ steps.*.outputs.headline }}` 직접 보간이 없음, `curl` 응답 검사 존재, `krx-probe`엔 concurrency 없음.
- 실환경(머지 후, 휴장일 또는 장 마감 뒤):
  1. `dry_run=true` dispatch — 워크플로 유효성, 발송·status 기록 없음.
  2. 당일 리포트가 이미 발송된 상태에서 입력 없는 dispatch — `action=skip`(status `success`)로 **재발송되지 않음**을 확인. 이것이 가장 중요한 검증이다.
  3. `resend_telegram_only=true`는 **구독자 채널로 실제 발송되므로 검증에 쓰지 않는다.** 재발송 경로는 단위 테스트와 2번의 skip 판정으로 검증하고, `send` 분기의 실환경 검증은 첫 실제 장애 때로 미룬다(그 전까지는 로그의 `action=` 출력으로 매일 판정이 맞는지 확인).
- 배포 첫 주: 매일 로그에서 `Resolve delivery: action=…`과 commit status를 확인.

## 적용 순서

1. C(코드) 머지·push — 정상 경로의 동작은 같고 status 기록이 추가된다. 첫 거래일 아침 확인.
2. A(cron-job.org 2차 트리거)는 Phase 2 전환과 같은 날 설정한다. 그 전까지 2차 역할은 기존 GitHub schedule이 (늦게나마) 맡는다.
3. `krx-probe` 관측이 끝나기 전에 A를 켜면 2차 dispatch(only=both)에서도 probe가 한 번 더 돈다 — 그래서 A는 probe 제거(Phase 2) 이후에 켠다.

## 범위 밖

- 개장 후 실행 가드(M4) — 3순위 schedule이 개장 뒤에 도는 경우의 장중가 오표기는 남는다.
- 운영자 알림(실패 시 Telegram 개인 알림) — 2026-06-30 결정대로 GitHub 실패 이메일 유지.
- Telegram 429 `retry_after` 재시도 — `ok:false`는 `failure`로 기록되고 2차 실행이 재발송하므로 별도 재시도는 넣지 않는다.
