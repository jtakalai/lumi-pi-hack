/**
 * pi-trajectory — execution signal observer
 *
 * Collects trajectory diagnostics without invoking another LLM.
 * Observes tool calls, tool results, and edit operations to produce
 * structured trajectory-risk features.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface TrajectorySignals {
	repeatedFailure: number;
	editChurn: number;
	stalledProgress: number;
}

interface TrajectoryEvent {
	timestamp: number;
	type: "tool_call" | "tool_result" | "edit" | "failure" | "progress";
	toolName?: string;
	file?: string;
	isError?: boolean;
	messagesAnalyzed?: number;
	signals?: TrajectorySignals;
}

// In-memory storage for trajectory events
const trajectoryEvents: TrajectoryEvent[] = [];
const sessionEvents = new Map<string, TrajectoryEvent[]>();

export default function (pi: ExtensionAPI) {
	// Register a command to view trajectory diagnostics
	pi.registerCommand("trajectory", {
		description: "Show trajectory diagnostics and risk signals",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("trajectory requires interactive mode", "error");
				return;
			}

			const sessionId = args.trim() || "current";
			const events = sessionId === "current" ? trajectoryEvents : sessionEvents.get(sessionId) || [];

			if (events.length === 0) {
				ctx.ui.notify("No trajectory data available", "info");
				return;
			}

			// Compute summary statistics
			const summary = computeSummary(events);

			// Display in a custom TUI component
			await ctx.ui.custom<void>((tui, theme, kb, done) => {
				const Header = tui.createComponent("header", {
					text: "Trajectory Diagnostics",
					style: { fg: "blue", bold: true },
				});

				const Summary = tui.createComponent("text", {
					text: `Total events: ${summary.totalEvents}
Repetition: ${summary.totalRepeatedFailure.toFixed(2)}
Edit churn: ${summary.totalEditChurn.toFixed(2)}
Stalled progress: ${summary.totalStalledProgress.toFixed(2)}`,
					style: { fg: "white" },
				});

				const EventsList = tui.createComponent("list", {
					items: events.slice(-20).map((e) => ({
						text: `${new Date(e.timestamp).toISOString()} [${e.type}] ${e.toolName || ""}`,
						style: e.isError ? { fg: "red" } : { fg: "green" },
					})),
					onSelect: (index) => {
						const event = events[index];
						if (event) {
							ctx.ui.notify(`Event: ${JSON.stringify(event, null, 2)}`, "info");
						}
					},
				});

				const Footer = tui.createComponent("footer", {
					text: "↑↓: Navigate | q: Close | ENTER: Inspect",
				});

				const container = tui.createComponent("container", {
					children: [Header, Summary, EventsList, Footer],
					layout: "vertical",
				});

				tui.render(container);
				kb.bind(["q", "escape"], () => done());
				kb.bind(["up"], () => EventsList.move(-1));
				kb.bind(["down"], () => EventsList.move(1));
			});
		},
	});

	pi.registerCommand("trajectory-reset", {
		description: "Clear trajectory diagnostic data",
		handler: async (_, ctx) => {
			trajectoryEvents.length = 0;
			sessionEvents.clear();
			ctx.ui.notify("Trajectory data cleared", "info");
		},
	});

	// Observe tool calls and results
	pi.on("tool_call", async (event, ctx) => {
		// Only record for active sessions
		if (ctx.sessionManager.getSessionFile()) {
			trajectoryEvents.push({
				timestamp: Date.now(),
				type: "tool_call",
				toolName: event.toolName,
			});
			sessionEvents.set(ctx.sessionManager.getSessionFile() || "current", [
				...(sessionEvents.get(ctx.sessionManager.getSessionFile() || "current") || []),
				{
					timestamp: Date.now(),
					type: "tool_call",
					toolName: event.toolName,
				},
			]);
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (ctx.sessionManager.getSessionFile()) {
			trajectoryEvents.push({
				timestamp: Date.now(),
				type: event.isError ? "tool_result" : "tool_result",
				toolName: event.toolName,
				isError: event.isError,
			});

			// If we have the file path from structured content, track edit churn
			if (event.toolName === "edit" || event.toolName === "write") {
				const file = extractFileName(event);
				if (file) {
					trajectoryEvents.push({
						timestamp: Date.now(),
						type: "edit",
						file,
					});
				}
			}
		}
	});

	// Expose methods for other extensions to read trajectory data
	Object.assign(pi, {
		getTrajectorySignals: () => {
			return computeSignals(trajectoryEvents);
		},
	});
}

/**
 * Compute trajectory risk signals from events.
 */
function computeSignals(events: TrajectoryEvent[]): TrajectorySignals {
	return {
		repeatedFailure: computeRepeatedFailure(events),
		editChurn: computeEditChurn(events),
		stalledProgress: computeStalledProgress(events),
	};
}

/**
 * Compute repeated failure score.
 */
function computeRepeatedFailure(events: TrajectoryEvent[]): number {
	let score = 0;
	let lastFailureType: string | null = null;
	let consecutiveFailures = 0;

	for (const event of events) {
		if (event.type === "tool_result" && event.isError) {
			const type = event.toolName || "unknown";
			if (type === lastFailureType) {
				consecutiveFailures++;
			} else {
				consecutiveFailures = 1;
			}
			lastFailureType = type;
			score += consecutiveFailures * 0.1;
		} else if (event.type === "tool_call") {
			lastFailureType = null;
			consecutiveFailures = 0;
		}
	}

	return Math.min(score, 1.0);
}

/**
 * Compute edit churn score.
 */
function computeEditChurn(events: TrajectoryEvent[]): number {
	const fileEdits = new Map<string, number>();

	for (const event of events) {
		if (event.type === "edit" || (event.type === "tool_result" && event.toolName === "edit")) {
			if (event.file) {
				fileEdits.set(event.file, (fileEdits.get(event.file) || 0) + 1);
			}
		}
	}

	let churn = 0;
	for (const count of fileEdits.values()) {
		if (count > 2) {
			churn += (count - 2) * 0.15;
		}
	}

	return Math.min(churn, 1.0);
}

/**
 * Compute stalled progress score.
 */
function computeStalledProgress(events: TrajectoryEvent[]): number {
	// Look for patterns of Inactivity
	const recentEvents = events.slice(-10);
	if (recentEvents.length < 3) return 0;

	const toolEvents = recentEvents.filter((e) => e.type === "tool_call" || e.type === "tool_result");
	if (toolEvents.length >= 3) {
		// Multiple tool events without user input suggests stalled progress
		return 0.3 + Math.min(toolEvents.length - 3, 2) * 0.1;
	}

	return 0.0;
}

/**
 * Compute summary statistics from events.
 */
function computeSummary(events: TrajectoryEvent[]): {
	totalEvents: number;
	totalRepeatedFailure: number;
	totalEditChurn: number;
	totalStalledProgress: number;
} {
	const signals = computeSignals(events);
	return {
		totalEvents: events.length,
		totalRepeatedFailure: signals.repeatedFailure,
		totalEditChurn: signals.editChurn,
		totalStalledProgress: signals.stalledProgress,
	};
}

/**
 * Extract file name from tool result.
 */
function extractFileName(event: { content?: unknown; structuredContent?: unknown }): string | null {
	// Try structured content first
	if (event.structuredContent && typeof event.structuredContent === "object") {
		if ("path" in event.structuredContent && typeof event.structuredContent.path === "string") {
			return event.structuredContent.path;
		}
		if ("file" in event.structuredContent && typeof event.structuredContent.file === "string") {
			return event.structuredContent.file;
		}
	}

	// Try content
	if (event.content) {
		const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content);
		const pathMatch = content.match(/(?:path|file):\s*(.+?)(?:\n|$)/i);
		if (pathMatch) {
			return pathMatch[1].trim();
		}
	}

	return null;
}
