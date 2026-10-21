/**
 * pi-ledger — token and handoff accounting for the pi-handoff collection.
 *
 * Component D of the project plan: reproducible metrics for token
 * consumption and switching overhead. Passive observer only — it never
 * selects or changes models (that is pi-handoff's single job).
 *
 * Sources:
 *   - assistant `message_end` events: every response names its physical
 *     model and carries usage (input/output/cache-read/cache-write/cost);
 *   - `pi-handoff:boundary` events (pi-episodes / pi-handoff manual reset):
 *     episode segmentation;
 *   - `pi-handoff:state` events (pi-handoff): escalation / manual /
 *     boundary handoff events and the live phase+risk view.
 *
 * Physical-model transitions (including manual switches) are derived from
 * consecutive responses. Cost is pi's recorded `usage.cost.total`
 * (provider recorded prices; local models contribute 0).
 *
 * Tier labels: set PI_LEDGER_CHEAP / PI_LEDGER_STRONG to the same
 * "provider/model" refs pi-handoff is configured with to label models as
 * cheap/strong in reports; otherwise models are labeled "other".
 *
 * Commands:
 *   /ledger status           live totals, per model, per episode, handoffs
 *   /ledger report [PATH]    write PATH.jsonl (per-episode + workflow) and
 *                            PATH.csv (per-model aggregates)
 *
 * Accounting is in-memory for the session lifetime (fresh on
 * session_start). Session files remain the durable record; pitok can
 * recompute per-model totals from them offline.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";

import { CHANNEL, type BoundaryEvent, type HandoffStateChange } from "../../packages/shared/index.ts";
import { Ledger, type LedgerSnapshot, type TokenTotals } from "./src/account.ts";

const ENV = { cheap: "PI_LEDGER_CHEAP", strong: "PI_LEDGER_STRONG" } as const;

function makeLedger(): Ledger {
  const cheap = process.env[ENV.cheap]?.trim() || null;
  const strong = process.env[ENV.strong]?.trim() || null;
  return new Ledger(cheap, strong);
}

function tokensLine(t: TokenTotals): string {
  return (
    `in=${t.input} out=${t.output} cacheR=${t.cacheRead} cacheW=${t.cacheWrite} ` +
    `total=${t.total} cost=$${t.cost.toFixed(4)} (${t.requests} req)`
  );
}

function reportJsonl(snap: LedgerSnapshot): string {
  const lines: string[] = [];
  for (const ep of snap.episodes) {
    lines.push(
      JSON.stringify({
        level: "episode",
        episodeId: ep.episodeId,
        requests: ep.totals.requests,
        tokens: ep.totals,
        byModel: ep.byModel,
        handoffs: ep.handoffs,
        transitions: ep.transitions,
      }),
    );
  }
  lines.push(
    JSON.stringify({
      level: "workflow",
      episodes: snap.episodes.length,
      escalations: snap.escalations,
      boundaries: snap.boundaries,
      lastPhase: snap.phase,
      lastRisk: snap.risk,
      threshold: snap.threshold,
      tokens: snap.totals,
      perModel: snap.perModel,
    }),
  );
  return lines.join("\n") + "\n";
}

function reportCsv(snap: LedgerSnapshot): string {
  const rows = [
    "model,tier,episodes,requests,input,output,cacheRead,cacheWrite,totalTokens,costUSD",
  ];
  const episodesFor = (model: string): number =>
    snap.episodes.filter((ep) => ep.byModel[model] !== undefined).length;
  const models = Object.values(snap.perModel).sort((a, b) => b.total - a.total);
  for (const m of models) {
    rows.push(
      [
        `"${m.model}"`,
        m.tier,
        episodesFor(m.model),
        m.requests,
        m.input,
        m.output,
        m.cacheRead,
        m.cacheWrite,
        m.total,
        m.cost.toFixed(6),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

export default function (pi: ExtensionAPI) {
  let ledger: Ledger = makeLedger();
  let lastCtx: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    ledger = makeLedger();
  });

  // Episode segmentation (pi-episodes, or pi-handoff's standalone reset).
  pi.events.on(CHANNEL.boundary, (data) => {
    const b = data as BoundaryEvent;
    if (!b || typeof b.episodeId !== "string") return;
    ledger.onBoundary(b.episodeId, b.kind, b.reason);
  });

  // Policy events + live phase view (pi-handoff).
  pi.events.on(CHANNEL.state, (data) => {
    const c = data as HandoffStateChange;
    if (!c || typeof c !== "object" || !c.state || typeof c.state.phase !== "string") return;
    ledger.onStateChange(c.reason, c.state, c.threshold);
  });

  // Per-response usage: every assistant message names its physical model.
  pi.on("message_end", (event: MessageEndEvent) => {
    const m = event.message;
    if (m.role !== "assistant") return;
    const usage = m.usage;
    if (!usage) return;
    const model = `${m.provider}/${m.model}`;
    ledger.onResponse(model, usage);
  });

  pi.registerCommand("ledger", {
    description: "Token & handoff accounting: status | report [PATH]",
    handler: async (args, ctx) => {
      lastCtx = ctx;
      const [cmd, arg] = args.trim().split(/\s+/);

      if (cmd === "report") {
        const snap = ledger.snapshot();
        const base = resolve(ctx.cwd, arg ?? "pi-ledger-report");
        writeFileSync(base + ".jsonl", reportJsonl(snap));
        writeFileSync(base + ".csv", reportCsv(snap));
        ctx.ui.notify(
          [
            `pi-ledger: workflow: ${tokensLine(snap.totals)}`,
            `pi-ledger: escalations=${snap.escalations} boundaries=${snap.boundaries} episodes=${snap.episodes.length}`,
            `pi-ledger: wrote ${base}.jsonl (per-episode + workflow) and ${base}.csv (per-model)`,
          ].join("\n"),
          "info",
        );
        return;
      }

      // status (default)
      const snap = ledger.snapshot();
      const lines: string[] = [
        `pi-ledger — episode: ${snap.episodeId ?? "(unassigned)"} phase: ${snap.phase ?? "?"} risk: ${snap.risk}${snap.threshold !== null ? `/${snap.threshold}` : ""}`,
        `workflow:  ${tokensLine(snap.totals)}`,
        `handoffs:  escalations=${snap.escalations} boundaries=${snap.boundaries}`,
        "per model:",
      ];
      const models = Object.values(snap.perModel).sort((a, b) => b.total - a.total);
      if (models.length === 0) lines.push("  (no responses yet)");
      for (const m of models) lines.push(`  ${m.tier.padEnd(6)} ${m.model}: ${tokensLine(m)}`);
      lines.push("per episode:");
      for (const ep of snap.episodes) {
        lines.push(
          `  ${ep.episodeId ?? "(unassigned)"}: ${tokensLine(ep.totals)} ` +
            `handoffs=${ep.handoffs.length} transitions=${ep.transitions.length}`,
        );
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
