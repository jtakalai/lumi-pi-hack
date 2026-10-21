/**
 * pi-handoff — core router of the pi-handoff extension collection.
 *
 * Registers one selectable virtual model, `handoff/auto`, that starts each
 * episode on a cheap model and — when accumulated trajectory risk (from
 * pi-trajectory, via the event bus) crosses a threshold — latches ONCE to a
 * strong model for the remainder of the episode. At a valid episode boundary
 * the lock is released, risk is reset, and the next episode starts on cheap.
 * Boundaries arrive two ways: the fast path is the `pi-handoff:boundary`
 * bus event (pi-episodes); the authoritative path is the branch's persisted
 * `pi-episodes:state` entry, reconciled on every model request, so a
 * boundary recorded without an observed event (reload, recorded before the
 * next request, branch change) still releases the lock. No downgrade within
 * an unfinished episode; full-context handoff (no summarization or
 * transcript rewriting).
 *
 * This is the only extension in the collection that dispatches models.
 *
 * The state machine state is the virtual model's router state: pi persists
 * it on the session branch (per branch, survives compaction) and passes it
 * back as `request.state`. Between model requests, risk events and boundary
 * events are held in memory and folded in at the next `route()` call.
 *
 * Config: see src/config.ts (flag > env > handoff.config.json).
 *
 * Commands:
 *   /handoff status   phase, risk vs θ, episode, escalation count
 *   /handoff config   resolved configuration
 *   /handoff reset    standalone manual boundary (issues a `manual-<n>`
 *                     episode; use pi-episodes' /episode for canonical ids)
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRoute,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

import {
  CHANNEL,
  VIRTUAL_MODEL_STATE_ENTRY,
  branchEpisodeAuthority,
  formatModelRef,
  type BoundaryEvent,
  type HandoffState,
  type HandoffStateChange,
  type RiskEvent,
} from "../../packages/shared/index.ts";
import { FLAG, resolveConfig, type HandoffConfig, type ResolvedConfig } from "./src/config.ts";
import { applyBoundary, applyRisk, initialHandoffState, reconcileEpisode } from "./src/state-machine.ts";

const PROVIDER = "handoff";
const ID = "auto";

export default function (pi: ExtensionAPI) {
  pi.registerFlag(FLAG.cheap, { description: "pi-handoff: cheap model as provider/model-id", type: "string" });
  pi.registerFlag(FLAG.strong, { description: "pi-handoff: strong model as provider/model-id", type: "string" });
  pi.registerFlag(FLAG.threshold, { description: "pi-handoff: escalation risk threshold (number >= 1)", type: "string" });

  let cfgCache: ResolvedConfig | undefined;
  // Only successful resolutions are sticky; failures re-resolve on the next
  // request, so a config file fixed mid-session is picked up without a reload.
  const loadConfig = (): ResolvedConfig => {
    if (cfgCache?.config) return cfgCache;
    return (cfgCache = resolveConfig({ flag: (n) => pi.getFlag(n), env: process.env }));
  };

  // Working state between model requests. `current` mirrors what the next
  // route() will persist; pending* hold events that arrived since then.
  let current: HandoffState = initialHandoffState(null);
  let pendingBoundary: string | null = null;
  const pendingRisk: RiskEvent[] = [];
  let lastCtx: ExtensionContext | undefined;
  let configWarned = false;

  const notify = (text: string, level: "info" | "warning" | "error" = "info"): void => {
    try {
      lastCtx?.ui.notify(text, level);
    } catch {
      // stale context after session replacement — cosmetic only
    }
  };

  /**
   * The branch's authoritative episode position (latest `pi-episodes:state`
   * entry + position of the latest `pi.virtual-model-state` entry for this
   * virtual model). Best-effort: if it can't be read, in-process bus events
   * are the only source (no worse than before).
   */
  const readAuthority = (ctx: ExtensionContext) => {
    try {
      return branchEpisodeAuthority(ctx.sessionManager.getBranch(), VIRTUAL_MODEL_STATE_ENTRY, PROVIDER, ID);
    } catch {
      return null;
    }
  };

  const statusLine = (): void => {
    try {
      const theta = loadConfig().config?.threshold;
      lastCtx?.ui.setStatus?.(
        "handoff",
        `handoff: ${current.phase} r=${current.risk}${theta ? `/${theta}` : ""} ${current.episodeId ?? ""}`.trim(),
      );
    } catch {
      // ignore
    }
  };

  const emitState = (reason: HandoffStateChange["reason"]): void => {
    const change: HandoffStateChange = {
      state: { ...current },
      threshold: loadConfig().config?.threshold ?? 0,
      reason,
    };
    pi.events.emit(CHANNEL.state, change);
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    current = initialHandoffState(null);
    pendingBoundary = null;
    pendingRisk.length = 0;
    configWarned = false;
    cfgCache = undefined; // allow env/flag/config changes between sessions
  });

  // Branch/tree navigation: the in-memory working state belongs to the old
  // branch. Drop it so it can't leak into a branch that has no persisted
  // router state of its own; the next route() restores the target branch's
  // state from the session (request.state) and reconciles against its
  // episode record.
  pi.on("session_tree", (_event, ctx) => {
    lastCtx = ctx;
    current = initialHandoffState(null);
    pendingBoundary = null;
    pendingRisk.length = 0;
    statusLine();
  });

  // Risk features from pi-trajectory (or a future pi-trajectory alternative).
  pi.events.on(CHANNEL.risk, (data) => {
    const e = data as RiskEvent;
    if (e && typeof e === "object" && e.increment > 0) pendingRisk.push(e);
  });

  // Episode boundaries from pi-episodes (or our own /handoff reset).
  pi.events.on(CHANNEL.boundary, (data) => {
    const b = data as BoundaryEvent;
    if (!b || typeof b.episodeId !== "string") return;
    pendingBoundary = b.episodeId;
    current = applyBoundary(current, b.episodeId);
    emitState("boundary");
    notify(`pi-handoff: episode ${b.episodeId} started — strong-model lock released, risk reset`);
    statusLine();
  });

  pi.registerVirtualModel<HandoffState>({
    provider: PROVIDER,
    id: ID,
    name: "Handoff (cheap→strong, one-way per episode)",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh"],
    route(request: ModelRouteRequest<HandoffState>, ctx: ExtensionContext): ModelRoute<HandoffState> {
      const { config, errors } = loadConfig();
      if (!config) {
        if (!configWarned) {
          configWarned = true;
          ctx.ui.notify(errors.join("\n"), "error");
        }
        throw new Error(`pi-handoff: unconfigured — ${errors[0]}`);
      }

      // Retries keep the physical model that failed, so prompt-cache and
      // thinking signatures stay valid.
      if (request.reason === "retry" && request.failed) {
        return { model: request.failed.model, thinkingLevel: request.failed.thinkingLevel ?? request.thinkingLevel };
      }

      // Branch-persisted state wins (source of truth across reloads and
      // forks); direct requests carry no state and use the working state.
      let state: HandoffState = request.state ?? current;

      // The branch's persisted episode record is authoritative over
      // in-process bus state. If a boundary was recorded without this
      // process observing the event (reload, boundary recorded before the
      // next model request, branch navigation), release from entries alone.
      const rec = reconcileEpisode(state, readAuthority(ctx));
      state = rec.state; // same reference unless the episode id was adopted or a boundary applied
      if (rec.boundary) {
        current = state;
        emitState("boundary");
        notify(
          `pi-handoff: branch is on episode ${state.episodeId} — releasing strong-model lock from persisted episode state (boundary event not observed this process)`,
        );
        statusLine();
      }

      if (pendingBoundary !== null) {
        state = applyBoundary(state, pendingBoundary);
        pendingBoundary = null;
      }
      if (pendingRisk.length > 0) {
        const events = pendingRisk.splice(0, pendingRisk.length);
        const { state: next, escalated, added } = applyRisk(state, events, config.weights, config.threshold);
        if (added > 0) {
          state = next;
          current = state;
          if (escalated) {
            emitState("escalation");
            notify(
              `pi-handoff: R=${state.risk} >= theta=${config.threshold} — escalating to strong ${formatModelRef(config.strong)} for the rest of episode ${state.episodeId ?? "?"} (one-way until the next boundary)`,
              "warning",
            );
          } else {
            emitState("risk");
          }
        }
      }
      current = state;

      const ref = state.phase === "CHEAP" ? config.cheap : config.strong;
      const model = ctx.modelRegistry.find(ref.provider, ref.id);
      if (!model) {
        throw new Error(`pi-handoff: model ${formatModelRef(ref)} not found in the catalog — check the provider, model id, and credentials`);
      }
      const thinkingLevel =
        (state.phase === "CHEAP" ? config.cheapThinking : config.strongThinking) ?? request.thinkingLevel;

      // Persist new state only when it actually changed (identity check).
      return { model, thinkingLevel: thinkingLevel as ModelRoute<HandoffState>["thinkingLevel"], state: state !== request.state ? state : request.state };
    },
  });

  pi.registerCommand("handoff", {
    description: "pi-handoff router control: status | config | reset",
    handler: async (args, ctx) => {
      lastCtx = ctx;
      const [cmd] = args.trim().split(/\s+/);

      if (cmd === "reset" || cmd === "next") {
        const id = `manual-${Date.now().toString(36)}`;
        pendingBoundary = id;
        current = applyBoundary(current, id);
        emitState("manual");
        statusLine();
        ctx.ui.notify(`pi-handoff: manual boundary — new episode ${id}, strong-model lock released, risk reset`, "info");
        return;
      }
      if (cmd === "config") {
        const { config, errors } = loadConfig();
        if (!config) {
          ctx.ui.notify(errors.join("\n"), "error");
          return;
        }
        ctx.ui.notify(
          [
            `cheap:   ${formatModelRef(config.cheap)}${config.cheapThinking ? ` (thinking: ${config.cheapThinking})` : ""}`,
            `strong:  ${formatModelRef(config.strong)}${config.strongThinking ? ` (thinking: ${config.strongThinking})` : ""}`,
            `theta:   ${config.threshold}`,
            `weights: repeated_failure=${config.weights.repeated_failure} edit_churn=${config.weights.edit_churn} stalled_progress=${config.weights.stalled_progress}`,
          ].join("\n"),
          "info",
        );
        return;
      }
      // status (default)
      const theta = cfgCache?.config?.threshold;
      ctx.ui.notify(
        [
          `virtual model: ${PROVIDER}/${ID}`,
          `phase:     ${current.phase}`,
          `risk:      ${current.risk}${theta !== undefined ? ` / ${theta}` : " (unconfigured)"}`,
          `episode:   ${current.episodeId ?? "(none)"}`,
          `escalations: ${current.escalations}${current.lastEscalatedAtRisk !== undefined ? ` (last at R=${current.lastEscalatedAtRisk}, ${current.lastEscalatedAt})` : ""}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
