# pi-handoff-shared

Type + constant contracts shared by the collection's extensions. Pure only:
no I/O, no dependencies — types, immutable constants, and small pure
functions (safe across separately loaded extension module instances).

| Contract | Producer | Consumer(s) |
|---|---|---|
| `CHANNEL.risk` (`RiskEvent`) | pi-trajectory | pi-handoff |
| `CHANNEL.boundary` (`BoundaryEvent`) | pi-episodes | pi-handoff (and pi-trajectory, for window resets) |
| `CHANNEL.state` (`HandoffStateChange`) | pi-handoff | pi-ledger (future), diagnostics |
| `pi-episodes:state` entry (`EpisodesStateData`) | pi-episodes | pi-handoff (boundary reconciliation), pi-ledger (future) |
| `pi.virtual-model-state` entry (pi's own) | pi (router state) | pi-handoff (entry-order authority check) |

`HandoffState` is also the shape of the `handoff/auto` virtual model's
persisted router state (pi stores it on the session branch as a
`pi.virtual-model-state` custom entry — durable, per branch, survives
compaction).

**Authority model.** The event bus is a notification mechanism; the session
branch entries are the source of truth for boundary state. The
`pi-episodes:state` entry records which episode a branch is in, and
`branchEpisodeAuthority(branch, ...)` combines it with the position of the
branch's latest `pi.virtual-model-state` entry so pi-handoff can answer,
from the branch alone, whether a recorded boundary predates or postdates the
last persisted routing state (`reconcileEpisode` in
`extensions/pi-handoff/src/state-machine.ts` applies the decision). This is
what makes reloads, lost events, and branch changes safe: the bus is never
the only source of boundary state.

`VIRTUAL_MODEL_STATE_ENTRY` mirrors the constant from
`@earendil-works/pi-coding-agent` (the collection cannot value-import pi at
runtime); keep in sync if pi changes the entry type.
