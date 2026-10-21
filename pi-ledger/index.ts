/**
 * pi-ledger — token and handoff accounting
 *
 * Provides reproducible metrics for token consumption and switching overhead.
 * Tracks usage by Cheap and Strong models, identifies handoff events, and
 * exports episode-level and workflow-level summaries.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
}

interface RequestRecord {
	timestamp: number;
	model: string;
	provider: string;
	requestType: "input" | "output" | "cache_read" | "cache_write" | "total";
	usage: TokenUsage;
	episodeId: string;
	modelTier: "cheap" | "strong";
}

interface HandoffEvent {
	timestamp: number;
	episodeId: string;
	fromModel: string;
	toModel: string;
	reason: "escalation" | "boundary";
}

interface Ledger {
	requests: RequestRecord[];
	handoffs: HandoffEvent[];
	episodes: Map<string, { tokenId: string; totalTokens: number; totalCost: number }>;
}

// Global ledger state
const ledger: Ledger = {
	requests: [],
	handoffs: [],
	episodes: new Map(),
};

export default function (pi: ExtensionAPI) {
	// Register commands for ledger management
	pi.registerCommand("ledger summary", {
		description: "Show current ledger summary",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ledger summary requires interactive mode", "error");
				return;
			}

			const summary = computeSummary();
			const text = `Total requests: ${summary.totalRequests}
Total tokens: ${summary.totalTokens.toLocaleString()}
Total cost: $${summary.totalCost.toFixed(4)}

By tier:
  Cheap: ${summary.cheapTokens.toLocaleString()} tokens, $${summary.cheapCost.toFixed(4)}
  Strong: ${summary.strongTokens.toLocaleString()} tokens, $${summary.strongCost.toFixed(4)}

By episode: ${summary.episodeCount} episodes
Avg tokens per episode: ${summary.avgTokensPerEpisode.toLocaleString()}
Avg cost per episode: $${summary.avgCostPerEpisode.toFixed(4)}

Handoffs: ${summary.handoffCount}
Avg tokens before handoff: ${summary.avgTokensBeforeHandoff.toLocaleString()}`;

			ctx.ui.notify(text, "info");
		},
	});

	pi.registerCommand("ledger export", {
		description: "Export ledger data as JSON",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ledger export requires interactive mode", "error");
				return;
			}

			const data = {
				requests: ledger.requests,
				handoffs: ledger.handoffs,
				episodes: Array.from(ledger.episodes.entries()),
				exportedAt: new Date().toISOString(),
			};

			const json = JSON.stringify(data, null, 2);

			if (args.trim()) {
				// Save to file
				const fs = await import("fs");
				const path = await import("path");
				const filePath = path.resolve(args.trim());
				fs.writeFileSync(filePath, json, "utf8");
				ctx.ui.notify(`Ledger exported to ${filePath}`, "info");
			} else {
				// Display in editor
				const result = await ctx.ui.editor("Ledger Export", json);
				if (result !== undefined) {
					// User saved/edited
					ctx.ui.notify("Ledger edited", "info");
				}
			}
		},
	});

	pi.registerCommand("ledger reset", {
		description: "Reset ledger data",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ledger reset requires interactive mode", "error");
				return;
			}

			ledger.requests = [];
			ledger.handoffs = [];
			ledger.episodes.clear();

			ctx.ui.notify("Ledger reset", "info");
		},
	});

	// Observe model requests and tool usage
	pi.on("tool_result", async (event, ctx) => {
		if (event.usage) {
			const episodeId = ctx.sessionManager.getBranch()[0]?.id || "unknown";
			const model = event.model || "unknown";
			const provider = event.provider || "unknown";
			const modelTier = isStrongModel(model) ? "strong" : "cheap";

			// Record usage from tool results
			if (event.usage.totalTokens) {
				ledger.requests.push({
					timestamp: Date.now(),
					model,
					provider,
					requestType: "total",
					usage: {
						input: event.usage.inputTokens || 0,
						output: event.usage.outputTokens || 0,
						cacheRead: event.usage.cacheReadTokens || 0,
						cacheWrite: event.usage.cacheWriteTokens || 0,
						total: event.usage.totalTokens,
						cost: event.usage.cost || 0,
					},
					episodeId,
					modelTier,
				});
			}
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role === "assistant" && event.message.usage) {
			const episodeId = ctx.sessionManager.getBranch()[0]?.id || "unknown";
			const model = event.message.model || "unknown";
			const provider = event.message.provider || "unknown";
			const modelTier = isStrongModel(model) ? "strong" : "cheap";

			ledger.requests.push({
				timestamp: Date.now(),
				model,
				provider,
				requestType: "total",
				usage: {
					input: event.message.usage.inputTokens || 0,
					output: event.message.usage.outputTokens || 0,
					cacheRead: event.message.usage.cacheReadTokens || 0,
					cacheWrite: event.message.usage.cacheWriteTokens || 0,
					total: event.message.usage.totalTokens,
					cost: event.message.usage.cost || 0,
				},
				episodeId,
				modelTier,
			});
		}
	});

	// Expose methods for other extensions
	Object.assign(pi, {
		recordHandoff: (episodeId: string, fromModel: string, toModel: string, reason: "escalation" | "boundary") => {
			ledger.handoffs.push({
				timestamp: Date.now(),
				episodeId,
				fromModel,
				toModel,
				reason,
			});
		},
		getLedger: () => ({
			requests: [...ledger.requests],
			handoffs: [...ledger.handoffs],
			episodes: new Map(ledger.episodes),
		}),
	});
}

/**
 * Compute summary statistics from the ledger.
 */
function computeSummary() {
	const totalTokens = ledger.requests.reduce((sum, r) => sum + r.usage.total, 0);
	const totalCost = ledger.requests.reduce((sum, r) => sum + r.usage.cost, 0);

	const cheapRequests = ledger.requests.filter((r) => r.modelTier === "cheap");
	const strongRequests = ledger.requests.filter((r) => r.modelTier === "strong");

	const cheapTokens = cheapRequests.reduce((sum, r) => sum + r.usage.total, 0);
	const cheapCost = cheapRequests.reduce((sum, r) => sum + r.usage.cost, 0);

	const strongTokens = strongRequests.reduce((sum, r) => sum + r.usage.total, 0);
	const strongCost = strongRequests.reduce((sum, r) => sum + r.usage.cost, 0);

	// Group by episode
	const episodeTotals = new Map<string, { tokens: number; cost: number }>();
	for (const request of ledger.requests) {
		const existing = episodeTotals.get(request.episodeId) || { tokens: 0, cost: 0 };
		existing.tokens += request.usage.total;
		existing.cost += request.usage.cost;
		episodeTotals.set(request.episodeId, existing);
	}

	// Find tokens before each handoff
	const handoffTokens = ledger.handoffs.map((h) => {
		const beforeHandoff = ledger.requests.filter(
			(r) => r.episodeId === h.episodeId && r.timestamp < h.timestamp,
		);
		return beforeHandoff.reduce((sum, r) => sum + r.usage.total, 0);
	});

	return {
		totalRequests: ledger.requests.length,
		totalTokens,
		totalCost,
		cheapTokens,
		cheapCost,
		strongTokens,
		strongCost,
		episodeCount: episodeTotals.size,
		avgTokensPerEpisode: episodeTotals.size > 0 ? totalTokens / episodeTotals.size : 0,
		avgCostPerEpisode: episodeTotals.size > 0 ? totalCost / episodeTotals.size : 0,
		handoffCount: ledger.handoffs.length,
		avgTokensBeforeHandoff: ledger.handoffs.length > 0 ? handoffTokens.reduce((a, b) => a + b, 0) / ledger.handoffs.length : 0,
	};
}

/**
 * Check if a model is considered "strong".
 * This is a heuristic that can be configured.
 */
function isStrongModel(model: string): boolean {
	const strongModels = ["claude-sonnet", "claude-opus", "gpt-4", "gpt-5"];
	return strongModels.some((m) => model.toLowerCase().includes(m.toLowerCase()));
}
