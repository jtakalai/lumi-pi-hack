# pi-ledger

Token and handoff accounting for the [pi-handoff collection](../../README.md)
— component D of the project plan. Reproducible metrics for token
consumption and switching overhead (plan §5.4): tokens attributed to each
physical model and episode, escalations and model transitions, cost.

Passive observer: it never selects or changes models (that is
[pi-handoff](../pi-handoff/)'s single job).

## What it records

- **Per response:** every assistant `message_end` carries its physical
  model (`provider/model`) and usage — input, output, cache-read,
  cache-write tokens and the cost pi recorded from the provider's prices
  (local/unpriced models contribute $0).
- **Episodes:** `pi-handoff:boundary` events (from
  [pi-episodes](../pi-episodes/) or pi-handoff's `/handoff reset`)
  segment responses into episodes; the session's initial episode is
  `null`/unassigned.
- **Handoff events:** `pi-handoff:state` events — escalations (with the
  risk at latch and the threshold), manual boundaries, and boundaries —
  are recorded per episode.
- **Transitions:** consecutive responses on different physical models are
  recorded as a transition (this also captures manual model switches).

Tier labels: set `PI_LEDGER_CHEAP` / `PI_LEDGER_STRONG` to the same
`provider/model` refs pi-handoff is configured with (start.sh does this)
to label models as `cheap`/`strong` in reports; without them every model
is `other`.

## Commands

```
/ledger status          live totals: workflow, per model, per episode,
                        handoff counts, current phase/risk
/ledger report [PATH]   write PATH.jsonl and PATH.csv (default
                        ./pi-ledger-report)
```

`PATH.jsonl` — one line per episode, then one workflow line:

```json
{"level":"episode","episodeId":null,"requests":3,"tokens":{...},"byModel":{...},"handoffs":[{"t":"...","kind":"escalation","episodeId":"ep-1","detail":{"phase":"STRONG_LOCKED","risk":4,"threshold":4}}],"transitions":[{"t":"...","from":"prov/cheap","to":"prov/strong"}]}
{"level":"workflow","episodes":2,"escalations":1,"boundaries":1,"lastPhase":"CHEAP","lastRisk":0,"threshold":4,"tokens":{...},"perModel":{...}}
```

`PATH.csv` — per-model aggregates for the whole workflow, biggest total
first:

```csv
model,tier,episodes,requests,input,output,cacheRead,cacheWrite,totalTokens,costUSD
"prov/strong-m",strong,1,1,100,10,50,0,500,0.050000
"prov/cheap-m",cheap,2,3,300,30,150,0,480,0.003000
```

## Load

```bash
pi -e ./extensions/pi-ledger/index.ts
```

It works standalone (no pi-handoff/pi-episodes loaded): responses are
still attributed per model, and the unassigned episode accumulates
everything. Without boundaries there is simply one episode.

## Notes and limitations

- Accounting is in-memory for the session lifetime (fresh at
  `session_start`); the session files remain the durable record. Offline
  re-computation of per-model totals from session files is what
  [pitok](../../pitok/) does.
- Direct requests (e.g. compaction summaries) are counted under the model
  that answered them, like any other response.
- Cost is whatever pi recorded in `usage.cost` — configure model prices in
  pi's model configuration to get nonzero cost for your providers.
