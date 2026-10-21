/**
 * pi-trajectory — execution signal observer for the pi-handoff collection.
 *
 * Collects reusable trajectory diagnostics (repeated failures, edit churn,
 * stalled progress) from tool events, without invoking another LLM and
 * without selecting or changing any model. Detects are emitted on the shared
 * `pi-handoff:risk` event-bus channel for pi-handoff to accumulate.
 *
 * The per-episode observation windows reset on `pi-handoff:boundary` events
 * (pi-episodes) so risk is monotonic within an episode, as the policy
 * requires.
 *
 * Commands:
 *   /trajectory status            current episode windows, totals, recent timeline
 *   /trajectory export [PATH]     write the full timeline as JSONL (default: ./pi-trajectory.jsonl)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";

import { CHANNEL, type BoundaryEvent } from "../../packages/shared/index.ts";
import { DEFAULT_TRAJECTORY_CONFIG, TrajectoryObserver, type TrajectoryConfig } from "./src/observer.ts";

function resolveConfig(): TrajectoryConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : d;
  };
  return {
    failureRepeat: num(process.env.PI_TRAJECTORY_FAILURE_REPEAT, DEFAULT_TRAJECTORY_CONFIG.failureRepeat),
    churnEdits: num(process.env.PI_TRAJECTORY_CHURN_EDITS, DEFAULT_TRAJECTORY_CONFIG.churnEdits),
    stallRepeats: num(process.env.PI_TRAJECTORY_STALL_REPEATS, DEFAULT_TRAJECTORY_CONFIG.stallRepeats),
    maxTimeline: DEFAULT_TRAJECTORY_CONFIG.maxTimeline,
  };
}

export default function (pi: ExtensionAPI) {
  const observer = new TrajectoryObserver(resolveConfig());

  pi.on("session_start", (_event, _ctx) => {
    observer.reset(null);
  });

  // Episode boundaries (from pi-episodes, or pi-handoff's standalone reset):
  // start a fresh observation window.
  pi.events.on(CHANNEL.boundary, (data) => {
    const b = data as BoundaryEvent;
    observer.reset(b.episodeId);
  });

  pi.on("tool_result", (event: ToolResultEvent, _ctx) => {
    const events = observer.observe(event.toolName, event.input, event.isError, event.content);
    for (const e of events) {
      pi.events.emit(CHANNEL.risk, e);
    }
  });

  pi.registerCommand("trajectory", {
    description: "Trajectory risk diagnostics: status | export [PATH]",
    handler: async (args, ctx) => {
      const [cmd, arg] = args.trim().split(/\s+/);
      if (cmd === "export") {
        const path = resolve(ctx.cwd, arg ?? "pi-trajectory.jsonl");
        const lines = observer
          .getTimeline()
          .map((e) => JSON.stringify(pick(e)))
          .join("\n");
        writeFileSync(path, lines.length > 0 ? lines + "\n" : "");
        ctx.ui.notify(`pi-trajectory: wrote ${observer.getTimeline().length} timeline events to ${path}`, "info");
        return;
      }
      // status (default)
      const totals = observer.getTotals();
      const windows = observer.getWindows();
      const recent = observer.getTimeline().slice(-20);
      const lines: string[] = [
        `pi-trajectory — episode: ${observer.currentEpisodeId ?? "(unassigned)"}`,
        `totals: failures=${totals.failures} repeated=${totals.repeatedFailures} churn=${totals.churnEdits} stalls=${totals.stalls} progress=${totals.progress}`,
        `windows — failures: ${fmtCounts(windows.failures)}`,
        `windows — actions: ${fmtCounts(windows.actions)}`,
        `windows — edits:   ${fmtCounts(windows.edits)}`,
        "recent timeline:",
        ...recent.map((e) => `  ${new Date(e.t).toISOString()} [${e.episodeId ?? "-"}] ${e.type}${e.feature ? `:${e.feature}` : ""} ${JSON.stringify(e.detail)}`),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function pick(e: { t: number; episodeId: string | null; type: string; feature?: string; increment?: number; detail: Record<string, unknown> }) {
  return { t: e.t, episodeId: e.episodeId, type: e.type, feature: e.feature, increment: e.increment, detail: e.detail };
}

function fmtCounts(m: Record<string, number>): string {
  const entries = Object.entries(m);
  if (entries.length === 0) return "(empty)";
  return entries.map(([k, n]) => `${k.slice(0, 48)} x${n}`).join(", ");
}
