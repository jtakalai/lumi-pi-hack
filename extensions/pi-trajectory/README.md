# pi-trajectory

Execution signal observer for the [pi-handoff collection](../../README.md).
Collects reusable trajectory diagnostics from tool events — **without invoking
another LLM and without selecting or changing any model**.

Part of the cumulative-risk policy `R_t = Σ wᵀu_t ≥ θ`: pi-trajectory produces
the `u_t` features, pi-handoff accumulates them and decides.

## Signals

| Feature | Fires when (per episode, without intervening progress) |
|---|---|
| `repeated_failure` | A normalized failure signature (command + error tail, or tool + error tail) appears a 2nd time (default) |
| `edit_churn` | A 3rd (default) successful `edit`/`write` to the same file |
| `stalled_progress` | A 3rd (default) repetition of the same non-read-only action |

**Progress** (MVP approximation of "measurable improvement"): a *successful
command execution* (`bash`/`powershell` exit 0) — the proxy for tests/build
passing. Successful edits and reads are not progress: an edit cannot be its
own improvement, and reading is exploration. All windows reset on progress
and on episode boundaries (`pi-handoff:boundary` events from pi-episodes).

Normalization is deliberately crude but deterministic: quoted strings, paths,
and numbers in commands and error tails become placeholders before hashing
(FNV-1a), so `npm test --testPathPattern=a` and `...=b` are the same action.
Overlap is intentional — a command failing 3× fires both `repeated_failure`
(2nd) and `stalled_progress` (3rd); the policy's feature weights absorb it.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `PI_TRAJECTORY_FAILURE_REPEAT` | 2 | occurrences of a failure signature that fire the feature |
| `PI_TRAJECTORY_CHURN_EDITS` | 3 | edits to one file that fire the feature |
| `PI_TRAJECTORY_STALL_REPEATS` | 3 | repetitions of one action that fire the feature |

## Commands

```
/trajectory status            episode windows, totals, last 20 timeline events
/trajectory export [PATH]     full timeline as JSONL (default ./pi-trajectory.jsonl)
```

## Output

Each detection is emitted on the event bus as
`{ feature, increment: 1, detail: {signature?, path?, count?, note?} }`
(contract in [`packages/shared`](../../packages/shared/)). The JSONL timeline
carries `{t, episodeId, type, feature?, increment?, detail}` per observation —
for offline analysis and the future pi-ledger.

## Load

```bash
pi -e ./extensions/pi-trajectory/index.ts
```
