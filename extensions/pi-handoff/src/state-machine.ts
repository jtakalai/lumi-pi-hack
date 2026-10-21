/**
 * The episode-level state machine of the cumulative-risk policy.
 *
 *   r_t  = w^T u_t          (nonnegative feature increments)
 *   R_t  = R_{t-1} + r_t    (monotonic within an episode)
 *   escalate when R_t >= θ  (one-way latch: STRONG_LOCKED)
 *
 * At a valid episode boundary: risk resets to 0, the strong-model lock is
 * released, execution returns to CHEAP. There is no automatic downgrade
 * within an unfinished episode.
 *
 * Pure functions — the pi-handoff extension wires these to the virtual
 * model's router state and the event bus; the lab harness drives them
 * directly in deterministic tests.
 */

import type { HandoffState, RiskEvent, RiskWeights } from "../../../packages/shared/index.ts";

export function initialHandoffState(episodeId: string | null): HandoffState {
  return { phase: "CHEAP", risk: 0, episodeId, escalations: 0 };
}

export interface RiskOutcome {
  /** Same reference as the input when nothing changed (identity is the persistence signal). */
  state: HandoffState;
  /** True when this batch latched the strong model. */
  escalated: boolean;
  /** Weighted risk added by this batch (>= 0). */
  added: number;
}

/**
 * Fold a batch of risk events into the state. Escalation is one-way within
 * the episode: once STRONG_LOCKED, further risk is recorded but changes
 * nothing (the strong model keeps the rest of the episode).
 */
export function applyRisk(
  state: HandoffState,
  events: readonly RiskEvent[],
  weights: RiskWeights,
  threshold: number,
): RiskOutcome {
  if (events.length === 0) return { state, escalated: false, added: 0 };
  const added = events.reduce(
    (sum, e) => sum + (weights[e.feature] ?? 0) * (e.increment > 0 ? e.increment : 0),
    0,
  );
  if (added <= 0) return { state, escalated: false, added: 0 };
  const risk = state.risk + added;
  if (state.phase === "CHEAP" && risk >= threshold) {
    return {
      state: {
        ...state,
        phase: "STRONG_LOCKED",
        risk,
        escalations: state.escalations + 1,
        lastEscalatedAtRisk: risk,
        lastEscalatedAt: new Date().toISOString(),
      },
      escalated: true,
      added,
    };
  }
  return { state: { ...state, risk }, escalated: false, added };
}

/**
 * Apply an episode boundary: release the strong-model lock and reset risk.
 * The cumulative escalation count is kept (workflow-level metric).
 */
export function applyBoundary(state: HandoffState | null | undefined, episodeId: string): HandoffState {
  return { phase: "CHEAP", risk: 0, episodeId, escalations: state?.escalations ?? 0 };
}
