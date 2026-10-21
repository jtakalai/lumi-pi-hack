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
