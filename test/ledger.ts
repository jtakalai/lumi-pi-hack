/**
 * Deterministic tests for pi-ledger (component D).
 *
 * A: Ledger unit tests (pure accounting logic, no pi).
 * B: Full pipeline — the real extension factory on a mock pi runtime:
 *    boundary/state events on the bus + message_end responses -> status
 *    command and report files (JSONL + CSV).
 *
 * Run:  node test/ledger.ts   (or: npm test)
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ledger, addUsage, emptyTotals, tierOf, type UsageLike } from "../extensions/pi-ledger/src/account.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failures.push(name);
    console.error(`FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const u = (over: Partial<UsageLike> = {}): UsageLike => ({
  input: 100,
  output: 10,
  cacheRead: 50,
  cacheWrite: 0,
  totalTokens: 160,
  cost: { total: 0.001 },
  ...over,
});

// ---------------------------------------------------------------------------
// A. Ledger units
// ---------------------------------------------------------------------------
{
  const led = new Ledger("prov/cheap", "prov/strong");
  const fresh = led.snapshot();
  check(
    "A1 fresh ledger: one unassigned episode, zero totals",
    fresh.episodes.length === 1 &&
      fresh.episodes[0].episodeId === null &&
      fresh.totals.total === 0 &&
      fresh.totals.requests === 0 &&
      fresh.episodeId === null,
  );

  led.onResponse("prov/cheap", u());
  led.onResponse("prov/cheap", u({ input: 50, totalTokens: 110, cost: { total: 0.0005 } }));
  led.onResponse("prov/strong", u({ totalTokens: 200, cost: { total: 0.01 } }));
  let s = led.snapshot();
  check("A2 per-episode totals accumulate", s.totals.total === 160 + 110 + 200 && s.totals.requests === 3);
  check("A2b cost sums from usage.cost.total", Math.abs(s.totals.cost - 0.0115) < 1e-9, s.totals.cost);
  check(
    "A3 per-model split + tier labels",
    s.perModel["prov/cheap"]?.total === 270 &&
      s.perModel["prov/cheap"]?.tier === "cheap" &&
      s.perModel["prov/strong"]?.total === 200 &&
      s.perModel["prov/strong"]?.tier === "strong",
  );
  check(
    "A4 model switch recorded as transition",
    s.episodes[0].transitions.length === 1 &&
      s.episodes[0].transitions[0].from === "prov/cheap" &&
      s.episodes[0].transitions[0].to === "prov/strong",
  );

  // Escalation handoff event on the strong model's episode
  led.onStateChange("escalation", { phase: "STRONG_LOCKED", risk: 4, episodeId: "ep-1" }, 4);
  s = led.snapshot();
  check("A5 escalation recorded as handoff + counted", s.escalations === 1 && s.phase === "STRONG_LOCKED" && s.risk === 4 && s.threshold === 4);

  // Risk-only updates refresh the view without adding handoff events
  led.onStateChange("risk", { phase: "CHEAP", risk: 1, episodeId: "ep-1" }, 4);
  s = led.snapshot();
  check("A6 risk update does not create a handoff event", s.escalations === 1 && s.episodes[0].handoffs.length === 1);

  // Boundary: new episode, fresh counters, boundary handoff recorded
  led.onBoundary("ep-2", "command", "/episode next");
  led.onResponse("prov/cheap", u());
  s = led.snapshot();
  check(
    "A7 boundary starts new episode with fresh totals",
    s.episodes.length === 2 &&
      s.episodes[1].episodeId === "ep-2" &&
      s.episodes[1].totals.requests === 1 &&
      s.episodes[1].totals.total === 160 &&
      s.episodes[0].totals.total === 470,
  );
  check("A8 boundary handoff recorded, counted", s.boundaries === 1 && s.episodes[1].handoffs[0]?.kind === "boundary");
  check("A8b workflow totals span episodes", s.totals.total === 470 + 160 && s.totals.requests === 4);

  // Unpriced / missing usage fields degrade gracefully
  const led2 = new Ledger(null, null);
  led2.onResponse("local/model", u({ cost: undefined, totalTokens: undefined }));
  const s2 = led2.snapshot();
  check(
    "A9 missing cost/totalTokens: cost 0, total from field sum",
    s2.totals.cost === 0 && s2.totals.total === 160 && s2.perModel["local/model"]?.tier === "other",
  );

  // Pure helpers
  check("A10 tierOf is case-insensitive", tierOf("PROV/Cheap", "prov/cheap", null) === "cheap");
  const t = emptyTotals();
  addUsage(t, u());
  check("A11 addUsage fills all fields", t.input === 100 && t.output === 10 && t.cacheRead === 50 && t.total === 160 && t.requests === 1);
}

// ---------------------------------------------------------------------------
// B. Extension wiring on a mock pi runtime
// ---------------------------------------------------------------------------
{
  const envBackup = { ...process.env };
  process.env.PI_LEDGER_CHEAP = "prov/cheap-m";
  process.env.PI_LEDGER_STRONG = "prov/strong-m";

  try {
    const { default: ledgerExt } = await import("../extensions/pi-ledger/index.ts");
    const { CHANNEL } = await import("../packages/shared/index.ts");

    // --- mock pi runtime (same pattern as test/smoke.ts) ---
    const listeners = new Map<string, Array<(d: unknown) => void>>();
    const busLog: { channel: string; data: unknown }[] = [];
    const bus = {
      on(ch: string, h: (d: unknown) => void): () => void {
        listeners.set(ch, [...(listeners.get(ch) ?? []), h]);
        return () => {};
      },
      emit(ch: string, data: unknown) {
        busLog.push({ channel: ch, data });
        for (const h of listeners.get(ch) ?? []) h(data);
      },
    };
    const handlers = new Map<string, Array<(e: any, ctx: any) => any>>();
    const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
    const pi: any = {
      on: (name: string, h: any) => {
        handlers.set(name, [...(handlers.get(name) ?? []), h]);
        return () => {};
      },
      events: bus,
      registerCommand: (name: string, opts: any) => {
        commands.set(name, opts.handler);
      },
    };

    const tmp = mkdtempSync(join(tmpdir(), "pitok-ledger-"));
    const notifications: string[] = [];
    const ctx: any = {
      cwd: tmp,
      ui: { notify: (text: string) => notifications.push(text), setStatus: () => {} },
    };

    ledgerExt(pi);
    await handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);

    const assistant = (model: string, usage: UsageLike) =>
      handlers.get("message_end")?.[0]({ type: "message_end", message: { role: "assistant", provider: "prov", model, usage } }, ctx);
    const user = () => handlers.get("message_end")?.[0]({ type: "message_end", message: { role: "user", content: "hi" } }, ctx);

    // Episode 1 (unassigned): cheap model works, then "escallates"
    assistant("cheap-m", u());
    assistant("cheap-m", u());
    bus.emit(CHANNEL.state, {
      state: { phase: "STRONG_LOCKED", risk: 4, episodeId: "ep-1", escalations: 1 },
      threshold: 4,
      reason: "escalation",
    });
    assistant("strong-m", u({ totalTokens: 500, cost: { total: 0.05 } }));
    user(); // non-assistant messages are ignored

    // status command
    await commands.get("ledger")!("status", ctx);
    const status = notifications.at(-1) ?? "";
    check("B1 status shows workflow totals", status.includes("total=820") && status.includes("req)"), status);
    check("B1b status labels tiers", status.includes("cheap  prov/cheap-m") && status.includes("strong prov/strong-m"), status);
    check("B1c status counts escalation", status.includes("escalations=1"), status);

    // Boundary to ep-2, more cheap work
    bus.emit(CHANNEL.boundary, { kind: "command", episodeId: "ep-2", reason: "/episode next" });
    assistant("cheap-m", u());

    // report command -> files
    await commands.get("ledger")!("report out", ctx);
    const jsonl = readFileSync(join(tmp, "out.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const csv = readFileSync(join(tmp, "out.csv"), "utf8");

    const ep1 = jsonl.find((l: any) => l.level === "episode" && l.episodeId === null);
    const ep2 = jsonl.find((l: any) => l.level === "episode" && l.episodeId === "ep-2");
    const wf = jsonl.find((l: any) => l.level === "workflow");
    check("B2 JSONL: two episode lines + workflow line", jsonl.length === 3 && ep1 && ep2 && wf, jsonl.length);
    check("B2b episode 1 tokens (3 responses incl. strong)", ep1?.tokens.total === 160 + 160 + 500 && ep1?.requests === 3);
    check("B2c episode 1 has escalation handoff + transition", ep1?.handoffs.some((h: any) => h.kind === "escalation") && ep1?.transitions.length === 1);
    check("B2d episode 2 has boundary handoff, fresh tokens", ep2?.handoffs.some((h: any) => h.kind === "boundary") && ep2?.tokens.total === 160);
    check("B2e workflow aggregates", wf?.tokens.total === 160 * 3 + 500 && wf?.escalations === 1 && wf?.boundaries === 1 && wf?.episodes === 2);
    check(
      "B2f workflow per-model split",
      wf?.perModel["prov/cheap-m"]?.total === 160 * 3 && wf?.perModel["prov/strong-m"]?.total === 500,
    );

    const csvLines = csv.trim().split("\n");
    check("B3 CSV header", csvLines[0] === "model,tier,episodes,requests,input,output,cacheRead,cacheWrite,totalTokens,costUSD");
    check(
      "B3b CSV rows: strong first (bigger total), cheap second",
      csvLines[1]?.startsWith('"prov/strong-m",strong,') &&
        csvLines[1]?.includes(",500,") &&
        csvLines[2]?.startsWith('"prov/cheap-m",cheap,') &&
        csvLines[2]?.includes(",480,"),
      csv,
    );
    check("B3c CSV cost column", csvLines[1]?.includes("0.050000") && csvLines[2]?.includes("0.003000"), csv);

    rmSync(tmp, { recursive: true, force: true });
  } finally {
    process.env = envBackup;
  }
}

console.log(`\npi-ledger tests: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("OK: pi-ledger deterministic tests");
