/**
 * pi-episodes — workflow boundary controller for the pi-handoff collection.
 *
 * Defines and signals episode boundaries independently from the routing
 * algorithm. Boundaries are the only place where the strong-model lock is
 * released and accumulated risk is reset.
 *
 * Boundary mechanisms, in priority order (project plan §3.3):
 *   1. Explicit workflow/benchmark step-completion markers:
 *        a user message that is exactly  [episode:next]   (also :new, :done)
 *        is consumed without triggering an agent run (input "handled"), and
 *        a marker at the start of a longer message fires the boundary while
 *        the message itself is still delivered.
 *   2. User-issued commands: /episode next, /episode reset.
 *   3. Documented conversational default: an agent run that has settled
 *      followed by a new user task. Toggle with PI_EPISODES_USER_TURN=0.
 *
 * The MVP uses deterministic, explicit boundaries only — no automatic
 * semantic subtask segmentation (explicitly out of scope).
 *
 * Episode ids are `ep-<n>`: a session starts in episode ep-1 (no boundary
 * event for it); every boundary starts the next episode. The counter is
 * persisted as a `pi-episodes:state` custom session entry, so it survives
 * reloads and resume.
 *
 * Commands:
 *   /episode next     end the current episode, start the next one
 *   /episode reset    alias for next (manual boundary)
 *   /episode status   current episode, boundary counts, policy
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { CHANNEL, type BoundaryEvent, type BoundaryKind } from "../../packages/shared/index.ts";

export const ENTRY_TYPE = "pi-episodes:state";
export const DEFAULT_MARKER = /^\s*\[episode\s*:\s*(next|new|done)\s*\]/;
/** A message that is exactly a marker (no task text) — consumed, no agent run. */
export const STANDALONE_MARKER = /^\s*\[episode\s*:\s*(next|new|done)\s*\]\s*$/;

interface Persisted {
  counter: number;
  episodeId: string;
  kind?: BoundaryKind;
  reason?: string;
  t?: string;
}

export function nextEpisodeId(counter: number): string {
  return `ep-${counter}`;
}

export default function (pi: ExtensionAPI) {
  let counter = 1;
  let episodeId = "ep-1";
  let awaitingNewTask = false;
  let lastCtx: ExtensionContext | undefined;
  const counts: Record<BoundaryKind, number> = { marker: 0, command: 0, user_turn: 0 };
  const userTurnPolicy = process.env.PI_EPISODES_USER_TURN !== "0";
  const markerRe = compileMarker(process.env.PI_EPISODES_MARKER);

  function current(): string {
    return episodeId;
  }

  function statusLine(): string {
    return `episodes: ${episodeId} (boundaries: marker=${counts.marker} command=${counts.command} user_turn=${counts.user_turn}${userTurnPolicy ? "" : ", user_turn policy OFF"})`;
  }

  function setStatus(): void {
    try {
      lastCtx?.ui.setStatus?.("episodes", `${episodeId}`);
    } catch {
      // stale context after session replacement — the next event refreshes it
    }
  }

  /** Start a new episode: persist, emit, refresh status. */
  function advance(kind: BoundaryKind, reason?: string): void {
    counter += 1;
    episodeId = nextEpisodeId(counter);
    counts[kind] += 1;
    const data: Persisted = { counter, episodeId, kind, reason, t: new Date().toISOString() };
    try {
      pi.appendEntry(ENTRY_TYPE, data);
    } catch {
      // persistence is best-effort; the in-process counter is authoritative
    }
    const event: BoundaryEvent = { kind, episodeId, reason };
    pi.events.emit(CHANNEL.boundary, event);
    setStatus();
  }

  pi.on("session_start", (event, ctx) => {
    lastCtx = ctx;
    awaitingNewTask = false;
    if (event.reason === "resume" || event.reason === "reload") {
      // Restore the episode counter from the latest persisted entry on the branch.
      const branch = ctx.sessionManager.getBranch();
      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data) {
          const d = entry.data as Persisted;
          if (typeof d.counter === "number" && typeof d.episodeId === "string") {
            counter = d.counter;
            episodeId = d.episodeId;
          }
          break;
        }
      }
    }
    setStatus();
  });

  // Mechanism 1 (explicit marker): a message that is exactly a marker is
  // consumed here without starting an agent run.
  pi.on("input", (event) => {
    if (STANDALONE_MARKER.test(event.text)) {
      advance("marker", "standalone marker message");
      return { action: "handled" as const };
    }
  });

  // Mechanism 1 (marker inside a longer message) + mechanism 3 (user-turn
  // default policy). before_agent_start only fires when a run actually starts.
  pi.on("before_agent_start", (event, ctx) => {
    lastCtx = ctx;
    if (event.messageType !== "user") return;
    if (markerRe.test(event.prompt)) {
      advance("marker", "marker in prompt");
      return;
    }
    if (userTurnPolicy && awaitingNewTask) {
      advance("user_turn", "new user task after settled run");
    }
    awaitingNewTask = false;
  });

  pi.on("agent_settled", () => {
    awaitingNewTask = true;
  });

  // Mechanism 2: manual commands.
  pi.registerCommand("episode", {
    description: "Episode boundary control: next | reset | status",
    handler: async (args, ctx) => {
      const [cmd] = args.trim().split(/\s+/);
      if (cmd === "next" || cmd === "reset") {
        advance("command", `/episode ${cmd}`);
        ctx.ui.notify(`pi-episodes: new episode ${current()} (pi-handoff releases the strong-model lock here)`, "info");
        return;
      }
      ctx.ui.notify(statusLine(), "info");
    },
  });
}

function compileMarker(envRe: string | undefined): RegExp {
  if (!envRe) return DEFAULT_MARKER;
  try {
    return new RegExp(envRe);
  } catch {
    return DEFAULT_MARKER;
  }
}
