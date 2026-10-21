# pi-handoff-shared

Type + constant contracts shared by the collection's extensions. No runtime
behavior, no dependencies: everything here is a type or an immutable constant
(safe across separately loaded extension module instances).

| Contract | Producer | Consumer(s) |
|---|---|---|
| `CHANNEL.risk` (`RiskEvent`) | pi-trajectory | pi-handoff |
| `CHANNEL.boundary` (`BoundaryEvent`) | pi-episodes | pi-handoff (and pi-trajectory, for window resets) |
| `CHANNEL.state` (`HandoffStateChange`) | pi-handoff | pi-ledger (future), diagnostics |

`HandoffState` is also the shape of the `handoff/auto` virtual model's
persisted router state (pi stores it on the session branch as a
`pi.virtual-model-state` custom entry — durable, per branch, survives
compaction).
