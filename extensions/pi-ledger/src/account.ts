/**
 * Token & handoff accounting for the pi-handoff collection (component D of
 * the project plan). Pure logic — no pi imports — so the lab harness and
 * the deterministic tests drive it directly, the same way they drive the
 * pi-handoff state machine.
 *
 * The extension (../index.ts) feeds this from live events:
 *
 *   - assistant `message_end` responses  -> per-episode / per-model usage
 *   - `pi-handoff:boundary` events       -> episode segmentation
 *   - `pi-handoff:state` events          -> handoff (escalation/manual/
 *                                           boundary) event record
 *
 * Physical-model transitions are derived from consecutive responses (the
 * transcript names the physical model of every response), so the report
 * shows not only the policy events but also any model switch, including
 * manual ones.
 *
 * Cost: `usage.cost.total` as recorded by pi from the provider's recorded
 * prices; local/unpriced models contribute 0.
 */

export interface TokenTotals {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

/** A usage object as recorded on assistant messages (pi's `Usage` shape). */
export interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}

export type Tier = "cheap" | "strong" | "other";

export interface ModelTotals extends TokenTotals {
  /** "provider/model" as recorded on the response. */
  model: string;
  tier: Tier;
}

export type HandoffKind = "escalation" | "boundary" | "manual";

export interface HandoffEventRecord {
  t: string;
  kind: HandoffKind;
  episodeId: string | null;
  detail: Record<string, unknown>;
}

export interface TransitionRecord {
  t: string;
  from: string;
  to: string;
}

export interface EpisodeRecord {
  /** null = the session's initial episode, before any boundary. */
  episodeId: string | null;
  totals: TokenTotals;
  byModel: Record<string, ModelTotals>;
  handoffs: HandoffEventRecord[];
  transitions: TransitionRecord[];
}

export interface LedgerSnapshot {
  episodeId: string | null;
  /** Last handoff state observed (CHEAP / STRONG_LOCKED), if any. */
  phase: string | null;
  risk: number;
  threshold: number | null;
  episodes: readonly EpisodeRecord[];
  perModel: Record<string, ModelTotals>;
  totals: TokenTotals;
  escalations: number;
  boundaries: number;
}

export function emptyTotals(): TokenTotals {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

export function addUsage(dest: TokenTotals, u: UsageLike): void {
  dest.requests += 1;
  dest.input += u.input ?? 0;
  dest.output += u.output ?? 0;
  dest.cacheRead += u.cacheRead ?? 0;
  dest.cacheWrite += u.cacheWrite ?? 0;
  dest.total +=
    u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  dest.cost += u.cost?.total ?? 0;
}

/** Fold one aggregate into another (both are TokenTotals, cost a plain number). */
export function addTotals(dest: TokenTotals, src: TokenTotals): void {
  dest.requests += src.requests;
  dest.input += src.input;
  dest.output += src.output;
  dest.cacheRead += src.cacheRead;
  dest.cacheWrite += src.cacheWrite;
  dest.total += src.total;
  dest.cost += src.cost;
}

/** Case-insensitive exact "provider/model" match against the configured pair. */
export function tierOf(model: string, cheap: string | null, strong: string | null): Tier {
  const m = model.toLowerCase();
  if (cheap && m === cheap.toLowerCase()) return "cheap";
  if (strong && m === strong.toLowerCase()) return "strong";
  return "other";
}

const nowIso = (): string => new Date().toISOString();

export class Ledger {
  private readonly episodesList: EpisodeRecord[] = [];
  private episode: EpisodeRecord;
  private lastModel: string | null = null;

  readonly cheap: string | null;
  readonly strong: string | null;

  episodeId: string | null = null;
  phase: string | null = null;
  risk = 0;
  threshold: number | null = null;

  constructor(cheap: string | null = null, strong: string | null = null) {
    this.cheap = cheap;
    this.strong = strong;
    this.episode = Ledger.newEpisode(null);
    this.episodesList.push(this.episode);
  }

  private static newEpisode(episodeId: string | null): EpisodeRecord {
    return { episodeId, totals: emptyTotals(), byModel: {}, handoffs: [], transitions: [] };
  }

  /** Start the episode named by a boundary event. The current episode record is finalized in the list. */
  onBoundary(episodeId: string, kind: string, reason?: string, t: string = nowIso()): void {
    this.episodeId = episodeId;
    this.episode = Ledger.newEpisode(episodeId);
    this.episodesList.push(this.episode);
    this.episode.handoffs.push({ t, kind: "boundary", episodeId, detail: { kind, reason } });
  }

  /**
   * Fold a `pi-handoff:state` change in. Policy events (escalation, manual
   * boundary, boundary) are recorded on the current episode; plain risk
   * updates only refresh the live phase/risk view.
   */
  onStateChange(
    reason: string,
    state: { phase: string; risk: number; episodeId?: string | null },
    threshold: number,
    t: string = nowIso(),
  ): void {
    this.phase = state.phase;
    this.risk = state.risk;
    this.threshold = threshold;
    if (reason === "escalation" || reason === "manual" || reason === "boundary") {
      this.episode.handoffs.push({
        t,
        kind: reason,
        episodeId: state.episodeId ?? this.episodeId,
        detail: { phase: state.phase, risk: state.risk, threshold },
      });
    }
  }

  /** Attribute one assistant response (the physical model is named on it). */
  onResponse(model: string, usage: UsageLike, t: string = nowIso()): void {
    const tier = tierOf(model, this.cheap, this.strong);
    addUsage(this.episode.totals, usage);
    const per =
      this.episode.byModel[model] ??
      (this.episode.byModel[model] = { model, tier, ...emptyTotals() });
    addUsage(per, usage);
    if (this.lastModel !== null && this.lastModel !== model) {
      this.episode.transitions.push({ t, from: this.lastModel, to: model });
    }
    this.lastModel = model;
  }

  snapshot(): LedgerSnapshot {
    const perModel: Record<string, ModelTotals> = {};
    const totals = emptyTotals();
    let escalations = 0;
    let boundaries = 0;
    for (const ep of this.episodesList) {
      addTotals(totals, ep.totals);
      for (const m of Object.values(ep.byModel)) {
        const agg =
          perModel[m.model] ?? (perModel[m.model] = { model: m.model, tier: m.tier, ...emptyTotals() });
        addTotals(agg, m);
      }
      for (const h of ep.handoffs) {
        if (h.kind === "escalation") escalations++;
        if (h.kind === "boundary") boundaries++;
      }
    }
    return {
      episodeId: this.episodeId,
      phase: this.phase,
      risk: this.risk,
      threshold: this.threshold,
      episodes: this.episodesList,
      perModel,
      totals,
      escalations,
      boundaries,
    };
  }
}
