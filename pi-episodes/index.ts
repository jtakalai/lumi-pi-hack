/**
 * pi-episodes — workflow boundary controller
 *
 * Defines and signals episode boundaries independently from the routing algorithm.
 * Maintains episode identifiers and emits boundary events consumed by pi-handoff.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Episode {
	id: string;
	startedAt: number;
	endedAt?: number;
	cheapRequests: number;
	strongRequests: number;
	escalated: boolean;
}

interface EpisodeState {
	currentEpisodeId: string | null;
	episodes: Map<string, Episode>;
}

// Global episode state
const episodeState: EpisodeState = {
	currentEpisodeId: null,
	episodes: new Map(),
};

export default function (pi: ExtensionAPI) {
	// Initialize a new episode
	const newEpisodeId = generateEpisodeId();
	episodeState.currentEpisodeId = newEpisodeId;
	episodeState.episodes.set(newEpisodeId, {
		id: newEpisodeId,
		startedAt: Date.now(),
		cheapRequests: 0,
		strongRequests: 0,
		escalated: false,
	});

	// Register commands for episode control
	pi.registerCommand("handoff next", {
		description: "Mark current episode as complete and start a new one",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff next requires interactive mode", "error");
				return;
			}

			if (!episodeState.currentEpisodeId) {
				ctx.ui.notify("No active episode", "error");
				return;
			}

			// Finalize current episode
			const episode = episodeState.episodes.get(episodeState.currentEpisodeId);
			if (episode) {
				episode.endedAt = Date.now();
				ctx.ui.notify(`Episode ${episode.id} completed. Cheap: ${episode.cheapRequests}, Strong: ${episode.strongRequests}`, "info");
			}

			// Start new episode
			const newId = generateEpisodeId();
			episodeState.currentEpisodeId = newId;
			episodeState.episodes.set(newId, {
				id: newId,
				startedAt: Date.now(),
				cheapRequests: 0,
				strongRequests: 0,
				escalated: false,
			});

			ctx.ui.notify(`Started new episode: ${newId}`, "info");
		},
	});

	pi.registerCommand("handoff reset", {
		description: "Reset all episode state",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff reset requires interactive mode", "error");
				return;
			}

			const currentId = episodeState.currentEpisodeId;
			if (currentId) {
				const episode = episodeState.episodes.get(currentId);
				if (episode) {
					episode.endedAt = Date.now();
					ctx.ui.notify(`Reset episode ${currentId}`, "info");
				}
			}

			episodeState.currentEpisodeId = null;
			episodeState.episodes.clear();

			// Start fresh
			const newId = generateEpisodeId();
			episodeState.currentEpisodeId = newId;
			episodeState.episodes.set(newId, {
				id: newId,
				startedAt: Date.now(),
				cheapRequests: 0,
				strongRequests: 0,
				escalated: false,
			});

			ctx.ui.notify(`Started fresh episode: ${newId}`, "info");
		},
	});

	pi.registerCommand("handoff status", {
		description: "Show current episode status",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff status requires interactive mode", "error");
				return;
			}

			const currentId = episodeState.currentEpisodeId;
			if (!currentId) {
				ctx.ui.notify("No active episode", "error");
				return;
			}

			const episode = episodeState.episodes.get(currentId);
			if (!episode) {
				ctx.ui.notify("Episode not found", "error");
				return;
			}

			const status = `Episode: ${episode.id}
Started: ${new Date(episode.startedAt).toISOString()}
Cheap requests: ${episode.cheapRequests}
Strong requests: ${episode.strongRequests}
Escalated: ${episode.escalated ? "Yes" : "No"}`;

			ctx.ui.notify(status, "info");
		},
	});

	pi.registerCommand("handoff list", {
		description: "List all episodes",
		handler: async (_, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff list requires interactive mode", "error");
				return;
			}

			if (episodeState.episodes.size === 0) {
				ctx.ui.notify("No episodes recorded", "info");
				return;
			}

			const list = Array.from(episodeState.episodes.entries())
				.map(([id, ep]) => {
					const duration = ep.endedAt ? (ep.endedAt - ep.startedAt) / 1000 : (Date.now() - ep.startedAt) / 1000;
					return `${ep.id}: ${ep.cheapRequests} cheap, ${ep.strongRequests} strong, escalated: ${ep.escalated}, duration: ${duration.toFixed(1)}s`;
				})
				.join("\n");

			await ctx.ui.custom<void>((tui, theme, kb, done) => {
				const Header = tui.createComponent("header", {
					text: "Episode List",
					style: { fg: "blue", bold: true },
				});

				const List = tui.createComponent("text", {
					text: list,
					style: { fg: "white" },
				});

				const Footer = tui.createComponent("footer", {
					text: "q: Close",
				});

				const container = tui.createComponent("container", {
					children: [Header, List, Footer],
					layout: "vertical",
				});

				tui.render(container);
				kb.bind(["q", "escape"], () => done());
			});
		},
	});

	// Observe model routing to track requests per episode
	// This would be called by pi-handoff to notify us of routing decisions
	pi.on("session_start", (event, ctx) => {
		// Start a new episode when a session starts
		const newId = generateEpisodeId();
		episodeState.currentEpisodeId = newId;
		episodeState.episodes.set(newId, {
			id: newId,
			startedAt: Date.now(),
			cheapRequests: 0,
			strongRequests: 0,
			escalated: false,
		});
	});

	// Expose methods for other extensions
	Object.assign(pi, {
		getCurrentEpisodeId: () => episodeState.currentEpisodeId,
		getEpisode: (id: string) => episodeState.episodes.get(id),
		getAllEpisodes: () => Array.from(episodeState.episodes.values()),
		recordRequest: (episodeId: string, model: "cheap" | "strong") => {
			const episode = episodeState.episodes.get(episodeId);
			if (episode) {
				if (model === "cheap") {
					episode.cheapRequests++;
				} else {
					episode.strongRequests++;
				}
			}
		},
		recordEscalation: (episodeId: string) => {
			const episode = episodeState.episodes.get(episodeId);
			if (episode) {
				episode.escalated = true;
			}
		},
	});
}

/**
 * Generate a unique episode ID.
 */
function generateEpisodeId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `episode_${timestamp}${random}`;
}
