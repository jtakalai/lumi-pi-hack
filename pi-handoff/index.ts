/**
 * pi-handoff — trajectory-triggered one-way escalation
 *
 * Implements a virtual model that starts with a cheap model and permanently
 * escalates to a strong model when accumulated execution risk crosses a threshold.
 */

import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

interface TrajectoryState {
	phase: "cheap" | "strong";
	/** Cumulative risk score */
	risk: number;
	/** Signal values from the current episode */
	signals: TrajectorySignals;
}

interface TrajectorySignals {
	/** Repeated failure count (normalized) */
	repeatedFailure: number;
	/** Edit churn count (repeated edits to same file without progress) */
	editChurn: number;
	/** Stalled progress count */
	stalledProgress: number;
}

interface RiskConfig {
	/** Threshold for escalation */
	threshold: number;
	/**Weights for each signal */
	weights: {
		repeatedFailure: number;
		editChurn: number;
		stalledProgress: number;
	};
}

const DEFAULT_RISK_CONFIG: RiskConfig = {
	threshold: 1.0,
	weights: {
		repeatedFailure: 0.4,
		editChurn: 0.3,
		stalledProgress: 0.3,
	},
};

// Configuration is set via environment variables or defaults
const RISK_CONFIG: RiskConfig = {
	threshold: parseFloat(process.env.PI_HANDOFF_THRESHOLD || "") || DEFAULT_RISK_CONFIG.threshold,
	weights: {
		repeatedFailure: parseFloat(process.env.PI_HANDOFF_WEIGHT_FAILURE || "") || DEFAULT_RISK_CONFIG.weights.repeatedFailure,
		editChurn: parseFloat(process.env.PI_HANDOFF_WEIGHT_CHURN || "") || DEFAULT_RISK_CONFIG.weights.editChurn,
		stalledProgress: parseFloat(process.env.PI_HANDOFF_WEIGHT_STALLED || "") || DEFAULT_RISK_CONFIG.weights.stalledProgress,
	},
};

export default function (pi: ExtensionAPI) {
	// Register the virtual model
	pi.registerVirtualModel<TrajectoryState>({
		provider: "handoff",
		id: "auto",
		name: "Trajectory Handoff",
		thinkingLevels: ["low", "medium", "high"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		async route(request, ctx) {
			// Direct requests (outside agent loop) go to strong model
			if (request.reason === "direct") {
				return routeTo(request, ctx, "strong");
			}

			const state = request.state;

			// First request - start on cheap model
			if (!state) {
				return routeTo(request, ctx, "cheap", { phase: "cheap", risk: 0, signals: initialSignals() });
			}

			// Already on strong model - stay there
			if (state.phase === "strong") {
				return routeTo(request, ctx, "strong", state);
			}

			// In cheap phase - compute risk and check if we should escalate
			const signals = computeSignals(request, ctx);
			const newRisk = state.risk + computeRiskScore(signals);

			// Escalate if threshold crossed
			if (newRisk >= RISK_CONFIG.threshold) {
				return routeTo(request, ctx, "strong", {
					phase: "strong",
					risk: newRisk,
					signals,
				});
			}

			// Stay on cheap
			return routeTo(request, ctx, "cheap", {
				phase: "cheap",
				risk: newRisk,
				signals,
			});
		},
	});
}

function initialSignals(): TrajectorySignals {
	return {
		repeatedFailure: 0,
		editChurn: 0,
		stalledProgress: 0,
	};
}

/**
 * Compute trajectory risk features from the conversation history.
 */
function computeSignals(request: ModelRouteRequest<TrajectoryState>, ctx: ExtensionContext): TrajectorySignals {
	const signals = initialSignals();

	// Extract messages from the request
	const messages = request.messages || [];

	// Analyze recent messages for repeated failures
	signals.repeatedFailure = countRepeatedFailures(messages);

	// Analyze for edit churn (repeated edits to same file)
	signals.editChurn = countEditChurn(messages);

	// Analyze for stalled progress
	signals.stalledProgress = countStalledProgress(messages, request.reason);

	return signals;
}

/**
 * Count repeated failures: same error pattern appearing multiple times without progress.
 */
function countRepeatedFailures(messages: readonly unknown[]): number {
	if (!Array.isArray(messages)) return 0;

	let failureCount = 0;
	let lastFailureContext: string | null = null;
	let consecutiveFailures = 0;

	for (const msg of messages) {
		if (isToolResult(msg) && msg.isError) {
			// Normalize the error message to detect repeated failures
			const context = normalizeErrorContext(msg);
			if (context === lastFailureContext) {
				consecutiveFailures++;
			} else {
				consecutiveFailures = 1;
			}
			lastFailureContext = context;
			failureCount += consecutiveFailures * 0.1; // Small increment for each repeated failure
		} else if (isMessage(msg) && msg.role === "user") {
			// Reset on user message
			lastFailureContext = null;
			consecutiveFailures = 0;
		}
	}

	return Math.min(failureCount, 1.0); // Clamp to [0, 1]
}

/**
 * Count edit churn: repeated edits to the same file without measurable improvement.
 */
function countEditChurn(messages: readonly unknown[]): number {
	if (!Array.isArray(messages)) return 0;

	const fileEdits = new Map<string, number>();

	for (const msg of messages) {
		if (isToolResult(msg) && !msg.isError) {
			if (isFileTool(msg.toolName)) {
				const file = extractFileName(msg);
				if (file) {
					fileEdits.set(file, (fileEdits.get(file) || 0) + 1);
				}
			}
		} else if (isMessage(msg) && msg.role === "user") {
			fileEdits.clear(); // Reset on user message
		}
	}

	// Count churn: files edited more than twice
	let churn = 0;
	for (const count of fileEdits.values()) {
		if (count > 2) {
			churn += (count - 2) * 0.15; // Increment for each extra edit
		}
	}

	return Math.min(churn, 1.0); // Clamp to [0, 1]
}

/**
 * Count stalled progress: repeated actions without observable progress.
 */
function countStalledProgress(messages: readonly unknown[], reason: string): number {
	if (!Array.isArray(messages)) return 0;

	// If this is a continuation or retry, check if there was recent inactivity
	if (reason === "continuation" || reason === "retry") {
		// Look for multiple tool calls/tool results without user interaction
		let toolActivity = 0;
		for (const msg of messages.slice(-5)) {
			if (isToolCall(msg) || isToolResult(msg)) {
				toolActivity++;
			}
		}
		if (toolActivity >= 3) {
			return 0.3; // Some stalled progress detected
		}
	}

	return 0.0;
}

/**
 * Compute risk score from signals using configured weights.
 */
function computeRiskScore(signals: TrajectorySignals): number {
	return (
		signals.repeatedFailure * RISK_CONFIG.weights.repeatedFailure +
		signals.editChurn * RISK_CONFIG.weights.editChurn +
		signals.stalledProgress * RISK_CONFIG.weights.stalledProgress
	);
}

/**
 * Route to a model, determining which physical model to use.
 */
function routeTo(
	request: ModelRouteRequest<TrajectoryState>,
	ctx: ExtensionContext,
	phase: "cheap" | "strong",
	state?: TrajectoryState,
): ModelRoute<TrajectoryState> {
	const modelId = phase === "strong" ? getStrongModel(ctx) : getCheapModel(ctx);
	const model = ctx.modelRegistry.find(modelId.provider, modelId.id);

	if (!model) {
		throw new Error(`Model ${modelId.provider}/${modelId.id} is not in the catalog`);
	}

	return {
		model,
		thinkingLevel: request.thinkingLevel ?? "medium",
		state,
	};
}

/**
 * Get the physical model ID for the cheap model.
 * Uses environment variable or falls back to a default.
 */
function getCheapModel(ctx: ExtensionContext): { provider: string; id: string } {
	const envVar = process.env.PI_HANDOFF_CHEAP_MODEL;
	if (envVar) {
		const [provider, id] = envVar.split("/");
		if (provider && id) {
			return { provider, id };
		}
	}
	// Default to a cheap model - adjust based on what's available
	return { provider: "anthropic", id: "claude-3-5-haiku-latest" };
}

/**
 * Get the physical model ID for the strong model.
 * Uses environment variable or falls back to a default.
 */
function getStrongModel(ctx: ExtensionContext): { provider: string; id: string } {
	const envVar = process.env.PI_HANDOFF_STRONG_MODEL;
	if (envVar) {
		const [provider, id] = envVar.split("/");
		if (provider && id) {
			return { provider, id };
		}
	}
	// Default to a strong model - adjust based on what's available
	return { provider: "anthropic", id: "claude-sonnet-4-5" };
}

// Type guards for message types
function isMessage(obj: unknown): obj is { role: string; content: unknown } {
	return typeof obj === "object" && obj !== null && "role" in obj;
}

function isToolCall(obj: unknown): obj is { type: string; toolName: string } {
	return typeof obj === "object" && obj !== null && "toolName" in obj;
}

function isToolResult(obj: unknown): obj is { type: string; toolName: string; isError: boolean } {
	return typeof obj === "object" && obj !== null && "toolName" in obj && "isError" in obj;
}

/**
 * Normalize error context for comparison.
 */
function normalizeErrorContext(msg: unknown): string {
	if (!isToolResult(msg) || !msg.isError) return "";
	// Extract and normalize error content
	const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
	return content.substring(0, 100); // Use first 100 chars for comparison
}

/**
 * Check if a tool name is a file-modifying tool.
 */
function isFileTool(toolName: string): boolean {
	const fileTools = ["edit", "write", "append", "delete", "rename", "move", "create"];
	return fileTools.includes(toolName);
}

/**
 * Extract file name from tool result.
 */
function extractFileName(msg: unknown): string | null {
	if (!isToolResult(msg)) return null;
	// Try to extract from structured content
	if (typeof msg.structuredContent === "object" && msg.structuredContent !== null) {
		if ("path" in msg.structuredContent && typeof msg.structuredContent.path === "string") {
			return msg.structuredContent.path;
		}
		if ("file" in msg.structuredContent && typeof msg.structuredContent.file === "string") {
			return msg.structuredContent.file;
		}
	}
	// Try to extract from content
	const content = typeof msg.content === "string" ? msg.content : "";
	const pathMatch = content.match(/(?:path|file):\s*(.+?)(?:\n|$)/i);
	if (pathMatch) {
		return pathMatch[1].trim();
	}
	return null;
}
