/**
 * Configuration resolution for pi-handoff.
 *
 * Precedence per field: CLI flag > environment variable > config file
 * (`handoff.config.json` in the package root) > built-in default.
 *
 * Cheap and strong models are REQUIRED (no implicit defaults): the router
 * refuses to route until both are configured, with an actionable error.
 * The lab harness sets these via env or flags per arm.
 *
 *   flag  --handoff-cheap / --handoff-strong / --handoff-threshold
 *   env   PI_HANDOFF_CHEAP / PI_HANDOFF_STRONG / PI_HANDOFF_THRESHOLD /
 *         PI_HANDOFF_WEIGHTS / PI_HANDOFF_CONFIG (explicit config file path;
 *         when set, it replaces <pkg>/handoff.config.json — absent file means
 *         "no file config", which is how the lab points at per-arm configs)
 *   file  handoff.config.json:
 *         { "cheap": "provider/model", "strong": "provider/model",
 *           "threshold": 4,
 *           "weights": { "repeated_failure": 1, "edit_churn": 1, "stalled_progress": 1 },
 *           "cheapThinking": "medium", "strongThinking": "high" }
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseModelRef, type ModelRef, type RiskWeights } from "../../../packages/shared/index.ts";

export interface HandoffConfig {
  cheap: ModelRef;
  strong: ModelRef;
  /** Escalation threshold θ on accumulated weighted risk (>= 1). */
  threshold: number;
  weights: RiskWeights;
  /** Optional per-phase thinking level overrides; unset = pass the selected level through. */
  cheapThinking?: string;
  strongThinking?: string;
}

export interface ConfigFile {
  cheap?: string;
  strong?: string;
  threshold?: number;
  weights?: Partial<RiskWeights>;
  cheapThinking?: string;
  strongThinking?: string;
}

export interface ConfigSource {
  flag: (name: string) => string | boolean | undefined;
  env: NodeJS.ProcessEnv;
}

export const FLAG = {
  cheap: "handoff-cheap",
  strong: "handoff-strong",
  threshold: "handoff-threshold",
} as const;

export const ENV = {
  cheap: "PI_HANDOFF_CHEAP",
  strong: "PI_HANDOFF_STRONG",
  threshold: "PI_HANDOFF_THRESHOLD",
  weights: "PI_HANDOFF_WEIGHTS",
  /** Explicit config file path; replaces `<pkg>/handoff.config.json` when set. */
  config: "PI_HANDOFF_CONFIG",
} as const;

export const DEFAULT_THRESHOLD = 4;
export const DEFAULT_WEIGHTS: RiskWeights = { repeated_failure: 1, edit_churn: 1, stalled_progress: 1 };

function asString(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function packageRoot(): string {
  try {
    // config.ts lives in <pkg>/src/
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
}

/** Read `<pkg>/handoff.config.json` if present. Throws on malformed JSON. */
export function readConfigFile(root: string = packageRoot()): ConfigFile | undefined {
  const p = join(root, "handoff.config.json");
  if (!existsSync(p)) return undefined;
  return parseConfigFile(p);
}

/** Read an explicit config file path (PI_HANDOFF_CONFIG). Absent = no file. */
export function readConfigFileAt(p: string): ConfigFile | undefined {
  if (!existsSync(p)) return undefined;
  return parseConfigFile(p);
}

function parseConfigFile(p: string): ConfigFile {
  const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`pi-handoff: ${p} must contain a JSON object`);
  }
  return parsed as ConfigFile;
}

/**
 * Weights from env (`"1,1,1"` in feature order or a JSON object) or the
 * config file, merged over defaults. Must be finite and >= 0.
 */
function resolveWeights(envValue: string | undefined, fileValue: Partial<RiskWeights> | undefined): RiskWeights {
  let fromEnv: Partial<RiskWeights> | undefined;
  if (envValue !== undefined && envValue.length > 0) {
    const t = envValue.trim();
    if (t.startsWith("{")) {
      fromEnv = JSON.parse(t) as Partial<RiskWeights>;
    } else {
      const parts = t.split(",").map((s) => Number(s.trim()));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`pi-handoff: ${ENV.weights} must be JSON or "rf,ec,sp" numbers, got "${envValue}"`);
      }
      fromEnv = { repeated_failure: parts[0], edit_churn: parts[1], stalled_progress: parts[2] };
    }
  }
  const merged: RiskWeights = {
    repeated_failure: fileValue?.repeated_failure ?? DEFAULT_WEIGHTS.repeated_failure,
    edit_churn: fileValue?.edit_churn ?? DEFAULT_WEIGHTS.edit_churn,
    stalled_progress: fileValue?.stalled_progress ?? DEFAULT_WEIGHTS.stalled_progress,
  };
  if (fromEnv) Object.assign(merged, fromEnv);
  for (const [k, v] of Object.entries(merged)) {
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`pi-handoff: weight "${k}" must be a finite number >= 0, got ${v}`);
    }
  }
  return merged;
}

export interface ResolvedConfig {
  config?: HandoffConfig;
  errors: string[];
}

export function resolveConfig(source: ConfigSource): ResolvedConfig {
  const errors: string[] = [];
  let file: ConfigFile | undefined;
  const explicitPath = asString(source.env[ENV.config]);
  try {
    file = explicitPath !== undefined ? readConfigFileAt(explicitPath) : readConfigFile();
  } catch (e) {
    errors.push((e as Error).message);
  }

  const cheapRef = asString(source.flag(FLAG.cheap)) ?? asString(source.env[ENV.cheap]) ?? file?.cheap;
  const strongRef = asString(source.flag(FLAG.strong)) ?? asString(source.env[ENV.strong]) ?? file?.strong;
  const thresholdRaw = asString(source.flag(FLAG.threshold)) ?? asString(source.env[ENV.threshold]);
  const threshold = thresholdRaw !== undefined ? Number(thresholdRaw) : file?.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 1) {
    errors.push(`pi-handoff: invalid threshold "${thresholdRaw ?? file?.threshold}" (need a number >= 1)`);
  }

  let weights: RiskWeights;
  try {
    weights = resolveWeights(asString(source.env[ENV.weights]), file?.weights);
  } catch (e) {
    errors.push((e as Error).message);
    weights = { ...DEFAULT_WEIGHTS };
  }

  if (!cheapRef) {
    errors.push(`pi-handoff: no cheap model. Set ${ENV.cheap}="provider/model-id", --${FLAG.cheap}, or "cheap" in handoff.config.json`);
  }
  if (!strongRef) {
    errors.push(`pi-handoff: no strong model. Set ${ENV.strong}="provider/model-id", --${FLAG.strong}, or "strong" in handoff.config.json`);
  }
  if (cheapRef && strongRef && cheapRef === strongRef) {
    errors.push(`pi-handoff: cheap and strong models must differ (both are "${cheapRef}")`);
  }

  let cheap: ModelRef | undefined;
  let strong: ModelRef | undefined;
  if (cheapRef) {
    try {
      cheap = parseModelRef(cheapRef);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (strongRef) {
    try {
      strong = parseModelRef(strongRef);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  if (errors.length > 0 || !cheap || !strong) {
    return { errors };
  }
  return {
    config: {
      cheap,
      strong,
      threshold,
      weights,
      cheapThinking: file?.cheapThinking,
      strongThinking: file?.strongThinking,
    },
    errors: [],
  };
}
