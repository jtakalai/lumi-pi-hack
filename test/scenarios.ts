/**
 * Laajennetut skenaariotestit pi-handoff -kokoelmalle.
 * Aja: node test/scenarios.ts
 */

import { CHANNEL } from "../packages/shared/index.ts";
import trajectoryExt from "../extensions/pi-trajectory/index.ts";
import episodesExt from "../extensions/pi-episodes/index.ts";
import handoffExt from "../extensions/pi-handoff/index.ts";

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

// Mock-ympäristön apufunktiot (yhteensopiva test/smoke.ts kanssa)
function createTestHarness(envOverrides: Record<string, string> = {}) {
  const listeners = new Map<string, Array<(d: unknown) => void>>();
  const busLog: { channel: string; data: unknown }[] = [];
  const bus = {
    on(ch: string, h: (d: unknown) => void) {
      listeners.set(ch, [...(listeners.get(ch) ?? []), h]);
      return () => {};
    },
    emit(ch: string, data: unknown) {
      busLog.push({ channel: ch, data });
      for (const h of listeners.get(ch) ?? []) h(data);
    },
    log: busLog,
  };

  const handlers = new Map<string, Array<(e: any, ctx: any) => any>>();
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const flags = new Map<string, unknown>();
  const entries: any[] = [];
  let virtualModel: any;

  const pi: any = {
    on: (name: string, h: any) => {
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
      return () => {};
    },
    events: bus,
    registerVirtualModel: (def: any) => { virtualModel = def; },
    registerCommand: (name: string, opts: any) => { commands.set(name, opts.handler); },
    registerFlag: () => {},
    getFlag: (name: string) => flags.get(name),
    appendEntry: (customType: string, data?: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  };

  const ctx: any = {
    ui: { notify: () => {}, setStatus: () => {} },
    cwd: process.cwd(),
    modelRegistry: {
      find: (provider: string, id: string) => ({ provider, id, name: id, api: "test-api" }),
    },
    sessionManager: { getBranch: () => entries },
  };

  Object.assign(process.env, {
    PI_HANDOFF_CHEAP: "prov/cheap",
    PI_HANDOFF_STRONG: "prov/strong",
    PI_HANDOFF_THRESHOLD: "4",
    PI_EPISODES_USER_TURN: "1",
    ...envOverrides,
  });

  trajectoryExt(pi);
  episodesExt(pi);
  handoffExt(pi);

  let persistedState: any = undefined;

  return {
    bus,
    commands,
    ctx,
    async dispatch(name: string, event: any) {
      const out = [];
      for (const h of handlers.get(name) ?? []) out.push(await h(event, ctx));
      return out;
    },
    async tool(toolName: string, input: Record<string, unknown>, isError: boolean, text = "") {
      for (const h of handlers.get("tool_result") ?? []) {
        await h({
          type: "tool_result",
          toolCallId: "tc-1",
          toolName,
          input,
          isError,
          content: [{ type: "text", text }],
        }, ctx);
      }
    },
    route(reason = "continuation", extra: Record<string, unknown> = {}) {
      const req = {
        model: { provider: "handoff", id: "auto" },
        thinkingLevel: "medium",
        reason,
        state: persistedState,
        messages: [],
        ...extra,
      };
      const out = virtualModel.route(req, ctx);
      if (out.state !== undefined && out.state !== req.state) {
        persistedState = out.state;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Skenaario 1: Negatiivinen kontrolli (Paljon lukuoperaatioita ja onnistumisia)
// ---------------------------------------------------------------------------
{
  const h = createTestHarness();
  await h.dispatch("session_start", { type: "session_start", reason: "startup" });

  // Pieni malli lukee 10 tiedostoa ja ajaa onnistuneita komentoja
  for (let i = 0; i < 10; i++) {
    await h.tool("read", { path: `src/file_${i}.ts` }, false, "content");
    await h.tool("grep", { pattern: "TODO" }, false, "match");
  }
  await h.tool("bash", { command: "pytest" }, false, "10 passed");

  const res = h.route();
  check("S1.1 Rutiiniluvut eivät kasvata riskiä (R=0)", res.state?.risk === 0);
  check("S1.2 Pysytään CHEAP-mallissa", res.model.id === "cheap" && res.state?.phase === "CHEAP");
}

// ---------------------------------------------------------------------------
// Skenaario 2: Edit Churn -silmukka (Tiedoston sahaus ilman testien ajoa)
// ---------------------------------------------------------------------------
{
  const h = createTestHarness({ PI_HANDOFF_THRESHOLD: "2" }); // Eskaloidaan 2 riskipisteestä
  await h.dispatch("session_start", { type: "session_start", reason: "startup" });

  // Muokataan samaa tiedostoa 4 kertaa peräkkäin ilman välissä olevaa onnistunutta komentoa:
  // 1. ja 2. muokkaus = 0 riskiä, 3. muokkaus = +1 (churn), 4. muokkaus = +1 (churn) -> R=2
  await h.tool("edit", { path: "buggy.py" }, false);
  await h.tool("edit", { path: "buggy.py" }, false);
  await h.tool("edit", { path: "buggy.py" }, false);
  let r = h.route();
  check("S2.1 Kolmas muokkaus nostaa riskin R=1 (vielä CHEAP)", r.state?.risk === 1 && r.model.id === "cheap");

  await h.tool("edit", { path: "buggy.py" }, false);
  r = h.route();
  check("S2.2 Neljäs muokkaus ylittää kynnyksen (R=2 >= 2) -> STRONG_LOCKED", r.state?.phase === "STRONG_LOCKED" && r.model.id === "strong");
}

// ---------------------------------------------------------------------------
// Skenaario 3: Retry-turvallisuus (Verkkovirheen sattuessa malli ei vaihdu)
// ---------------------------------------------------------------------------
{
  const h = createTestHarness();
  await h.dispatch("session_start", { type: "session_start", reason: "startup" });

  // Simuloidaan API-tason retry, kun edellinen kutsu kaatui
  const failedModel = { provider: "prov", id: "cheap", name: "cheap", api: "test-api" };
  const retryOut = h.route("retry", {
    failed: { model: failedModel, thinkingLevel: "low" },
  });

  check("S3.1 Retry säilyttää täsmälleen epäonnistuneen fyysisen mallin ja thinking-tason", retryOut.model === failedModel && retryOut.thinkingLevel === "low");
}

// ---------------------------------------------------------------------------
// Skenaario 4: Monivaiheinen työnkulku (Helppo -> Vaikea/Eskalointi -> Helppo)
// ---------------------------------------------------------------------------
{
  const h = createTestHarness({ PI_HANDOFF_THRESHOLD: "3" });
  await h.dispatch("session_start", { type: "session_start", reason: "startup" });

  // Vaihe 1 (ep-1): Helppo tutustuminen
  await h.tool("ls", {}, false, "README.md");
  let r1 = h.route("user");
  check("S4.1 Vaihe 1 pysyy CHEAP-tilassa", r1.model.id === "cheap");

  // Siirrytään vaiheeseen 2 (ep-2) eksplisiittisellä markerilla
  await h.dispatch("input", { type: "input", text: "[episode:next]" });

  // Vaihe 2 (ep-2): Vaikea bugi, testit kaatuvat 3 kertaa samalla virheellä
  // 1. kerta: 0, 2. kerta: +1 (repeated_failure), 3. kerta: +1 (rf) + 1 (stall) = R=3 >= 3
  const err = "AssertionError: expected 200 got 500";
  await h.tool("bash", { command: "pytest" }, true, err);
  await h.tool("bash", { command: "pytest" }, true, err);
  await h.tool("bash", { command: "pytest" }, true, err);

  let r2 = h.route("continuation");
  check("S4.2 Vaihe 2 eskaloituu STRONG-malliin (ep-2)", r2.model.id === "strong" && r2.state?.episodeId === "ep-2");

  // Vahva malli saa testit läpi, mutta pysyy lukittuna ep-2:n loppuun
  await h.tool("bash", { command: "pytest" }, false, "1 passed");
  let r2AfterFix = h.route("continuation");
  check("S4.3 Vahva malli ei alene kesken episodin vaikka testit menevät läpi", r2AfterFix.model.id === "strong");

  // Siirrytään vaiheeseen 3 (ep-3): Dokumentaation päivitys
  await h.dispatch("input", { type: "input", text: "[episode:next]" });
  let r3 = h.route("user");
  check("S4.4 Vaihe 3 (ep-3) vapauttaa lukon ja palaa CHEAP-malliin", r3.model.id === "cheap" && r3.state?.phase === "CHEAP" && r3.state?.risk === 0);
  check("S4.5 Kokonaiseskalointien määrä säilyy muistissa (escalations=1)", r3.state?.escalations === 1);
}

console.log(`\nSkenaariotestit: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);