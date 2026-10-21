# pi-episodes

Workflow boundary controller for the [pi-handoff collection](../../README.md).
Defines and signals **episode boundaries** independently from the routing
algorithm — the only place where the strong-model lock is released and
accumulated risk is reset.

A session starts in episode `ep-1` (no boundary event for it). Every boundary
starts the next episode; `ep-<n>` ids are handed to pi-handoff via the
`pi-handoff:boundary` event-bus channel and to the (future) pi-ledger via the
persisted session entry.

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
3. **Conversational default policy**: an agent run that has *settled*
   followed by a *new user task* starts a new episode. Off with
   `PI_EPISODES_USER_TURN=0`.

Automatic semantic subtask segmentation is **out of scope**: for
single-prompt autonomous workflows without explicit intermediate boundaries,
the strong-model lock simply stays active until the whole episode completes.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `PI_EPISODES_MARKER` | `^\s*\[episode\s*:\s*(next\|new\|done)\s*\]` | regex, marker at start of a message |
| `PI_EPISODES_USER_TURN` | on | mechanism 3 toggle |

## Persistence

Each boundary appends a `pi-episodes:state` custom entry
(`{counter, episodeId, kind, reason, t}`) to the session. On `resume`/`reload`
the counter is restored from the latest such entry on the active branch, so
episode ids stay stable across reloads and per branch.

## Load

```bash
pi -e ./extensions/pi-episodes/index.ts
```
