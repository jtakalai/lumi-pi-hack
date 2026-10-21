/**
 * Trajectory risk observer.
 *
 * Watches tool results and emits compact risk features for the cumulative-risk
 * policy. Pure observation: it never selects or changes models.
 *
 * Detection rules (all windows reset on task-level progress and on episode
 * boundaries):
 *
 * - repeated_failure: a normalized failure signature (command + error tail,
 *   or tool + error tail) seen for the `failureRepeat`-th (default 2nd) time
 *   without intervening progress.
 * - edit_churn: the `churnEdits`-th (default 3rd) successful edit/write to the
 *   same file without intervening progress.
 * - stalled_progress: the `stallRepeats`-th (default 3rd) repetition of the
 *   same non-read-only, non-edit action without intervening progress. Edit/
 *   write repetitions are NOT counted here: for file modifications the
 *   churn signal is the dedicated one, and double-counting every 3rd edit
 *   as both would make the two features collinear.
 *
 * Progress (MVP approximation of "observable improvement in task state"):
 * a successful command execution whose normalized output CHANGED since its
 * previous success (first success = baseline, counts as progress). This
 * deliberately distinguishes successful execution from observable
 * improvement: a command that succeeds again with identical output (the
 * same test run, the same `ls`, the same build log) did not move the task
 * forward — it does not reset the windows and instead counts toward
 * stalled_progress like any repeated action. Successful edits and reads are
 * NOT progress, by design: an edit cannot be its own improvement, and
 * reading is exploration.
 *
 * Overlap is intentional for command actions: a failing command repeated
 * 3+ times fires both repeated_failure (2nd time) and stalled_progress
 * (3rd time). The policy's feature weights absorb that.
 */

import type { RiskEvent, RiskFeature } from "../../../packages/shared/index.ts";

import { errorSignature, fnv1a, normalizeCommand, outputSignature } from "./normalize.ts";

export interface TrajectoryConfig {
  /** A failure signature fires when seen this many times without progress (default 2). */
  failureRepeat: number;
  /** Edit churn fires on this many successful edits to one file without progress (default 3). */
  churnEdits: number;
  /** Stalled progress fires on this many repetitions of one action without progress (default 3). */
  stallRepeats: number;
  /** Timeline ring buffer size. */
  maxTimeline: number;
}

export const DEFAULT_TRAJECTORY_CONFIG: TrajectoryConfig = {
  failureRepeat: 2,
  churnEdits: 3,
  stallRepeats: 3,
  maxTimeline: 1000,
};

const READ_ONLY = new Set(["read", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const COMMAND_TOOLS = new Set(["bash", "powershell"]);

export interface TimelineEvent {
  t: number;
  episodeId: string | null;
  type: "failure" | "churn" | "stall" | "progress" | "boundary";
  feature?: RiskFeature;
  increment?: number;
  detail: Record<string, unknown>;
}

export function commandSignature(toolName: string, input: Record<string, unknown>): string {
  if (COMMAND_TOOLS.has(toolName)) {
    return "cmd:" + normalizeCommand(String(input.command ?? ""));
  }
  if (toolName === "edit" || toolName === "write") {
    return "edit:" + String(input.path ?? "<unknown>");
  }
  return "tool:" + toolName + ":" + fnv1a(JSON.stringify(input ?? {}));
}

export class TrajectoryObserver {
  private readonly cfg: TrajectoryConfig;
  private episodeId: string | null = null;
  private readonly failSinceProgress = new Map<string, number>();
  private readonly actionSinceProgress = new Map<string, number>();
  private readonly editsSinceProgress = new Map<string, number>();
  /** Last normalized output per command signature — the "observable state" baseline. */
  private readonly lastCommandOutput = new Map<string, string>();
  private readonly timeline: TimelineEvent[] = [];
  private totals = { failures: 0, repeatedFailures: 0, churnEdits: 0, stalls: 0, progress: 0 };

  constructor(cfg: TrajectoryConfig = DEFAULT_TRAJECTORY_CONFIG) {
    this.cfg = cfg;
  }

  get currentEpisodeId(): string | null {
    return this.episodeId;
  }

  getTotals(): Readonly<typeof this.totals> {
    return { ...this.totals };
  }

  /** Snapshot of the current per-window counters (diagnostics). */
  getWindows(): { failures: Record<string, number>; actions: Record<string, number>; edits: Record<string, number> } {
    return {
      failures: Object.fromEntries(this.failSinceProgress),
      actions: Object.fromEntries(this.actionSinceProgress),
      edits: Object.fromEntries(this.editsSinceProgress),
    };
  }

  getTimeline(): readonly TimelineEvent[] {
    return this.timeline;
  }

  /** Start a new episode window. Records a boundary marker in the timeline. */
  reset(episodeId: string | null): void {
    this.episodeId = episodeId;
    this.failSinceProgress.clear();
    this.actionSinceProgress.clear();
    this.editsSinceProgress.clear();
    this.lastCommandOutput.clear();
    this.record("boundary", { episodeId });
  }

  /**
   * Feed one completed tool result. Returns the risk events to emit
   * (zero or more), in detection order.
   */
  observe(
    toolName: string,
    input: Record<string, unknown>,
    isError: boolean,
    content: ReadonlyArray<{ type: string; text?: string }>,
  ): RiskEvent[] {
    const out: RiskEvent[] = [];
    const text = content
      .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");

    // Observable task-state improvement: a successful command whose
    // normalized output changed since its previous success. The first
    // success establishes the baseline and counts as progress (it resets
    // all windows). A success repeating the identical output is execution
    // WITHOUT observable improvement: it does not reset the windows and
    // falls through to the stalled-progress counting below, where its
    // repetition is what it looks like — an action repeating in place.
    if (!isError && COMMAND_TOOLS.has(toolName)) {
      const csig = commandSignature(toolName, input);
      const osig = outputSignature(text);
      const baseline = this.lastCommandOutput.get(csig);
      this.lastCommandOutput.set(csig, osig);
      if (baseline !== osig) {
        this.failSinceProgress.clear();
        this.actionSinceProgress.clear();
        this.editsSinceProgress.clear();
        this.totals.progress++;
        this.record("progress", { tool: toolName, signature: csig });
        return out;
      }
      // identical output: no observable improvement — keep counting below
    }

    // Repeated failure: same normalized failure signature reappearing.
    if (isError) {
      const sig = COMMAND_TOOLS.has(toolName)
        ? "fail:" + normalizeCommand(String(input.command ?? "")) + ":" + errorSignature(text)
        : "fail:" + toolName + ":" + errorSignature(text);
      const n = (this.failSinceProgress.get(sig) ?? 0) + 1;
      this.failSinceProgress.set(sig, n);
      this.totals.failures++;
      if (n >= this.cfg.failureRepeat) {
        out.push({ feature: "repeated_failure", increment: 1, detail: { signature: sig, count: n } });
        this.totals.repeatedFailures++;
        this.record("failure", { feature: "repeated_failure", signature: sig, count: n, increment: 1 });
      } else {
        this.record("failure", { signature: sig, count: n, note: "first occurrence" });
      }
    }

    // Stalled progress: same non-read-only, non-edit action repeated.
    if (!READ_ONLY.has(toolName) && !EDIT_TOOLS.has(toolName)) {
      const sig = commandSignature(toolName, input);
      const n = (this.actionSinceProgress.get(sig) ?? 0) + 1;
      this.actionSinceProgress.set(sig, n);
      if (n >= this.cfg.stallRepeats) {
        out.push({ feature: "stalled_progress", increment: 1, detail: { signature: sig, count: n } });
        this.totals.stalls++;
        this.record("stall", { feature: "stalled_progress", signature: sig, count: n, increment: 1 });
      }
    }

    // Edit churn: repeated successful modifications of one file.
    if (EDIT_TOOLS.has(toolName) && !isError) {
      const path = String(input.path ?? "<unknown>");
      const n = (this.editsSinceProgress.get(path) ?? 0) + 1;
      this.editsSinceProgress.set(path, n);
      if (n >= this.cfg.churnEdits) {
        out.push({ feature: "edit_churn", increment: 1, detail: { path, count: n } });
        this.totals.churnEdits++;
        this.record("churn", { feature: "edit_churn", path, count: n, increment: 1 });
      }
    }

    return out;
  }

  private record(type: TimelineEvent["type"], detail: Record<string, unknown>, feature?: RiskFeature, increment?: number): void {
    this.timeline.push({ t: Date.now(), episodeId: this.episodeId, type, feature, increment, detail });
    if (this.timeline.length > this.cfg.maxTimeline) {
      this.timeline.splice(0, this.timeline.length - this.cfg.maxTimeline);
    }
  }
}
