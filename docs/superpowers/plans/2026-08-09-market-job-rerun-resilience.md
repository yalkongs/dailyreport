# market job 재실행 복원력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** market job이 재실행되거나 로컬이 main보다 뒤처진 상태에서도 push가 성공하게 만들고, 두 job의 rebase 안전망을 실제로 실행되는 위치(commit 뒤)로 옮긴다.

**Architecture:** `.github/workflows/daily-report.yml` 한 파일, 3곳만 손댄다. market checkout에 `ref: main`을 추가하고(재실행이 트리거 SHA 대신 최신 main을 잡게), market push 스텝에 `git pull --rebase origin main || true`를 **commit 뒤**에 추가하며, etf push 스텝의 동일 줄을 **commit 뒤로 이동**한다. 연산 파이프라인 코드는 0줄 변경.

**Tech Stack:** GitHub Actions workflow YAML, `actions/checkout@v4`, bash, git

**설계 문서:** [`docs/superpowers/specs/2026-08-09-market-job-rerun-resilience-design.md`](../specs/2026-08-09-market-job-rerun-resilience-design.md)

## Global Constraints

- 변경 파일은 `.github/workflows/daily-report.yml` **단 하나**. 다른 파일 수정 금지.
- `timeout-minutes: 15`(market)·`10`(etf)는 **건드리지 않는다** — spec의 명시적 비목표.
- `|| true`는 **유지한다** — etf와의 동형성 우선, spec의 명시적 비목표.
- `git pull --rebase origin main`의 위치는 **반드시 `git commit` 뒤, `git push` 앞**. `git add` 앞에 두면 dirty tree로 `exit=128`이 나고 `|| true`가 삼켜 무력화된다(이 인시던트의 핵심 발견).
- 두 job의 push 스텝은 **동형**을 유지한다. 한쪽만 고치지 않는다.
- 커밋만 하고 **push하지 않는다**. push 시점은 사용자가 별도로 지시한다.
- 브랜치: `market-job-rerun-resilience` (이미 생성됨, spec 2커밋 적재됨)

## 테스트 전략 (읽고 시작할 것)

이 변경에는 단위 테스트가 없다. 워크플로 YAML이고, `dry_run=true`는 push 스텝
자체를 건너뛰므로(`:113`) rebase 경로를 타지 않으며, 실제 인시던트 조건(러너
미배정)은 재현할 수 없다.

대신 **셸 로직 등가물을 스크래치 git repo에서 재현**해 RED→GREEN을 확인한다.
이 재현은 spec 작성 중 이미 1회 통과했고(2026-08-09), Task 1에서 실행 가능한
형태로 다시 돌린다. 스크래치 산출물은 **repo에 커밋하지 않는다**(scratchpad에서만 실행).

각 Task는 YAML 파싱 검증(PyYAML 6.0.3 확인됨)과 순서 검증을 거친다.

---

### Task 1: 재현 테스트로 RED 확인 + market job 하드닝

**Files:**
- Modify: `.github/workflows/daily-report.yml:58-61` (market checkout)
- Modify: `.github/workflows/daily-report.yml:112-120` (market push 스텝)
- Test: 스크래치 repo 재현 (커밋 안 함)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: market push 스텝의 최종 셸 순서 — `git config` → `REPORT_DATE=` → `git add` → `git commit` → `git pull --rebase origin main || true` → `git push`. Task 2가 etf를 이 순서와 동형으로 맞춘다.

- [ ] **Step 1: 재현 테스트로 현재 순서가 실패함을 확인 (RED)**

스크래치 디렉토리에서 실행. `$SCRATCH`는 세션 scratchpad 경로로 치환한다.

```bash
set -e
S="$SCRATCH/rebase-red"
rm -rf "$S" && mkdir -p "$S" && cd "$S"
git init -q --bare origin.git
git clone -q origin.git work && cd work
git config user.email t@t && git config user.name t
echo v1 > data.json && git add . && git commit -qm init && git push -q origin HEAD
BR=$(git symbolic-ref --short HEAD)

# 다른 클론이 앞서 커밋 (etf job 역할)
cd "$S" && git clone -q origin.git other && cd other
git config user.email t@t && git config user.name t
echo etf > etf.json && git add . && git commit -qm "etf commit" && git push -q

# 원래 클론: 더러운 트리에서 rebase — 현재 워크플로 순서
cd "$S/work"
echo v2 > data.json
git pull --rebase origin $BR; echo "exit=$?"
```

Expected: `error: cannot pull with rebase: You have unstaged changes.` 와 `exit=128`.

- [ ] **Step 2: 같은 스크래치에서 수정안 순서가 성공함을 확인 (GREEN)**

```bash
set -e
S="$SCRATCH/rebase-red"
cd "$S/work"
BR=$(git symbolic-ref --short HEAD)
git add . && git commit -qm "market commit"
git pull --rebase origin $BR
git push
git log --oneline --graph -3
```

Expected: `Successfully rebased and updated refs/heads/<BR>.` → push 성공 → 히스토리가
`market commit` → `etf commit` → `init` 순 선형.

- [ ] **Step 3: market checkout에 `ref: main` 추가**

`.github/workflows/daily-report.yml:58-61`을 아래로 교체한다.

변경 전:
```yaml
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

변경 후:
```yaml
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          # 재실행(re-run)은 트리거 시점 SHA를 잡는다. 그사이 etf job이 push해
          # main이 앞서가면 push가 non-fast-forward로 거부된다(2026-08-07 인시던트).
          # etf job(:198)과 동일하게 항상 최신 main을 체크아웃한다.
          ref: main
```

- [ ] **Step 4: market push 스텝에 rebase 추가 — commit 뒤**

`.github/workflows/daily-report.yml:112-120`의 `run:` 블록을 아래로 교체한다.

변경 전:
```yaml
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          REPORT_DATE=${{ steps.report.outputs.date }}
          git add public/reports/ data/
          git commit -m "Daily Market Report - ${REPORT_DATE} (KST)"
          git push
```

변경 후:
```yaml
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          REPORT_DATE=${{ steps.report.outputs.date }}
          git add public/reports/ data/
          git commit -m "Daily Market Report - ${REPORT_DATE} (KST)"
          # ⚠️ rebase는 반드시 commit **뒤**에 온다. git add 앞에 두면 작업 트리가
          # 더러워 매번 "cannot pull with rebase: You have unstaged changes"(exit 128)로
          # 거부되고 `|| true`가 이를 삼킨다 — 이 스텝의 발동 조건(changed=='true')이
          # 더러운 트리를 보장하므로 구조적으로 실행 불가능해진다.
          git pull --rebase origin main || true
          git push
```

- [ ] **Step 5: YAML 파싱 + 순서 검증**

```bash
cd /Users/yalkongs/Project/dailyreport
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/daily-report.yml'))
m = d['jobs']['market']
co = [s for s in m['steps'] if s.get('name') == 'Checkout repository'][0]
assert co['with'].get('ref') == 'main', 'market checkout ref 누락'
push = [s for s in m['steps'] if s.get('name') == 'Commit and push report'][0]['run']
lines = [l.strip() for l in push.splitlines() if l.strip() and not l.strip().startswith('#')]
i_commit = next(i for i, l in enumerate(lines) if l.startswith('git commit'))
i_rebase = next(i for i, l in enumerate(lines) if l.startswith('git pull --rebase'))
i_push = next(i for i, l in enumerate(lines) if l == 'git push')
assert i_commit < i_rebase < i_push, f'순서 오류: commit={i_commit} rebase={i_rebase} push={i_push}'
print('OK — market: ref=main, 순서 commit -> rebase -> push')
"
```

Expected: `OK — market: ref=main, 순서 commit -> rebase -> push`

- [ ] **Step 6: 커밋**

```bash
cd /Users/yalkongs/Project/dailyreport
git add .github/workflows/daily-report.yml
git commit -m "fix: market job 재실행 복원력 — checkout ref: main + commit 후 rebase

2026-08-07 인시던트: 러너 미배정으로 market job이 취소된 뒤 재실행했으나,
re-run이 트리거 시점 SHA를 체크아웃해 그사이 etf가 push한 커밋을 몰라
non-fast-forward로 거부됐다. 리포트가 4시간 늦게 발송됐다.

- checkout ref: main — 재실행이 최신 main에서 시작 (etf:198과 동형)
- push 전 git pull --rebase origin main || true 를 commit 뒤에 추가

rebase를 commit 뒤에 두는 것이 핵심이다. git add 앞에 두면 dirty tree로
exit=128 거부되고 || true 가 삼켜 무력화된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FFaw4nHMW4mD8NqnK5aJHd"
```

---

### Task 2: etf job의 죽은 rebase 소생 (commit 뒤로 이동)

etf의 `git pull --rebase`는 `f6a6cc8`(2026-04-18) 이래 16주간 `git add` 앞에
있어 한 번도 실행되지 않았다. Task 1과 동일한 순서로 옮긴다.

**이 태스크는 살아있는 ETF 발송 경로를 건드린다.** 변경 후 첫 평일 etf 발송을
반드시 확인해야 한다(Task 3에 기록).

**Files:**
- Modify: `.github/workflows/daily-report.yml:254-265` (etf push 스텝)

**Interfaces:**
- Consumes: Task 1이 확정한 셸 순서 — `git config` → `REPORT_DATE=` → `git add` → `git commit` → `git pull --rebase origin main || true` → `git push`
- Produces: 없음 (마지막 코드 변경)

- [ ] **Step 1: etf push 스텝의 rebase를 commit 뒤로 이동**

`.github/workflows/daily-report.yml:254-265`의 `run:` 블록을 아래로 교체한다.

변경 전:
```yaml
        run: |
          # Pull any market-job commit that landed during this run so we
          # don't race-fail on push.
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git pull --rebase origin main || true
          REPORT_DATE=${{ steps.etf.outputs.date }}
          git add public/etf-reports/ data/
          git commit -m "ETF Daily Report - ${REPORT_DATE} (KST)"
          git push
```

변경 후:
```yaml
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          REPORT_DATE=${{ steps.etf.outputs.date }}
          git add public/etf-reports/ data/
          git commit -m "ETF Daily Report - ${REPORT_DATE} (KST)"
          # Pull any market-job commit that landed during this run so we
          # don't race-fail on push.
          # ⚠️ commit **뒤**에 와야 한다. git add 앞에 있던 2026-04-18~2026-08-09
          # 배치에서는 더러운 트리 때문에 매번 exit 128로 거부되고 `|| true`가
          # 삼켜, 16주간 한 번도 실행되지 않았다.
          git pull --rebase origin main || true
          git push
```

- [ ] **Step 2: YAML 파싱 + 두 job 동형 검증**

```bash
cd /Users/yalkongs/Project/dailyreport
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/daily-report.yml'))

def order(job, step_name):
    run = [s for s in d['jobs'][job]['steps'] if s.get('name') == step_name][0]['run']
    lines = [l.strip() for l in run.splitlines() if l.strip() and not l.strip().startswith('#')]
    return [next(i for i, l in enumerate(lines) if l.startswith(p))
            for p in ('git commit', 'git pull --rebase')] + \
           [next(i for i, l in enumerate(lines) if l == 'git push')]

for job, name in (('market', 'Commit and push report'), ('etf', 'Commit and push ETF report')):
    c, r, p = order(job, name)
    assert c < r < p, f'{job} 순서 오류: commit={c} rebase={r} push={p}'
    print(f'OK — {job}: commit({c}) -> rebase({r}) -> push({p})')

for job in ('market', 'etf'):
    co = [s for s in d['jobs'][job]['steps'] if s.get('name') == 'Checkout repository'][0]
    assert co['with'].get('ref') == 'main', f'{job} checkout ref 누락'
    print(f'OK — {job}: checkout ref=main')
"
```

Expected: 4줄 모두 `OK —` 로 시작.

- [ ] **Step 3: 커밋**

```bash
cd /Users/yalkongs/Project/dailyreport
git add .github/workflows/daily-report.yml
git commit -m "fix: etf job의 죽은 rebase 소생 — commit 뒤로 이동

f6a6cc8(2026-04-18) 이래 git pull --rebase 가 git add 앞에 있어
dirty tree로 매번 exit=128 거부되고 || true 가 삼켜왔다. push 스텝의
발동 조건(changed=='true' = git diff --quiet 실패)이 더러운 트리를
보장하므로 구조적으로 실행될 수 없는 배치였다 — 16주간 0회 실행.

commit 뒤로 옮겨 스텝 주석("Pull any market-job commit...")이
비로소 사실이 되게 한다. market job(Task 1)과 동형.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FFaw4nHMW4mD8NqnK5aJHd"
```

---

### Task 3: 최종 diff 검토 + 라이브 검증 항목 인수인계

**Files:**
- 변경 없음 (검토만)

**Interfaces:**
- Consumes: Task 1·2의 커밋
- Produces: 사용자에게 넘길 라이브 검증 체크리스트

- [ ] **Step 1: 전체 diff가 3곳뿐인지 확인**

```bash
cd /Users/yalkongs/Project/dailyreport
git diff main...HEAD --stat
git diff main...HEAD -- .github/workflows/daily-report.yml
```

Expected: 변경 파일은 `.github/workflows/daily-report.yml`과 `docs/superpowers/`
문서들뿐. 워크플로 diff는 market checkout `ref: main` 추가, market rebase 줄
추가, etf rebase 줄 이동 — 이 3가지 외에 아무것도 없어야 한다. `timeout-minutes`,
`|| true`, 다른 스텝이 변경됐다면 되돌린다.

- [ ] **Step 2: 라이브 검증 항목을 사용자에게 보고**

머지·push 후 **다음 평일 아침**에 확인할 항목(코드로 검증 불가, 관찰 필요):

1. market job 로그 — `Checkout repository`가 main을 잡는지, `git pull --rebase`가
   no-op으로 통과하는지(`Already up to date.` 또는 즉시 통과), push·Telegram 정상
2. **etf job 발송 확인** — Task 2가 살아있는 발송 경로를 건드렸으므로 회귀 감시
3. 두 리포트 도착 시각이 평소(06:45~07:00 KST)와 같은지

이 세 항목은 [[project-pending-followups]] 메모리에 이미 기록되어 있다.

---

## Self-Review

**1. Spec coverage**

| spec 요구 | 대응 |
|---|---|
| market checkout `ref: main` | Task 1 Step 3 |
| market push에 commit 후 rebase | Task 1 Step 4 |
| etf rebase를 commit 뒤로 이동 | Task 2 Step 1 |
| `timeout-minutes` 비변경 | Global Constraints + Task 3 Step 1 |
| `\|\| true` 유지 | Global Constraints |
| 파이프라인 코드 0줄 | Global Constraints (단일 파일 제약) |
| 재현 실험 RED→GREEN | Task 1 Step 1·2 |
| 첫 평일 라이브 확인(etf 회귀 포함) | Task 3 Step 2 |

누락 없음.

**2. Placeholder scan**

TBD/TODO 없음. 모든 코드 스텝에 실제 변경 전/후 블록과 실행 가능한 검증
스크립트가 들어 있다. `$SCRATCH`만 실행 시 치환이 필요하며 Task 1 Step 1에
명시했다.

**3. Type consistency**

셸 순서가 세 곳에서 동일하게 기술됐다 — Task 1 Interfaces, Task 1 Step 4,
Task 2 Interfaces, Task 2 Step 1. 검증 스크립트(Task 1 Step 5, Task 2 Step 2)가
같은 순서를 assert한다. 스텝 이름 `Commit and push report`(market)와
`Commit and push ETF report`(etf)는 실제 YAML과 일치 확인함.
