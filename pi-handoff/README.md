# pi-handoff

Scaffold for **Plan C: trajectory-triggered one-way escalation** — see the
[project README](../README.md) for the full plan.

The idea: start every task on a cheap model and hand off **once** to a strong
model when the trajectory looks stuck. The latch is kept in the virtual
model's per-branch `state`, so continuation turns stay on one model and keep
the prompt cache.

**Status:** empty scaffold — the extension factory loads but registers
nothing yet. Implementation (virtual model + trigger arms T1–T4, then the
eval spine) comes in follow-up steps.

## Load

```bash
# one-off
pi --extension ./pi-handoff/index.ts

# or as a local package
pi install ./pi-handoff
```

## Layout

```
pi-handoff/
├── package.json   # pi manifest: "pi": { "extensions": ["./index.ts"] }
├── index.ts       # extension entry point (default-export factory)
└── README.md
```
