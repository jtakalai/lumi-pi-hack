/**
 * Deterministic smoke tests for the pi-handoff extension collection.
 *
 * Validates the router, boundary controller, and telemetry without a model
 * or a network: a mock pi runtime drives the three real extension factories
 * through scripted trajectories (project plan §5.5, step 1).
 *
 * Run:  node test/smoke.ts      (Node >= 23.6, native TS type stripping)
 */

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failures.push(name);
    console.error(`FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Mock pi runtime (event bus + ExtensionAPI surface the factories use)
// ---------------------------------------------------------------------------

function makeBus() {
  const listeners = new Map<string, Array<(d: unknown) => void>>();
  const log: { channel: string; data: unknown }[] = [];
  return {
    on(channel: string, handler: (d: unknown) => void): () => void {
      const arr = listeners.get(channel) ?? [];
      arr.push(handler);
      listeners.set(channel, arr);
      return () => {
        const a = listeners.get(channel);
        const i = a?.indexOf(handler) ?? -1;
        if (i >= 0) a.splice(i, 1);
      };
    },
    emit(channel: string, data: unknown): void {
      log.push({ channel, data });
      for (const h of listeners.get(channel) ?? []) h(data);
    },
    log,
  };
}

interface MockPi {
  pi: any;
  bus: ReturnType<typeof makeBus>;
  handlers: Map<string, Array<(e: any, ctx: any) => any>>;
  commands: Map<string, (args: string, ctx: any) => Promise<void>>;
  virtualModel: any;
  flags: Map<string, unknown>;
  entries: { type: string; customType: string; data?: unknown }[];
}

function makePi(): MockPi {
  const bus = makeBus();
  const m: MockPi = {
    pi: null as any,
    bus,
    handlers: new Map(),
    commands: new Map(),
    virtualModel: undefined,
    flags: new Map(),
    entries: [],
  };
  m.pi = {
    on: (name: string, handler: (e: any, ctx: any) => any) => {
      const a = m.handlers.get(name) ?? [];
      a.push(handler);
      m.handlers.set(name, a);
      return () => {};
    },
    events: bus,
    registerVirtualModel: (def: any) => {
      m.virtualModel = def;
    },
    registerCommand: (name: string, opts: { handler: (args: string, ctx: any) => Promise<void> }) => {
      m.commands.set(name, opts.handler);
    },
    registerFlag: (_name: string, _opts: unknown) => {},
    getFlag: (name: string) => m.flags.get(name),
    appendEntry: (customType: string, data?: unknown) => {
      m.entries.push({ type: "custom", customType, data });
    },
  };
  return m;
}

function makeCtx(models: string[], branch: () => any[] = () => []) {
  const notifications: { text: string; level?: string }[] = [];
  const status: Record<string, string> = {};
  const ctx: any = {
    ui: {
      notify: (text: string, level?: string) => {
        notifications.push({ text, level });
      },
      setStatus: (key: string, text: string | undefined) => {
        if (text) status[key] = text;
        else delete status[key];
      },
    },
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    modelRegistry: {
      find: (provider: string, id: string) =>
        models.includes(`${provider}/${id}`) ? { provider, id, name: id, api: "test-api" } : undefined,
    },
    sessionManager: { getBranch: () => branch() },
    isIdle: () => true,
  };
  return { ctx, notifications, status };
}

async function dispatch(m: MockPi, name: string, event: any, ctx: any): Promise<any[]> {
  const results: any[] = [];
  for (const h of m.handlers.get(name) ?? []) results.push(await h(event, ctx));
  return results;
}

/** Emulate pi's virtual-model state persistence: a returned state (that is
 * not the request's own state reference) becomes the branch state. */
function makeRouter(m: MockPi, ctx: any) {
  let persisted: any = undefined;
  return {
    route(reason: string, extra: Record<string, unknown> = {}) {
      const request = {
        model: { provider: "handoff", id: "auto", api: "pi-virtual" },
        thinkingLevel: "medium",
        reason,
        state: persisted,
        messages: [],
        ...extra,
      };
      const out = m.virtualModel.route(request, ctx);
      if (out.state !== undefined && out.state !== request.state) persisted = out.state;
      return { out, request };
    },
    get persisted() {
      return persisted;
    },
  };
}

function toolResult(m: MockPi, ctx: any, toolName: string, input: Record<string, unknown>, isError: boolean, text?: string) {
  return dispatch(m, "tool_result", {
    type: "tool_result",
    toolCallId: `tc-${Math.random().toString(36).slice(2)}`,
    toolName,
    input,
    content: text === undefined ? [] : [{ type: "text", text }],
    isError,
  }, ctx);
}

const FAIL_TEXT = "npm ERR! Test suite failed\nError: 3 of 12 tests failed (see <test> output)";

// ---------------------------------------------------------------------------
// A. State machine units
// ---------------------------------------------------------------------------

{
  const { initialHandoffState, applyRisk, applyBoundary } = await import("../extensions/pi-handoff/src/state-machine.ts");
  const W = { repeated_failure: 1, edit_churn: 1, stalled_progress: 1 };
  const rf = (n = 1) => ({ feature: "repeated_failure" as const, increment: n, detail: {} });

  let s = initialHandoffState("ep-1");
  check("A1 initial is CHEAP r=0", s.phase === "CHEAP" && s.risk === 0 && s.episodeId === "ep-1");

  const o1 = applyRisk(s, [rf()], W, 4);
  check("A2 below threshold stays CHEAP", o1.state.phase === "CHEAP" && o1.state.risk === 1 && !o1.escalated);
  check("A2b new object on change", o1.state !== s);

  const o1same = applyRisk(s, [], W, 4);
  check("A3 no events -> same object identity", o1same.state === s);

  const o4 = applyRisk({ ...o1.state, risk: 3 }, [rf()], W, 4);
  check("A4 at threshold latches STRONG_LOCKED", o4.escalated && o4.state.phase === "STRONG_LOCKED" && o4.state.escalations === 1);

  const o5 = applyRisk(o4.state, [rf(), rf()], W, 4);
  check("A5 locked stays locked, escalations not double-counted", o5.state.phase === "STRONG_LOCKED" && o5.state.escalations === 1 && o5.state.risk === 6);

  const b = applyBoundary(o5.state, "ep-2");
  check("A6 boundary resets phase+risk, keeps escalation count", b.phase === "CHEAP" && b.risk === 0 && b.episodeId === "ep-2" && b.escalations === 1);

  const W2 = { repeated_failure: 2, edit_churn: 1, stalled_progress: 1 };
  const w = applyRisk(initialHandoffState(null), [rf(), rf()], W2, 4);
  check("A7 weights apply (2 events x weight 2 = 4)", w.state.risk === 4 && w.escalated);
}

// ---------------------------------------------------------------------------
// B. Normalization units
// ---------------------------------------------------------------------------

{
  const { normalizeCommand, errorSignature, fnv1a } = await import("../extensions/pi-trajectory/src/normalize.ts");
  check("B1 command normalization collapses numbers/paths/case", normalizeCommand("NPM TEST --testPathPattern=foo/Bar") === normalizeCommand("npm test --testPathPattern=other/Baz"));
  check("B1b distinct commands stay distinct", normalizeCommand("npm test") !== normalizeCommand("npm build"));
  check("B2 same error text -> same signature", errorSignature(FAIL_TEXT) === errorSignature(FAIL_TEXT));
  check("B3 different errors -> different signatures", errorSignature(FAIL_TEXT) !== errorSignature("TypeError: cannot read properties of undefined (reading 'x')"));
  check("B3b numbers in errors collapse", errorSignature("Error: 3 of 12 tests failed") === errorSignature("Error: 7 of 25 tests failed"));
  check("B4 fnv1a stable", fnv1a("abc") === fnv1a("abc") && fnv1a("abc").length === 8);
}

// ---------------------------------------------------------------------------
// C. Trajectory observer units
// ---------------------------------------------------------------------------

{
  const { TrajectoryObserver } = await import("../extensions/pi-trajectory/src/observer.ts");
  const obs = new TrajectoryObserver();

  check("C1 first failure emits nothing", obs.observe("bash", { command: "npm test" }, true, [{ type: "text", text: FAIL_TEXT }]).length === 0);
  const second = obs.observe("bash", { command: "npm test" }, true, [{ type: "text", text: FAIL_TEXT }]);
  check("C2 second same failure fires repeated_failure", second.length === 1 && second[0].feature === "repeated_failure");
  const third = obs.observe("bash", { command: "npm test" }, true, [{ type: "text", text: FAIL_TEXT }]);
  check("C3 third repetition also fires stalled_progress", third.some((e) => e.feature === "stalled_progress") && third.some((e) => e.feature === "repeated_failure"));

  check("C4 progress (bash ok) resets windows", obs.observe("bash", { command: "npm test" }, false, [{ type: "text", text: "12 passing" }]).length === 0);
  check("C5 failure restarts the count", obs.observe("bash", { command: "npm test" }, true, [{ type: "text", text: FAIL_TEXT }]).length === 0);

  obs.reset("ep-9");
  check("C6 reset clears windows", obs.observe("bash", { command: "npm test" }, true, [{ type: "text", text: FAIL_TEXT }]).length === 0 && obs.currentEpisodeId === "ep-9");

  const o2 = new TrajectoryObserver();
  const e1 = o2.observe("edit", { path: "a.ts" }, false, []);
  const e2 = o2.observe("edit", { path: "a.ts" }, false, []);
  const e3 = o2.observe("edit", { path: "a.ts" }, false, []);
  check("C7 edit churn fires on 3rd edit to same file", e1.length === 0 && e2.length === 0 && e3.length === 1 && e3[0].feature === "edit_churn" && e3[0].detail.path === "a.ts");
  check("C7b other file unaffected", o2.observe("edit", { path: "b.ts" }, false, []).length === 0);
  check("C7c successful edit is not itself progress", o2.observe("edit", { path: "a.ts" }, false, []).length === 1);

  const o3 = new TrajectoryObserver();
  check("C8 read-only tools never stall or count as progress", o3.observe("read", { path: "x.ts" }, false, []).length === 0);

  const o3b = new TrajectoryObserver();
  const r1 = o3b.observe("grep", { pattern: "x" }, true, []);
  const r2 = o3b.observe("grep", { pattern: "x" }, true, []);
  check("C8b failing read-only still tracked as repeated failure", r1.length === 0 && r2.length === 1 && r2[0].feature === "repeated_failure");

  const o4 = new TrajectoryObserver();
  o4.observe("bash", { command: "npm test" }, false, []);
  check("C9 successful edit after progress does not churn", o4.observe("edit", { path: "a.ts" }, false, []).length === 0);
}

// ---------------------------------------------------------------------------
// D. Full pipeline: trajectory -> bus -> handoff, episodes -> bus -> handoff
// ---------------------------------------------------------------------------

{
  const envBackup = { ...process.env };
  process.env.PI_HANDOFF_CHEAP = "prov/cheap-m";
  process.env.PI_HANDOFF_STRONG = "prov/strong-m";
  process.env.PI_HANDOFF_THRESHOLD = "4";
  process.env.PI_EPISODES_USER_TURN = "1";

  try {
    const { default: trajectoryExt } = await import("../extensions/pi-trajectory/index.ts");
    const { default: episodesExt } = await import("../extensions/pi-episodes/index.ts");
    const { default: handoffExt } = await import("../extensions/pi-handoff/index.ts");
    const { CHANNEL } = await import("../packages/shared/index.ts");

    const m = makePi();
    const { ctx, notifications, status } = makeCtx(["prov/cheap-m", "prov/strong-m"], () => m.entries);
    trajectoryExt(m.pi);
    episodesExt(m.pi);
    handoffExt(m.pi);
    const router = makeRouter(m, ctx);

    check("D0 virtual model registered as handoff/auto", m.virtualModel?.provider === "handoff" && m.virtualModel?.id === "auto");
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);

    // Episode 1, cheap, healthy
    let r1 = router.route("user");
    check("D1 first request routes to cheap", r1.out.model.id === "cheap-m");
    check("D1b initial state CHEAP", r1.out.state?.phase === "CHEAP" && r1.out.state?.risk === 0);

    // Stuck: same failing command
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 1st
    let r = router.route("continuation");
    check("D2 first failure: no risk", r.out.state?.risk === 0 && r.out.model.id === "cheap-m");

    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 2nd -> repeated_failure
    r = router.route("continuation");
    check("D3 second failure: R=1, still cheap", r.out.state?.risk === 1 && r.out.model.id === "cheap-m");

    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 3rd -> rf + stall
    r = router.route("continuation");
    check("D4 third failure: R=3, still cheap", r.out.state?.risk === 3 && r.out.model.id === "cheap-m");

    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 4th -> rf + stall -> R=5 >= 4
    r = router.route("continuation");
    check("D5 at R=5 escalates to strong", r.out.model.id === "strong-m" && r.out.state?.phase === "STRONG_LOCKED");
    check("D5b escalation persisted and counted", r.out.state?.escalations === 1 && router.persisted?.phase === "STRONG_LOCKED");
    check("D5c state-change broadcast on bus", m.bus.log.some((e) => e.channel === CHANNEL.state && (e.data as any).reason === "escalation"));
    check("D5d user notified of escalation", notifications.some((n) => n.text.includes("escalating") && n.level === "warning"));

    r = router.route("continuation");
    check("D6 lock holds on continuation", r.out.model.id === "strong-m" && r.out.state === r.request.state);

    // Progress while locked: windows reset, but no downgrade
    await toolResult(m, ctx, "bash", { command: "npm test" }, false, "12 passing");
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // new window, 1st occurrence
    r = router.route("continuation");
    check("D7 no downgrade within episode; new failure window not counted", r.out.model.id === "strong-m" && r.out.state?.risk === 5);

    // Episode boundary via /episode next
    await m.commands.get("episode")!("next", ctx);
    check("D8 /episode next emitted boundary ep-2", m.bus.log.some((e) => e.channel === CHANNEL.boundary && (e.data as any).episodeId === "ep-2"));

    r = router.route("continuation");
    check("D9 boundary released lock, reset risk, new episode", r.out.model.id === "cheap-m" && r.out.state?.phase === "CHEAP" && r.out.state?.risk === 0 && r.out.state?.episodeId === "ep-2");

    // Fresh windows after boundary: same failing command must re-accumulate
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 1st in ep-2
    r = router.route("continuation");
    check("D10 windows reset by boundary", r.out.state?.risk === 0);
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT); // 2nd -> rf
    r = router.route("continuation");
    check("D11 risk re-accumulates in new episode", r.out.state?.risk === 1 && r.out.model.id === "cheap-m");

    // Standalone marker: consumed, no agent run, boundary
    const inputResults = await dispatch(m, "input", { type: "input", text: "[episode:next]", images: undefined, source: "interactive" }, ctx);
    check("D12 standalone marker handled (no agent run)", inputResults.some((res) => res?.action === "handled"));
    check("D12b marker advanced to ep-3", m.bus.log.some((e) => e.channel === CHANNEL.boundary && (e.data as any).episodeId === "ep-3"));
    r = router.route("user");
    check("D12c route after marker is cheap in ep-3", r.out.model.id === "cheap-m" && r.out.state?.episodeId === "ep-3");

    // User-turn default policy: settled run + new user task
    await dispatch(m, "agent_settled", { type: "agent_settled", aborted: false }, ctx);
    await dispatch(m, "before_agent_start", { type: "before_agent_start", messageType: "user", prompt: "now update the docs", systemPrompt: "", systemPromptOptions: {} }, ctx);
    check("D13 settled + new user task starts ep-4", m.bus.log.some((e) => e.channel === CHANNEL.boundary && (e.data as any).episodeId === "ep-4" && (e.data as any).kind === "user_turn"));
    r = router.route("user");
    check("D13b cheap in ep-4", r.out.model.id === "cheap-m" && r.out.state?.episodeId === "ep-4" && r.out.state?.risk === 0);

    // No double boundary for the same user task
    const boundariesBefore = m.bus.log.filter((e) => e.channel === CHANNEL.boundary).length;
    await dispatch(m, "before_agent_start", { type: "before_agent_start", messageType: "user", prompt: "continue", systemPrompt: "", systemPromptOptions: {} }, ctx);
    const boundariesAfter = m.bus.log.filter((e) => e.channel === CHANNEL.boundary).length;
    check("D14 no repeated user_turn boundary without a settle", boundariesBefore === boundariesAfter);

    // Commands and status
    await m.commands.get("handoff")!("status", ctx);
    check("D15 /handoff status reports CHEAP", (notifications.at(-1)?.text ?? "").includes("CHEAP"));
    await m.commands.get("handoff")!("reset", ctx);
    r = router.route("user");
    check("D16 /handoff reset issues a manual episode", r.out.model.id === "cheap-m" && (r.out.state?.episodeId ?? "").startsWith("manual-"));
    await m.commands.get("handoff")!("config", ctx);
    check("D17 /handoff config shows both models", notifications.at(-1)?.text.includes("prov/cheap-m") && notifications.at(-1)?.text.includes("prov/strong-m"));

    // Episode persistence entries
    const epEntries = m.entries.filter((e) => e.customType === "pi-episodes:state");
    check("D18 episode boundaries persisted as custom entries", epEntries.length >= 3);
    check("D19 TUI status line set", typeof status.handoff === "string" && status.handoff.startsWith("handoff:"));

    // Resume: episode counter restored from branch
    await dispatch(m, "session_start", { type: "session_start", reason: "resume" }, ctx);
    await m.commands.get("episode")!("status", ctx);
    check("D20 resume restores episode counter", (notifications.at(-1)?.text ?? "").includes("ep-4"));
  } finally {
    process.env = envBackup;
  }
}

// ---------------------------------------------------------------------------
// E. Configuration
// ---------------------------------------------------------------------------

{
  const { default: handoffExt } = await import("../extensions/pi-handoff/index.ts");
  const envBackup = { ...process.env };

  // Unconfigured: refuses to route with an actionable error
  delete process.env.PI_HANDOFF_CHEAP;
  delete process.env.PI_HANDOFF_STRONG;
  {
    const m = makePi();
    const { ctx } = makeCtx([]);
    handoffExt(m.pi);
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const router = makeRouter(m, ctx);
    let threw = false;
    try {
      router.route("user");
    } catch (e) {
      threw = /unconfigured|no cheap model/.test((e as Error).message);
    }
    check("E1 unconfigured router throws actionable error", threw);
  }

  // Env-configured
  process.env.PI_HANDOFF_CHEAP = "prov/c2";
  process.env.PI_HANDOFF_STRONG = "prov/s2";
  {
    const m = makePi();
    const { ctx } = makeCtx(["prov/c2", "prov/s2"]);
    handoffExt(m.pi);
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const router = makeRouter(m, ctx);
    const r = router.route("user");
    check("E2 env config routes to cheap", r.out.model.id === "c2");
  }

  // Flag precedence over env
  {
    const m = makePi();
    m.flags.set("handoff-cheap", "prov/flagc");
    const { ctx } = makeCtx(["prov/flagc", "prov/s2"]);
    handoffExt(m.pi);
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const router = makeRouter(m, ctx);
    const r = router.route("user");
    check("E3 flag beats env", r.out.model.id === "flagc");
  }

  // Unknown model in catalog
  {
    const m = makePi();
    const { ctx } = makeCtx(["prov/s2"]); // cheap missing from catalog
    handoffExt(m.pi);
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const router = makeRouter(m, ctx);
    let threw = false;
    try {
      router.route("user");
    } catch (e) {
      threw = /not found in the catalog/.test((e as Error).message);
    }
    check("E4 unknown model -> clear catalog error", threw);
  }

  process.env = envBackup;
}

// ---------------------------------------------------------------------------
// F. Standalone pi-handoff (no trajectory, no episodes)
// ---------------------------------------------------------------------------

{
  const envBackup = { ...process.env };
  process.env.PI_HANDOFF_CHEAP = "prov/c";
  process.env.PI_HANDOFF_STRONG = "prov/s";

  try {
    const { default: handoffExt } = await import("../extensions/pi-handoff/index.ts");
    const m = makePi();
    const { ctx } = makeCtx(["prov/c", "prov/s"]);
    handoffExt(m.pi);
    await dispatch(m, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const router = makeRouter(m, ctx);

    // A failure with no observer loaded: nothing accumulates, stays cheap
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT);
    await toolResult(m, ctx, "bash", { command: "npm test" }, true, FAIL_TEXT);
    const r = router.route("continuation");
    check("F1 without pi-trajectory no risk accumulates", r.out.model.id === "c" && (r.out.state?.risk ?? 0) === 0);

    // Manual boundary still works standalone
    await m.commands.get("handoff")!("reset", ctx);
    const r2 = router.route("user");
    check("F2 standalone manual boundary works", (r2.out.state?.episodeId ?? "").startsWith("manual-") && r2.out.model.id === "c");
  } finally {
    process.env = envBackup;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("OK: pi-handoff / pi-trajectory / pi-episodes deterministic smoke tests");
