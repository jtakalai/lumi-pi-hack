# pi-handoff

Core router of the [pi-handoff collection](../../README.md) — the only
extension that dispatches models.

Implements the project plan's core policy: start each **episode** on a cheap
model; accumulate trajectory risk (produced by [pi-trajectory](../pi-trajectory/));
when `R_t >= θ`, escalate **once** to a strong model for the remainder of the
episode; at a valid **episode boundary** (produced by
[pi-episodes](../pi-episodes/)) release the lock and return to cheap. No
downgrade within an unfinished episode; full-context handoff (no
summarization, no transcript rewriting).

Boundaries reach the router two ways: the fast path is the
`pi-handoff:boundary` bus event; the **authoritative** path is the branch's
persisted `pi-episodes:state` entry, which pi-handoff reconciles against on
every model request. So a boundary whose event this process never observed
(process reload, boundary recorded before the next model request, branch
navigation) still releases the lock, from branch entries alone.

## The virtual model

Select `handoff/auto` (`/model handoff/auto` or `--model handoff/auto`).
Every request is routed by the episode state machine:

```
CHEAP ──R_t >= θ──▶ STRONG_LOCKED ──episode boundary──▶ CHEAP (risk = 0)
```

- **State persistence:** the state machine state is the virtual model's
  router state — pi stores it on the session branch (per branch, survives
  compaction, follows `/tree` forks) and returns it as `request.state`.
- **Boundary reconciliation:** on every model request the router compares
  its state with the branch's authoritative episode record (latest
  `pi-episodes:state` entry + the position of the latest
  `pi.virtual-model-state` entry for this virtual model, in
  [`packages/shared`](../../packages/shared/)). If the boundary record
  postdates the last persisted routing state, the boundary is applied from
  the entries alone — releasing the lock and resetting risk, with the
  escalation count preserved and a `pi-handoff:state` (reason `boundary`)
  event emitted.
- **Retry safety:** automatic retries keep the physical model that failed,
  preserving prompt-cache and thinking signatures.
- **Durable record:** every state change is also emitted on the
  `pi-handoff:state` event-bus channel (contract in
  [`packages/shared`](../../packages/shared/)) for the future pi-ledger; the
  branch-persisted `pi.virtual-model-state` entries in the session JSONL are
  the durable handoff-event record.

## Configuration (required)

Cheap and strong models have **no defaults** — configure exactly one pair:

| Field | Flag | Env | File |
|---|---|---|---|
| cheap model `provider/model-id` | `--handoff-cheap` | `PI_HANDOFF_CHEAP` | `cheap` |
| strong model `provider/model-id` | `--handoff-strong` | `PI_HANDOFF_STRONG` | `strong` |
| threshold θ (>= 1, default 4) | `--handoff-threshold` | `PI_HANDOFF_THRESHOLD` | `threshold` |
| weights (default 1,1,1) | — | `PI_HANDOFF_WEIGHTS` (`"1,1,1"` or JSON) | `weights` |

`PI_HANDOFF_CONFIG=<path>` points at an explicit config file and **replaces**
`<pkg>/handoff.config.json` (an absent file then simply means "no file
config") — this is how the lab harness pins per-arm configs.

Precedence: flag > env > config file (explicit `PI_HANDOFF_CONFIG` path, or
`handoff.config.json` in the package root — see
`handoff.config.json.example`) > defaults. Model refs split on the first
slash, so `openrouter/anthropic/claude-...` works. The router refuses to
route until both models are configured and present in the catalog.

## Commands

```
/handoff status     phase, risk vs θ, episode, escalation count
/handoff config     resolved configuration
/handoff reset      standalone manual boundary (issues `manual-<n>` episode
                    ids; with pi-episodes loaded, prefer /episode next)
```

In interactive mode the footer status shows e.g.
`handoff: CHEAP r=2/4 ep-2` / `handoff: STRONG_LOCKED r=4/4 ep-2`.

## Load

```bash
pi -e ./extensions/pi-handoff/index.ts -e ./extensions/pi-trajectory/index.ts -e ./extensions/pi-episodes/index.ts
# or as local packages:
pi install ./extensions/pi-handoff
```

Without pi-trajectory/pi-episodes the router still works standalone: no risk
ever accumulates (stays CHEAP) and `/handoff reset` provides manual
boundaries.
