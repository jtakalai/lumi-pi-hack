/**
 * pi-handoff — trajectory-triggered one-way escalation (Plan C)
 *
 * Scaffold: no behavior yet.
 *
 * Planned implementation (see README.md "Plan C"):
 * - register a virtual model whose route() computes features from
 *   request.messages (turn count, repeated error, edit churn, context
 *   pressure) and latches from the cheap model to the strong model once.
 * - the latch lives in the per-branch virtual-model `state`, so
 *   continuation turns stay on one model and keep the prompt cache.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // TODO(Plan C): pi.registerVirtualModel<{ phase: "cheap" | "strong" }>(...)
}
