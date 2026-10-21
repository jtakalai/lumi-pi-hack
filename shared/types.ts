/**
 * Shared types for pi-handoff extensions
 */

export interface RiskConfig {
	threshold: number;
	weights: {
		repeatedFailure: number;
		editChurn: number;
		stalledProgress: number;
	};
}

export interface TrajectorySignals {
	repeatedFailure: number;
	editChurn: number;
	stalledProgress: number;
}

export interface Episode {
	id: string;
	startedAt: number;
	endedAt?: number;
	cheapRequests: number;
	strongRequests: number;
	escalated: boolean;
}

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
}

export interface RequestRecord {
	timestamp: number;
	model: string;
	provider: string;
	requestType: "input" | "output" | "cache_read" | "cache_write" | "total";
	usage: TokenUsage;
	episodeId: string;
	modelTier: "cheap" | "strong";
}

export interface HandoffEvent {
	timestamp: number;
	episodeId: string;
	fromModel: string;
	toModel: string;
	reason: "escalation" | "boundary";
}
