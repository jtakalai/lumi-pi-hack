# Upgrading pi: research notes and four hours-scale plans

Oct 21, 2026 · @Weixuan Ding

## Bottom line

Most 2025–26 harness ideas already exist as pi packages, so the open ground is narrower than it looks: four things I could not find in pi are worth a few hours each.

Recursive-language-model REPLs, subagent fan-out, context folding, memory consolidation, loop detection and self-evolving harnesses all have pi implementations (next sections). That is by design: pi [skips sub-agents and plan mode and pushes everything else into extensions, skills and packages](https://github.com/earendil-works/pi).

| Plan | Build + run | What I did not find in pi | What you learn |
| --- | --- | --- | --- |
| A. Trajectory aggregation | 3–4 h | An aggregator that navigates K full coding trajectories, not just K diffs | Do trajectories beat diff-only selection? |
| B. Goal-conditioned skim | 2–3 h | Reads filtered by a goal the agent states | Token savings without more failed edits? |
| C. One-way escalation | 2–3 h | Cheap-first handoff triggered by trajectory features | Cost vs success against static tiers |
| D. Falsifiable harness edits (stretch) | 4–5 h | Per-edit predictions checked next round, misses reverted | Does revert beat keep-all and plain sampling? |

Run B first for a result in under three hours; run A first if you can afford K× rollouts. Every plan needs a matched-budget baseline: a [July 2026 study](https://arxiv.org/pdf/2607.12227) found automatic harness evolution did not consistently beat simple parallel sampling or sequential refinement on Terminal-Bench 2.1.

## What pi gives you

Pi exposes enough hooks that every plan is an extension or a small SDK script, with no fork. This table comes from the [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [virtual-model](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md) and [session-format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md) docs.

| Need | Pi surface | Plan |
| --- | --- | --- |
| Change what the model sees | `context` event; `tool_result` handlers replace content; append-only `context_edit` entries (branch-relative) | B |
| Add a model-callable tool | `pi.registerTool()` with a TypeBox schema | A, B |
| Call a cheap model from inside a tool | `ctx.modelRegistry.streamSimple()`; return its `usage` in the tool result so session totals stay correct | A, B |
| Route each request to a model | `pi.registerVirtualModel()`; `route(request, ctx)` sees messages, `reason`, `previous` and `state`; state is stored per session branch | C |
| Run headless or in parallel | Print and JSON modes, RPC, SDK `createAgentSession`, in-memory `SessionManager`, runtime `fork()` | A, D |
| Read trajectories | JSONL session tree (`id`/`parentId`); entry types `message`, `compaction`, `context_edit`, `branch_summary`, `custom`, `usage` | A, D |
| Persist extension state | `pi.appendEntry()`; tool-result `details` for state that follows the active branch | all |

Two limits shape the plans. Tree-navigation calls are command-only, so anything automatic that needs them must be driven from outside through the SDK. And pi has no built-in permission system, so [its docs recommend containers](https://github.com/earendil-works/pi) for benchmark runs.

## Already built in pi: use as baselines

Ten popular ideas already have pi implementations, so treat them as baselines rather than rebuilding them. The last column is the gap that survives.

| Idea | In pi today | Gap that survives |
| --- | --- | --- |
| Recursive language models, [Zhang et al.](https://arxiv.org/abs/2512.24601) | [pi-rlm](https://pi.dev/packages/pi-rlm), [pi-turtle-rlm](https://pi.dev/packages/pi-turtle-rlm), [@hicaru/pi-rlm](https://pi.dev/packages/@hicaru/pi-rlm); [Prime Agent](https://primeintellect.ai/blog/prime-agent) is built on pi with an RLM kernel | None worth chasing |
| Subagent fan-out and fan-in | [@narumitw/pi-subagents](https://pi.dev/packages/@narumitw/pi-subagents) (parallel plus aggregator), [@agwab/pi-subagent](https://pi.dev/packages/@agwab/pi-subagent) (worktrees) | Aggregators receive final outputs, not trajectories: Plan A |
| Context folding and branch-and-return, [Context-Folding](https://arxiv.org/abs/2510.11967) | [pi-navigator](https://pi.dev/packages/pi-navigator), [pi-fold](https://pi.dev/packages/pi-fold), [context-fold](https://pi.dev/packages/context-fold), [pi-auto-trees](https://pi.dev/packages/@howaboua/pi-auto-trees), [pi-slipstream-compact](https://pi.dev/packages/pi-slipstream-compact) | None. I dropped a grounded-fold plan after finding pi-fold compares deterministic and agent-written briefs |
| Learned memory and playbooks, [ACE](https://arxiv.org/abs/2510.04618), [ReasoningBank](https://arxiv.org/abs/2509.25140) | [@samfp/pi-memory](https://pi.dev/packages/@samfp/pi-memory), [@pedro\_klein/pi-memory](https://pi.dev/packages/@pedro_klein/pi-memory) (async session mining) | Crowded. Contrastive lessons from parallel rollouts appear untried: Plan A, stage 2 |
| Output pruning, [SWE-Pruner](https://arxiv.org/abs/2601.16746) | [pi-dynamic-context-pruning](https://pi.dev/packages/pi-dynamic-context-pruning), [pi-token-killer](https://pi.dev/packages/pi-token-killer), [pi-smart-reader](https://pi.dev/packages/pi-smart-reader) | They drop stale output, strip noise or return a skeleton; none I read conditions on a stated goal: Plan B |
| Loop and stall detection, [Same Model, Different Harness](https://arxiv.org/pdf/2608.26218) | [pi-deadloop](https://pi.dev/packages/pi-deadloop) | It alerts; nothing measures whether the nudge helps. Use it as a baseline arm |
| Per-turn model routing | [pi-model-router](https://pi.dev/packages/@kdejaeger/pi-model-router), [cortiq-pi-router](https://pi.dev/packages/cortiq-pi-router), pi's own `jev-router` example (strong plan, cheaper edits) | Tier or complexity based; no trajectory-triggered one-way handoff seen: Plan C |
| Self-evolving harness, [DGM](https://arxiv.org/abs/2505.22954), [Meta-Harness](https://arxiv.org/abs/2603.28052), [AHE](https://arxiv.org/abs/2604.25850) | [pi-reason-harness](https://pi.dev/packages/pi-reason-harness), [self-evolve-pi](https://github.com/Ralph-Abejuela/self-evolve-pi), Prime Agent's Continual Harness; the [ContextEvo](https://arxiv.org/pdf/2609.34649) paper starts from pi's harness | Editing exists; per-edit falsifiable predictions with revert not seen: Plan D |
| Programmatic tool calling (CodeAct style) | Built-in `codemode` extension | In core |
| Edit-format tuning, [hashline](https://blog.can.ac/2026/02/12/the-harness-problem) | oh-my-pi fork | Done. A [replication](https://dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2) found edit format mattered little for current models |

These rows come from a general web search over pi.dev listings, so "not seen" means I did not find it, not that it does not exist.

## Plan A: trajectory-as-environment patch aggregation

Choose or compose the final patch with an aggregator agent that can inspect K full trajectories, not just K diffs. Build takes 3–4 hours; rollouts add wall-clock time.

**Idea.** [AggAgent](https://arxiv.org/abs/2604.11753) treats parallel rollouts as an environment and gives an aggregator lightweight tools to inspect candidates and search across trajectories. It beat solution-only and summary aggregation by up to 5.3 points on average across six benchmarks, with aggregation cost bounded by one rollout. Those benchmarks were search and deep research. The coding version, which would use test output, edit history and abandoned approaches to pick a patch, looks untested. Existing pi fan-in aggregators receive final outputs only.

**Why pi fits.** Sessions are JSONL trees you can walk by `parentId`, `--session-id` lets you name them, and git worktrees isolate candidates.

**Build (about 150 lines).**

1. A runner script: for each task, create K worktrees and run print-mode pi in each with a fixed session id such as `task-k`.
2. An aggregator extension that registers five tools: `list_candidates()`, `diff(i)`, `show_step(i, n)` (reads candidate i's active branch from its session file), `grep_traj(pattern)` and `run_tests(i)` (applies candidate i to a clean worktree and runs the repo's test command).
3. An aggregator prompt that must choose an index or write a combined patch and cite the step ids that justify the choice. Log the citations.

**Arms** (same K, same tasks):

| Arm | Selection rule |
| --- | --- |
| Single run | Rollout 1 |
| Self-tests | First rollout whose own test run passed, else rollout 1 |
| Diff-only judge | One LLM call sees the issue and K diffs |
| Trajectory aggregator | Plan A |
| Sequential refinement | One rollout refined K times at matched tokens |
| Oracle pass@K | Ceiling |

Primary metric: share of the gap between single run and oracle pass@K that each arm closes, plus total cost.

**Time.** K=4 on 25 tasks is 100 rollouts and 25 aggregations. At roughly 10 minutes per rollout (my assumption) and 8 parallel workers, that is about two hours of wall-clock.

**Stage 2 (optional, about an hour).** Have the aggregator write three contrastive lessons per task, covering where winning and losing trajectories diverged, into `.pi/lessons.md`. Then run held-out tasks from the same repo with and without that file. This is the memory-aware scaling idea from [ReasoningBank](https://arxiv.org/abs/2509.25140), applied to coding trajectories.

**Stop early if** the diff-only judge already closes more than 80% of the oracle gap, or if oracle pass@K minus single run is under 8 points (both thresholds are mine): the first means trajectories add little, the second means the task set has no headroom.

## Plan B: goal-conditioned skim tool

A `skim(path, focus)` tool returns only the lines relevant to a goal the agent states. Build takes 2–3 hours, preceded by a one-hour offline check.

**Idea.** [SWE-Pruner](https://arxiv.org/abs/2601.16746) has the agent state a goal such as "focus on error handling", and a 0.6B skimmer picks which lines to keep. The authors report 23–54% fewer tokens on SWE-Bench Verified without lowering success. The pi packages I found drop stale output, strip comments or return a structural skeleton; none I read conditions on a goal. Here the selector needs no training.

**Build.**

- Register `skim` with `pi.registerTool`, schema `{ path, focus, maxLines }`.
- Selector variant 1: a cheap model called through `ctx.modelRegistry.streamSimple()` returns the line ids to keep, chunk by chunk. Variant 2, zero LLM: BM25 over lines against the focus string.
- Keep three lines of context around each hit, and always keep definition and import lines.
- Return kept lines with their original line numbers and `…[n lines omitted]…` markers, so `read` with an offset can expand them and `edit` anchors stay exact.
- Include the nested call's `usage` in the tool result; pi's docs require this so session totals stay accurate.
- Add a `before_agent_start` prompt section saying to prefer `skim` over `read` for files over about 300 lines.

**Offline check first (about 1 hour, no agent runs).** Mario Zechner publishes his pi sessions through [pi-share-hf](https://github.com/badlogic/pi-share-hf) as a [Hugging Face dataset](https://huggingface.co/datasets/badlogicgames/pi-mono). For each large-file `read` that is later followed by an `edit` on the same file, use the assistant text before the read as the focus string and measure how many later-edited lines the skimmer keeps at a fixed token budget. This proxy is mine, not from the paper: later-edited lines are a lower bound on what mattered.

**Live arms** (same tasks, 2 seeds):

| Arm | Setup |
| --- | --- |
| Stock | Pi with default tools |
| Skeleton | Plus pi-smart-reader |
| Noise filter | Plus pi-token-killer |
| Skim, LLM | Plan B, variant 1 |
| Skim, BM25 | Plan B, variant 2 |

Metrics: success; input tokens including cache reads and writes; tool calls before the first edit; failed `edit` calls from stale or mismatched text.

**Risk.** A model editing from a partial view can break code it never saw. If success drops by more than about 5 points against stock (my threshold), widen the context window around hits before blaming the idea.

## Plan C: trajectory-triggered one-way escalation

Start every task on a cheap model and hand off once to a strong model when the trajectory looks stuck. Build takes 2–3 hours.

**Idea.** In SWE-Router, a cheap model explores for a few turns before a continue-or-restart decision; a [secondary write-up](https://codex.danielvaughan.com/2026/07/10/swe-router-trajectory-based-model-routing-codex-cli-partial-exploration-cost-escalation/) reports diminishing returns beyond three exploration turns. [TACIT-Switch](https://arxiv.org/pdf/2608.27911) frames it as a one-way handoff from the current trajectory. [AgentRouter's slides](https://icml.cc/media/icml-2026/Slides/68040.pdf) warn that a cheap model's subtly wrong intermediate output can corrupt a later strong-model step. The pi routers I found choose tiers by task complexity, and pi's own `jev-router` example runs the other way (strong plan, then cheaper edits).

**Build (about 80 lines).** One virtual model whose `route()` computes features from `request.messages` and latches to the strong model once. The latch lives in `state`, which pi stores per session branch. Because the model only changes when the phase flips, continuation turns stay on one model and keep the prompt cache; the switch costs one cache miss, as in the jev example.

```ts
// Sketch only: check exact types in extensions/types.ts
pi.registerVirtualModel<{ phase: "cheap" | "strong" }>({
  provider: "router", id: "escalate", name: "Escalate",
  route(request, ctx) {
    const phase = request.state?.phase ?? "cheap";
    const next = phase === "cheap" && shouldEscalate(request.messages) ? "strong" : phase;
    const model = ctx.modelRegistry.find(PROVIDER, next === "strong" ? STRONG_ID : CHEAP_ID)!;
    return { model, thinkingLevel: "medium", state: next === phase ? request.state : { phase: next } };
  },
});
```

**Triggers to compare** (each is an arm, next to always-cheap and always-strong):

| Trigger | Fires when |
| --- | --- |
| T1 turn count | Turn 8, unconditionally (naive baseline) |
| T2 repeated error | The same failing command output appears twice |
| T3 edit churn | Three or more edits to one file while tests still fail |
| T4 combined | T2, T3, or context above 60% full |

Metrics: success, cost per task from session `usage`, share of tasks escalated, share of escalated tasks solved, and a cost-versus-success plot against both static tiers.

**Two extra runs.** Hand the strong model the full cheap transcript, then a cleaned one with the cheap model's reasoning removed through a `context` handler, to test the corrupted-context warning.

**Risk.** On long contexts the cache miss at the switch can reprice the whole prefix and erase savings. Log it separately.

## Plan D (stretch): falsifiable harness edits with auto-revert

Let an evolver edit pi's harness files, but require every edit to predict which tasks it fixes, and revert it when the next round disagrees. Build and run take 4–5 hours, at most three rounds.

**Idea.** [AHE](https://arxiv.org/abs/2604.25850) rests on three observability pillars: file-level components, layered trajectory evidence, and a change manifest whose self-declared predictions are checked against the next round. It reports Terminal-Bench 2 pass@1 rising from 69.7% to 77.0% over ten iterations on GPT-5.4, with the frozen harness transferring to SWE-bench Verified and other models. Pi already keeps its harness in files (AGENTS.md, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, skills, extensions), and Prime Agent lets an agent rewrite such state. I did not find a pi system that verifies per-edit predictions and reverts misses.

**The catch.** The [July 2026 rethinking study](https://arxiv.org/pdf/2607.12227) found harness evolution did not consistently beat parallel sampling or sequential refinement at matched budgets on Terminal-Bench 2.1, and generalized poorly to held-out tasks. It saw more promise in long-horizon games. So the control arms are the real experiment here.

**Build.**

- Keep the `.pi/` harness files in a git repo; each round is one commit.
- Evaluator: run 12 tasks twice each in print mode and collect session files and results.
- Evolver: a pi session with read-only access to those session files. It may edit at most three harness files per round and must write `manifest.json` entries of the form `{file, change, predicted_to_fix: [task ids], predicted_risk: [task ids]}`.
- Verifier script: next round, confirm a prediction only if every predicted task passes in both runs and no risk task regresses, then `git revert` the edits that miss. With one run per task, flips are mostly luck, hence two.

**Arms at matched token spend:**

| Arm | What the extra budget buys |
| --- | --- |
| 1. Parallel sampling | Best-of-k with the repo's tests |
| 2. Sequential refinement | Retries with failure feedback |
| 3. Evolution, keep all edits | Evolver edits, no manifest check |
| 4. Evolution with manifest and revert | Plan D |

Show the evolver only tasks 1–12; score tasks 13–24 as held-out.

**Success.** Arm 4 beats arm 3 on held-out tasks and matches or beats arm 1 on cost-adjusted success. If not, the revert mechanism is not paying for itself.

## Shared eval spine

Use one task set and one measurement path for every plan, or the results cannot be compared.

- **Tasks.** Pick 25–30 tasks from Terminal-Bench 2.1 or a SWE-bench Verified subset. Run two cheap seeds first and drop tasks that always pass or never pass, since they carry no signal. Split the rest 50/50 into dev and held-out. Terminal-Bench 2.1 is the 89-task verified revision of 2.0 used in the rethinking study.
- **Runner.** Print-mode pi in containers. [self-evolve-pi](https://github.com/Ralph-Abejuela/self-evolve-pi) ships a Harbor adapter for pi that you can borrow. Reuse its runner, not its conclusions: its reported context savings come from the author's own runs with n=3.
- **Cost.** Sum assistant `usage` and standalone `usage` entries from the session JSONL; they carry cache read and write tokens and cost. Report cost per solved task, not only success.
- **Noise.** At 25 tasks one arm's standard error is about 10 points near 50% success. Compare arms on the same tasks pairwise and rerun only the tasks where arms disagree.
- **Baseline arms, always on.** Stock pi, and stock pi plus context-fold and pi-deadloop. The second mirrors the treatment in [Same Model, Different Harness](https://arxiv.org/pdf/2608.26218): mechanical shortening of older tool results plus a fixed stall detector, with no model calls.
- **Matched budget.** Any arm that spends extra tokens (A, D) gets a parallel-sampling or sequential-refinement control with the same spend.

## Parked ideas

These are real candidates for a second round; each lost to the four plans on novelty, effort or evidence.

- **Sleep-time repo precompute.** After the agent settles, a background run writes a repo map and likely-next-file notes ([Letta's sleep-time compute](https://letta.com/blog/sleep-time-compute)). A secondary summary says gains track how predictable the queries are. Pi's [Dream memory package](https://pi.dev/packages/@pedro_klein/pi-memory) already mines sessions in the background.
- **Live-SWE-agent's reflect step.** [Live-SWE-agent](https://arxiv.org/abs/2511.13646) reports 77.4% on SWE-bench Verified without test-time scaling by letting the agent create tools mid-task. Pi can already register tools at runtime, so this is a one-hour prompt ablation, not a plan.
- **Test-time harness evolution.** [TTHE](https://arxiv.org/abs/2607.08124) refines a population of harnesses on unlabeled traces. It depends on trustworthy proxy signals and is heavier than Plan D.
- **Failure-triggered tree search.** [DARS](https://arxiv.org/pdf/2503.14269) re-samples actions at failure points. Pi's session tree and git worktrees fit it, but extension code cannot navigate the tree automatically, so it needs an SDK driver. Plan A covers the selection half.
- **Trained step verifiers.** SWE-RM and similar reward models need training runs, which breaks the few-hours constraint.

## Caveats

Treat the novelty claims as leads to check, not verdicts.

- **"Not seen" is not "absent".** I read pi.dev package descriptions through a general web search; the catalog listed over 2,000 packages in May. I did not read code. Search pi.dev for each plan's keywords before building.
- **Paper figures come from abstracts and search snippets.** I did not open the PDFs. The SWE-Router and sleep-time numbers come from secondary write-ups.
- **Pi API details come from the docs pages.** Check event payloads, `context_edit` and virtual-model types in `extensions/types.ts` before coding, and note that package READMEs target pi 0.83–0.87.
- **Naming.** Pi now lives at earendil-works/pi under the `@earendil-works` scope. Older posts and docs say badlogic/pi-mono and `@mariozechner/*`; sources disagree on whether the handover was April or May 2026.
- **Thresholds in the plans** (80% oracle gap, 8-point headroom, 5-point success drop) are my starting guesses, not published values.

## Sources

Opened in full: the pi repository README and four docs pages. Everything else was read as search results, as the caveats say.

**Pi docs (opened)**

- [earendil-works/pi README](https://github.com/earendil-works/pi)
- [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Virtual models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md)
- [Session file format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)

**Pi packages and projects (search results)**

- [pi-rlm](https://pi.dev/packages/pi-rlm), [pi-turtle-rlm](https://pi.dev/packages/pi-turtle-rlm), [@hicaru/pi-rlm](https://pi.dev/packages/@hicaru/pi-rlm)
- [@narumitw/pi-subagents](https://pi.dev/packages/@narumitw/pi-subagents), [@agwab/pi-subagent](https://pi.dev/packages/@agwab/pi-subagent)
- [pi-navigator](https://pi.dev/packages/pi-navigator), [pi-fold](https://pi.dev/packages/pi-fold), [context-fold](https://pi.dev/packages/context-fold), [pi-auto-trees](https://pi.dev/packages/@howaboua/pi-auto-trees), [pi-slipstream-compact](https://pi.dev/packages/pi-slipstream-compact)
- [@samfp/pi-memory](https://pi.dev/packages/@samfp/pi-memory), [@pedro\_klein/pi-memory](https://pi.dev/packages/@pedro_klein/pi-memory)
- [pi-dynamic-context-pruning](https://pi.dev/packages/pi-dynamic-context-pruning), [pi-token-killer](https://pi.dev/packages/pi-token-killer), [pi-smart-reader](https://pi.dev/packages/pi-smart-reader), [pi-deadloop](https://pi.dev/packages/pi-deadloop)
- [pi-model-router](https://pi.dev/packages/@kdejaeger/pi-model-router), [cortiq-pi-router](https://pi.dev/packages/cortiq-pi-router)
- [pi-reason-harness](https://pi.dev/packages/pi-reason-harness), [self-evolve-pi](https://github.com/Ralph-Abejuela/self-evolve-pi), [Prime Agent blog](https://primeintellect.ai/blog/prime-agent), [pi-share-hf](https://github.com/badlogic/pi-share-hf)

**Papers (abstracts via search)**

- [ACE](https://arxiv.org/abs/2510.04618), [ReasoningBank](https://arxiv.org/abs/2509.25140), [Context-Folding](https://arxiv.org/abs/2510.11967), [Recursive Language Models](https://arxiv.org/abs/2512.24601)
- [AggAgent](https://arxiv.org/abs/2604.11753), [SWE-Pruner](https://arxiv.org/abs/2601.16746), [TACIT-Switch](https://arxiv.org/pdf/2608.27911)
- [Meta-Harness](https://arxiv.org/abs/2603.28052), [AHE](https://arxiv.org/abs/2604.25850), [TTHE](https://arxiv.org/abs/2607.08124), [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954), [Live-SWE-agent](https://arxiv.org/abs/2511.13646), [ContextEvo](https://arxiv.org/pdf/2609.34649)
- [Rethinking the Evaluation of Harness Evolution](https://arxiv.org/pdf/2607.12227), [Same Model, Different Harness](https://arxiv.org/pdf/2608.26218), [DARS](https://arxiv.org/pdf/2503.14269)
