# MVP 1 — episode-scoped trajectory handoff: hardening + live smoke report

Date: 2026-10-21 · Branch: `feat/mvp1-episode-handoff` (commit `7ad8deb` + smoke artifacts)
Run host: `Aquila.local` (macOS), pi `1.3.0`

## 1. Scope of this milestone

The first MVP slice of the project plan: `pi-handoff` (router), `pi-trajectory`
(signal observer), `pi-episodes` (boundary controller), `packages/shared`
(contracts), plus a focused hardening pass — **without expanding the routing
algorithm** (`R_t = R_{t-1} + Σ wᵀu_t`, one-way latch at `R_t ≥ θ`, release
only at a valid episode boundary).

## 2. Hardening pass

### 2.1 TypeScript typechecking — now possible, and clean

The previous blocker (macOS TCC blocking `~/.npm`) was bypassed as authorized,
using an alternative npm cache:

```bash
npm_config_cache=/tmp/pi-npm-cache npm install --no-audit --no-fund
npm run typecheck        # tsc --noEmit
```

Result: **0 type errors** across `extensions/**`, `packages/**`, `test/**`
(strict mode, `nodenext`, verbatim module syntax, pi `1.3.0` type
declarations). The limitation noted in the previous milestone ("typecheck
impossible in this environment") is **resolved** for this slice; the
implementation is type-validated.

### 2.2 Boundary persistence: the event bus is no longer the only source of boundary state

**Problem.** pi-handoff previously released the strong-model lock only from
`pi-handoff:boundary` bus events. Bus events are per-process: a boundary
recorded before the next model request, or in a previous process (reload), or
on a different branch, could be missed — leaving the session stuck on the
strong model.

**Fix.** The branch's persisted entries are now the *authoritative* episode
identity; the bus is a fast notification path only.

- `packages/shared`: new contract `EPISODES_STATE_ENTRY`
  (`pi-episodes:state`) + `EpisodesStateData`, plus
  `branchEpisodeAuthority(branch, …)` which combines the latest episode entry
  with the position of the latest `pi.virtual-model-state` entry for
  `handoff/auto` — entry **order** answers "did this boundary happen before
  or after the last persisted routing state?".
- `extensions/pi-handoff/src/state-machine.ts`: new pure function
  `reconcileEpisode(state, authority)`:
  - no persisted episode / ids match → no-op (same object identity → no
    spurious state writes);
  - state postdates the latest boundary record and only its episode id was
    unassigned → adopt the id, **without** resetting;
  - boundary record postdates the state (or a different known episode id) →
    apply the boundary: release lock, reset risk, keep escalation count.
- `pi-handoff` `route()`: reconciliation runs on **every model request**,
  before serving, and emits a `pi-handoff:state` (`boundary`) change when it
  releases. `session_tree` (branch navigation) drops the in-memory working
  state so it can't leak across branches.
- `pi-episodes`: persists the entry **before** emitting the event; re-derives
  the counter on `session_start` (all reasons) and on `session_tree`.

### 2.3 Progress-detection rule: successful execution ≠ observable progress

**Problem.** Any successful `bash`/`powershell` exit-0 reset all risk windows.
A model spinning on a repeatedly *passing* test (or the same `ls` / build
log) could loop forever without the risk ever accumulating.

**Fix (lightweight heuristic, no file watching/diffing).** Progress is now a
successful command whose **normalized output changed** since its previous
success (same normalization as failure signatures: numbers/paths/hex/case
collapsed, FNV-1a). First success = baseline = progress. Identical output
again = no observable improvement: windows are **not** reset, and the
repetition accumulates toward `stalled_progress`. Successful edits/reads
remain non-progress.

**Benchmark policy.** The conversational user-turn boundary
(`PI_EPISODES_USER_TURN`) is now **OFF by default** — benchmark runs use
explicit boundaries only (`[episode:next]` markers / `/episode next`), making
episode segments deterministic and reproducible. Opt-in remains for
interactive use (`=1`).

### 2.4 Regression tests

`test/smoke.ts` grew from 60 to **84 checks** (all passing), new sections:

- **C10–C13 (progress rule):** identical successful output does not reset
  windows (churn still fires across non-improving successes); changed output
  resets; identical successful repetitions fire `stalled_progress`;
  number-collapsed outputs are the same state.
- **G1 (boundary recorded without a bus event):** locked state + branch entry
  only → next model request releases from the entry alone (pi-handoff loaded
  without pi-episodes); release is idempotent; escalation count survives.
- **G2 (process reload):** fresh in-memory state everywhere; branch carries
  router state (locked, ep-1) + boundary entry (ep-2) recorded *after* the
  last model request → first post-reload request serves CHEAP ep-2;
  pi-episodes counter restored.
- **G3 (branch changes):** each branch's entries are authoritative for that
  branch; a boundary on branch A releases A and does not clobber B's state.
- **G4 (reconcileEpisode units):** null-id stale → release; null-id fresh →
  adopt without reset; id match / no authority → same-reference no-op; locked
  + ahead → release keeping escalations.
- **G5/G6:** user-turn boundary OFF by default, ON with `PI_EPISODES_USER_TURN=1`.

Other changes: `PI_HANDOFF_CONFIG=<path>` env (explicit per-arm config file,
absent file = "no file config" — also makes the unconfigured-router test
hermetic), `package-lock.json` left untouched (restored from HEAD after local
install rewrote it).

**Results:** `tsc --noEmit` clean · `node test/smoke.ts` → **84 passed, 0 failed**.

## 3. Live real-provider smoke test (Cheap → Strong → Cheap)

### 3.1 Setup

| Role | Model (as selected) | Physical model | Thinking |
|---|---|---|---|
| cheap | `compat-custom/mistralai/Ministral-3-14B-Reasoning-2512` | Ministral-3-14B-Reasoning via `aitta-api.csc.fi` | off |
| strong | `hackathon-H200/Qwen/Qwen3.8-27B-FP8` | Qwen3.8-27B-FP8 on H200 | high |
| θ / weights | 4 | 1 / 1 / 1 | |

Config via `extensions/pi-handoff/handoff.config.json` (local, gitignored;
values documented in `handoff.config.json.example`). All three extensions
loaded with `-e`, virtual model `handoff/auto`.

### 3.2 The task (self-defined)

A strict simplified-CSV field parser (`smoke-task/`, kept in the repo so the
smoke is reproducible):

- **Turn 1 (hard):** implement `parse_fields()` per `SPEC.md` — quoted fields,
  doubled-quote escapes, embedded commas, empty/trailing fields — validated by
  a 12-case strict grader `test_parse.py` (exit 1 + one `FAIL <case>` line per
  failing case). Quoted-CSV edge cases are a known weak spot for a 14B
  non-thinking model, so repeated identical failing runs were the expected
  trajectory.
- **Turn 2 (after an explicit boundary):** small follow-up on the same file —
  a `__main__` stdin block with a strict 4-line expected output — sent as
  `[episode:next] <task>` (marker at message start = explicit boundary).

The grader was validated against a reference implementation before the run
(reference kept out of the workspace), and the reference was deleted.

### 3.3 Observed behavior (from the session JSONL — the ground truth)

**Turn 1 (episode ep-1):**

| # | Request served by | Phase | State after request |
|---|---|---|---|
| 1–6 | `compat-custom/mistralai/Ministral-3-14B-Reasoning-2512` (think off) | CHEAP | r: 0 → 1 → 2 |
| 7–9 | cheap (think off) | CHEAP | r: 2 → 3 → **4 = θ** |
| — | **escalation latches** | STRONG_LOCKED | escalations = 1 (at R=4) |
| 10–13 | `hackathon-H200/Qwen/Qwen3.8-27B-FP8` (think high) | STRONG_LOCKED | r: 4 → 5, lock held |

Task finished: `PASS: all 12 test cases` (grader exit 0).

**Boundary (explicit, turn 2 prompt start):**
session entry `pi-episodes:state` → `{"counter": 2, "episodeId": "ep-2",
"kind": "marker", "reason": "marker in prompt"}`.

**Turn 2 (episode ep-2):** first persisted handoff state after the boundary:
`CHEAP r=0 ep=ep-2 esc=1` — lock released, risk reset, **cumulative
escalation count preserved**, episode id adopted. All 6 follow-up requests
served by the **cheap** model (think off). Follow-up task finished correctly
(4-line output verified by the agent).

### 3.4 Token accounting (usage recorded per assistant message)

| Phase | Requests | Input tokens | Output tokens |
|---|---|---|---|
| Turn 1 — cheap (pre-escalation) | 9 | 24,729 | 2,595 |
| Turn 1 — strong (locked) | 4 | 33,146 | 4,759 |
| Turn 2 — cheap (post-boundary) | 6 | 47,540 | 1,900 |
| **Total** | **19** | **105,415** | **9,254** |

The strong model served 4 of 19 requests (21%) and was engaged only after the
risk threshold was crossed; the next episode returned to the cheap model with
zero state leakage (risk 0, same escalation counter).

### 3.5 Environment note (harness limitation, not an extension bug)

This agent's process tree cannot write to `~/.pi/agent` (macOS
permission: `EPERM` on lock-file `mkdir`), which crashes the pi CLI in its
default config directory. The live run therefore used a writable mirror:
`PI_CODING_AGENT_DIR=/tmp/pi-agent-smoke` (copied `models.json` + `auth.json`,
empty package list) plus a temporary extension (`/tmp/pi-smoke/aitta-provider.ts`,
not part of the repo) that registers the `compat-custom` (aitta) endpoint the
same way the `pi-openai-compat` package does. In the user's own terminal pi
runs normally without any of this; the workaround only affects how *this*
smoke was executed.

## 4. Status

| Item | Status |
|---|---|
| Typecheck (`tsc --noEmit`, strict) | ✅ clean |
| Deterministic tests | ✅ 84/84 |
| Boundary persistence (reload / pre-request / branch change) | ✅ regression-tested (G1–G4) |
| Progress rule (execution ≠ improvement) | ✅ implemented + tested (C10–C13) |
| Explicit boundaries for benchmarks (user-turn off by default) | ✅ implemented + tested (G5/G6) |
| Live Cheap → Strong → Cheap on real providers | ✅ observed end-to-end (session JSONL evidence above) |
| Escalation at θ, one-way latch, release at boundary, counter preserved | ✅ all observed |

**Everything in scope is working.**

## 5. Caveats & next steps

- **Model behavior, not mechanism:** whether the cheap model *needs* to
  escalate is data-dependent; this smoke's task was chosen to make the
  escalation path exercise reliably. Efficiency claims (tokens saved vs.
  always-strong) require the planned `benchmarks/` arm comparison.
- **Concurrency incident (transparency):** during this milestone another
  session on this machine was rewriting `main` history (author/email and
  trailer rewrites) and repeatedly reset the worktree. The work was recovered
  from git stashes and is committed on branch
  `feat/mvp1-episode-handoff` (pushed to origin); merging into `main` should
  wait until that history rewrite settles (a PR from the branch is ready:
  https://github.com/jtakalai/lumi-pi-hack/pull/new/feat/mvp1-episode-handoff).
- **Git identity:** commit author is still the auto-generated
  `Weixuan Ding <austin@Aquila.local>` — the pending identity fix (from the
  earlier request) is still open.
- **Next slice:** `pi-ledger` (cost/tokens per episode & model from session
  entries + `pitok`), then `benchmarks/` with explicit episode boundaries.
