# pi-episodes

Workflow boundary controller for the [pi-handoff collection](../../README.md).
Defines and signals **episode boundaries** independently from the routing
algorithm — the only place where the strong-model lock is released and
accumulated risk is reset.

A session starts in episode `ep-1` (no boundary event for it). Every boundary
starts the next episode; `ep-<n>` ids are handed to pi-handoff via the
`pi-handoff:boundary` event-bus channel **and** via the persisted session
entry (the authoritative record — see Persistence below), and to the (future)
pi-ledger via the same entry.

## Boundary mechanisms

In priority order (project plan §3.3), deterministic and explicit only:

1. **Explicit workflow/benchmark step-completion markers**
   - A user message that is exactly `[episode:next]` (also `:new`, `:done`)
     is **consumed** — it does not trigger an agent run, no tokens spent.
     This is the benchmark interface: the runner emits a marker between
     workflow steps.
   - A marker at the *start* of a longer message fires the boundary and the
     message (marker included) is delivered to the model.
2. **User-issued commands**: `/episode next`, `/episode reset`
   (alias). `/episode status` shows the current episode and counts.
3. **Opt-in conversational convenience (OFF by default)**: an agent run that
   has *settled* followed by a *new user task* starts a new episode. Enable
   with `PI_EPISODES_USER_TURN=1`. **Benchmark runs must not use this** —
   use explicit episode boundaries (mechanisms 1–2) so episode segments are
   deterministic and reproducible.

Automatic semantic subtask segmentation is **out of scope**: for
single-prompt autonomous workflows without explicit intermediate boundaries,
the strong-model lock simply stays active until the whole episode completes.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `PI_EPISODES_MARKER` | `^\s*\[episode\s*:\s*(next\|new\|done)\s*\]` | regex, marker at start of a message |
| `PI_EPISODES_USER_TURN` | off | opt-in for mechanism 3 (`=1` enables) |

## Persistence (authoritative episode identity)

Each boundary appends a `pi-episodes:state` custom entry
(`{counter, episodeId, kind, reason, t}`) to the session **before** the
boundary event is emitted. These entries are the **authoritative record of
which episode a branch is in** — the bus event is only a notification:

- On `session_start` (fresh, resume, reload, switch) and on `session_tree`
  (branch navigation) the counter is re-derived from the latest entry on the
  active branch, so episode ids stay stable across reloads and per branch.
- pi-handoff reconciles its routing state against the same entries on every
  model request (`branchEpisodeAuthority` + `reconcileEpisode` in
  [`packages/shared`](../../packages/shared/) and
  `extensions/pi-handoff/src/state-machine.ts`): a boundary whose event this
  process never observed (recorded before the next model request, lost in a
  reload) still releases the strong-model lock, from branch entries alone.
  Entry order decides staleness: a boundary entry that sits *after* the
  branch's latest `pi.virtual-model-state` entry postdates the last persisted
  routing state.

## Load

```bash
pi -e ./extensions/pi-episodes/index.ts
```
