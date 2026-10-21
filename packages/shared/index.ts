/**
 * Shared contracts for the pi-handoff extension collection.
 *
 * The collection (pi-handoff, pi-trajectory, pi-episodes, pi-ledger) communicates
 * over pi's extension event bus (`pi.events`) using the channels and payloads
 * defined here. These are the "small, documented event and data contracts" the
 * project plan calls for: extensions must not each register competing model
 * routers, and only pi-handoff dispatches models.
 *
 * Everything in this module is either a type or an immutable constant, so it is
 * safe for each extension to import it independently (separate module
 * instances hold identical values).
 */

// ---------------------------------------------------------------------------
// Event bus channels
// ---------------------------------------------------------------------------

export const CHANNEL = {
  /**
   * pi-trajectory -> pi-handoff. One event per detected risk increment.
   * Payload: {@link RiskEvent}.
   */
  risk: "pi-handoff:risk",
  /**
   * pi-episodes -> pi-handoff. A valid episode boundary was reached: the
   * strong-model lock must be released and risk reset.
   * Payload: {@link BoundaryEvent}.
   */
  boundary: "pi-handoff:boundary",
  /**
   * pi-handoff -> everyone (e.g. future pi-ledger). Routing state changed:
   * risk accumulated, escalation latched, or episode boundary applied.
   * Payload: {@link HandoffStateChange}.
   */
  state: "pi-handoff:state",
} as const;

export type ChannelName = (typeof CHANNEL)[keyof typeof CHANNEL];

// ---------------------------------------------------------------------------
// Risk features (pi-trajectory)
// ---------------------------------------------------------------------------

/**
 * The three nonnegative MVP signals of the cumulative-risk policy:
 * `R_t = sum_s w^T u_s`, escalating when `R_t >= theta`.
 */
export type RiskFeature = "repeated_failure" | "edit_churn" | "stalled_progress";

export interface RiskWeights {
  repeated_failure: number;
  edit_churn: number;
  stalled_progress: number;
}

/**
 * Emitted by pi-trajectory on `CHANNEL.risk`.
 *
 * `increment` is always >= 1; pi-handoff multiplies it by the configured
 * weight of `feature` and adds it to the episode's accumulated risk.
 */
export interface RiskEvent {
  feature: RiskFeature;
  increment: number;
  detail: {
    /** Normalized signature that triggered the detection. */
    signature?: string;
    /** File path, for edit churn. */
    path?: string;
    /** Occurrence count that crossed the detection threshold. */
    count?: number;
    /** Human-readable note for diagnostics. */
    note?: string;
  };
}

// ---------------------------------------------------------------------------
// Episode boundaries (pi-episodes)
// ---------------------------------------------------------------------------

export type BoundaryKind = "marker" | "command" | "user_turn";

/**
 * Emitted by pi-episodes on `CHANNEL.boundary`.
 *
 * `episodeId` is the id of the episode that starts at this boundary
 * (pi-episodes issues canonical `ep-<n>` ids; pi-handoff's standalone
 * `/handoff reset` issues `manual-<n>` ids when pi-episodes is not loaded).
 */
export interface BoundaryEvent {
  kind: BoundaryKind;
  episodeId: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Persisted episode state (pi-episodes -> everyone)
// ---------------------------------------------------------------------------

/**
 * Custom session entry type on which pi-episodes persists the current
 * episode of a session branch.
 *
 * This entry is the AUTHORITATIVE record of which episode a branch is in.
 * The `CHANNEL.boundary` bus event is only a notification mechanism: it is
 * per-process and can be missed (process reload, boundary recorded before
 * the next model request, branch navigation). Extensions must be able to
 * derive boundary state from these entries alone.
 */
export const EPISODES_STATE_ENTRY = "pi-episodes:state";

/**
 * pi's custom entry type for virtual-model router state (mirrors
 * `VIRTUAL_MODEL_STATE_ENTRY` from @earendil-works/pi-coding-agent; the
 * collection cannot value-import pi at runtime, so the string is kept here
 * and must be kept in sync when pi changes it).
 */
export const VIRTUAL_MODEL_STATE_ENTRY = "pi.virtual-model-state";

/** Data of an `pi-episodes:state` custom session entry. */
export interface EpisodesStateData {
  /** Monotonic episode counter on this branch (1-based; ep-1 has no entry). */
  counter: number;
  /** Canonical episode id (`ep-<counter>`). */
  episodeId: string;
  /** Boundary kind that started the episode. */
  kind?: BoundaryKind;
  /** Human-readable reason (diagnostics). */
  reason?: string;
  /** ISO timestamp of the boundary. */
  t?: string;
}

/** Structural subset of pi's SessionEntry, so test fakes work. */
export interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

/**
 * The latest persisted episode state on a branch, or null when the branch
 * has no entry (a fresh session starts in episode 1 without an entry).
 * Scans newest-first, skipping malformed entries.
 */
export function latestEpisodeState(branch: readonly SessionEntryLike[]): EpisodesStateData | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e?.type !== "custom" || e.customType !== EPISODES_STATE_ENTRY) continue;
    const d = e.data as EpisodesStateData | undefined;
    if (d && typeof d.counter === "number" && typeof d.episodeId === "string") {
      return d;
    }
  }
  return null;
}

/**
 * The branch's authoritative episode position, for boundary reconciliation.
 *
 * Combines the latest `pi-episodes:state` entry with the position of the
 * latest router-state entry (`virtualModelStateEntry`, e.g. pi's
 * `pi.virtual-model-state` for this virtual model). Entry order on the
 * branch is what makes "did this boundary happen before or after the last
 * persisted routing state?" answerable from the branch alone.
 */
export interface BranchEpisodeAuthority {
  /** Latest persisted episode on the branch (null when none). */
  episode: EpisodesStateData | null;
  /**
   * True when a router-state entry for (provider, modelId) sits AFTER the
   * latest episode entry on the branch — i.e. the last persisted routing
   * state postdates the last recorded boundary. Undefined when the branch
   * has no router-state entry for that virtual model.
   */
  routerStateAfterLatestEpisode?: boolean;
}

export function branchEpisodeAuthority(
  branch: readonly SessionEntryLike[],
  virtualModelStateEntry: string,
  provider: string,
  modelId: string,
): BranchEpisodeAuthority {
  let epIdx = -1;
  let vmIdx = -1;
  let episode: EpisodesStateData | null = null;
  for (let i = 0; i < branch.length; i++) {
    const e = branch[i];
    if (e?.type !== "custom") continue;
    if (e.customType === EPISODES_STATE_ENTRY) {
      const d = e.data as EpisodesStateData | undefined;
      if (d && typeof d.counter === "number" && typeof d.episodeId === "string") {
        epIdx = i;
        episode = d;
      }
    } else if (e.customType === virtualModelStateEntry) {
      const d = e.data as { provider?: string; modelId?: string } | undefined;
      if (d?.provider === provider && d?.modelId === modelId) vmIdx = i;
    }
  }
  const out: BranchEpisodeAuthority = { episode };
  if (vmIdx !== -1 && epIdx !== -1) out.routerStateAfterLatestEpisode = vmIdx > epIdx;
  return out;
}

// ---------------------------------------------------------------------------
// Handoff state (pi-handoff)
// ---------------------------------------------------------------------------

/** Episode execution states. No downgrade within an unfinished episode. */
export type EpisodePhase = "CHEAP" | "STRONG_LOCKED";

/**
 * The episode-level state machine state. pi-handoff stores this as the
 * virtual model's router state, which pi persists on the session branch
 * (survives compaction, follows the session tree).
 */
export interface HandoffState {
  phase: EpisodePhase;
  /** Accumulated weighted risk since the last episode boundary (>= 0, monotonic). */
  risk: number;
  /** Episode this state belongs to, if known. */
  episodeId: string | null;
  /** Total escalations so far in this session/workflow (metric: transitions). */
  escalations: number;
  /** Risk at which the most recent escalation latched. */
  lastEscalatedAtRisk?: number;
  lastEscalatedAt?: string;
}

/**
 * Emitted by pi-handoff on `CHANNEL.state` whenever the routing state
 * changes. `reason` is one of "risk", "escalation", "boundary", "init".
 */
export interface HandoffStateChange {
  state: HandoffState;
  /** Threshold in effect (documented for consumers that do not know config). */
  threshold: number;
  reason: "risk" | "escalation" | "boundary" | "init" | "manual";
}

// ---------------------------------------------------------------------------
// Model references
// ---------------------------------------------------------------------------

export interface ModelRef {
  provider: string;
  id: string;
}

/**
 * Parse `"provider/model-id"`. Splits on the FIRST slash so model ids that
 * contain slashes (e.g. openrouter-style `openrouter/anthropic/claude-...`)
 * keep their remainder as the id. Same convention pi-model-router uses.
 */
export function parseModelRef(ref: string): ModelRef {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    throw new Error(`Invalid model ref "${ref}"; expected "provider/model-id"`);
  }
  return { provider: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

export function formatModelRef(m: ModelRef): string {
  return `${m.provider}/${m.id}`;
}
