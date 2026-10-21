# trajectory-triggered escalation

## Usage

Make sure the `pi` CLI is installed and your provider credentials are
configured as usual. Set the cheap and strong model IDs to models available in
your Pi catalog, then start Pi with the local extensions:

```bash
./start.sh
```

Replace the model IDs with your provider's `provider/model-id` values. The
script loads the extensions directly from this checkout and accepts additional
Pi CLI arguments, for example `./start.sh --help`. The model IDs can also be
set with `--handoff-cheap` and `--handoff-strong`, or in
`extensions/pi-handoff/handoff.config.json` (see the example config).


# Planning

## 1. Overall Goal

Reduce the overall token consumption and inference cost of LLM agents executing heterogeneous, multi-hop workflows, while preserving task success and completion quality.

The system should avoid using strong, expensive models for routine operations, but should also prevent cheap models from wasting large amounts of computation on difficult or stalled tasks.

**Primary idea:** Start each task episode with a cheap model, accumulate observable evidence of execution difficulty, and permanently escalate to a strong model when a risk threshold is crossed. At the next episode boundary, release the strong model and return to cheap execution.

The extension remains active throughout the entire workflow.

### Optimization objectives

- **Primary:** Reduce total token consumption across the complete workflow, with task success held approximately constant.
- **Secondary:** Reduce strong-model token usage and total API cost.
- **Constraints:** Avoid substantial reductions in success rate, excessive model switching and repeated failed attempts.

Reducing strong-model usage does not automatically reduce total token count. Both metrics must be measured independently.

## 2. Positioning and Related Work

### pi-model-router

The existing `@kdejaeger/pi-model-router` dynamically selects model tiers using task classification, tool feedback, context usage and fallback rules.

pi-handoff does not claim to introduce dynamic routing or failure-triggered reclassification.

Instead, it investigates a more constrained policy:

**A cheap model remains responsible until the accumulated execution risk justifies a permanent handoff for the remainder of the current episode.**

Three distinctive design choices:

1. **Trajectory accumulation:** Decisions depend on accumulated execution evidence, rather than solely the latest classification.
2. **Episode-level commitment:** An escalation remains active until the episode ends, instead of allowing unrestricted model reassessment.
3. **Workflow-level release:** The system returns to cheap execution at a new episode boundary, so strong-model usage does not unnecessarily persist across unrelated or easier subtasks.

The resulting system provides a simpler control policy whose effectiveness can be evaluated against general-purpose per-turn routers.

### TACIT-Switch

The project draws inspiration from TACIT-Switch's cumulative-risk formulation and permanent-handoff policy.

Unlike TACIT-Switch, the MVP does not train a mixture-cure threshold model or use teacher-annotated intervention windows.

It implements a transparent, manually parameterized cumulative-risk heuristic and calibrates its threshold on development tasks.

This is a lightweight engineering adaptation, not a reproduction of the complete TACIT-Switch algorithm.

## 3. Core Policy

### 3.1 Episode state machine

Each episode has two execution states:

- `CHEAP`: Cheap model executes and trajectory risk accumulates.
- `STRONG_LOCKED`: Strong model owns the remaining execution of the episode.

At a valid episode boundary:

- Finalize the current episode.
- Reset accumulated risk.
- Clear the strong-model lock.
- Start the next episode with Cheap.

No automatic downgrade occurs within an unfinished episode.

### 3.2 Risk accumulation

Inspired by TACIT-Switch, define:

\[
r_t = w^\top u_t,\qquad R_t = \sum_{s=1}^{t}r_s
\]

Where \(u_t\) is a vector of observable execution diagnostics.

For the MVP, use three inexpensive signals:

| Signal | Description |
|---|---|
| Repeated failure | A normalized failure signature reappears without intervening progress |
| Edit churn | Repeated modifications to the same file without measurable improvement |
| Stalled progress | Repeated actions or unsuccessful tests with no observed progress |

All features are nonnegative. The accumulated risk is monotonic within each episode.

Escalation occurs when:

\[
R_t \geq \theta
\]

The threshold and feature weights are fixed after development-set calibration.

No online LLM classifier is required.

### 3.3 Episode boundary detection

The system must distinguish a Pi Session, a user message and a logical task episode.

Use the following boundary mechanisms, in priority order:

1. Explicit workflow or benchmark step-completion markers.
2. User-issued commands, such as `/handoff next` or `/handoff reset`.
3. In conversational mode, an agent run that has settled followed by a new user task, using a documented default policy.

The MVP must not claim to reliably discover arbitrary subtask boundaries from natural-language trajectories.

For single-prompt autonomous workflows without explicit intermediate boundaries, the strong-model lock remains active until the entire episode completes.

Automatic semantic subtask segmentation is outside the initial scope.

### 3.4 Handoff mechanism

The strong model receives the existing conversation and workspace state through Pi's normal request routing.

The first implementation uses full-context continuation. No separate context summarization, transcript rewriting, rollback or restart strategy is required.

This keeps the experimental question focused on **when to hand off and when to release**.

## 4. Pi Extension Collection

Maintain a small collection of interoperable Pi extensions within a single repository.

### A. `pi-handoff` — Core Router

**Purpose:** Implement the always-on model handoff policy.

Expected capabilities:

- Register one selectable virtual model, `handoff/auto`.
- Configure Cheap and Strong physical models.
- Maintain the episode-level state machine.
- Consume trajectory risk measurements.
- Trigger and persist one-way escalation.
- Return to Cheap at a valid episode boundary.
- Expose routing status and basic configuration.

Expected demo:

An agent starts on Cheap, encounters repeated unresolved errors, escalates to Strong, completes the difficult episode and starts the next episode on Cheap.

This is the primary user-facing extension and the only component responsible for model dispatch.

### B. `pi-trajectory` — Execution Signal Observer

**Purpose:** Collect reusable trajectory diagnostics without invoking another LLM.

Expected capabilities:

- Observe tool calls, tool results and edit operations.
- Normalize repeated command failures.
- Track repeated edits and basic test progress.
- Produce compact, structured trajectory-risk features.
- Optionally export diagnostics for offline analysis.

Expected demo:

Show a trajectory timeline with detected repeated failures, edit churn and changes in cumulative risk.

The observer should not select or change models.

### C. `pi-episodes` — Workflow Boundary Controller

**Purpose:** Define and signal episode boundaries independently from the routing algorithm.

Expected capabilities:

- Accept explicit workflow step markers.
- Provide manual episode-reset commands.
- Support basic user-turn boundary policies.
- Emit boundary events consumed by `pi-handoff`.
- Maintain episode identifiers for evaluation.

Expected demo:

Run one Pi Session containing three logically separate subtasks. Escalation in the second subtask must not force the third to begin on Strong.

This extension is especially important for multi-hop workflow demonstrations. Its first version should use deterministic, explicit boundaries.

### D. `pi-ledger` — Token and Handoff Accounting

**Purpose:** Provide reproducible metrics for token consumption and switching overhead.

Expected capabilities:

- Attribute usage to Cheap and Strong.
- Track input, output, cache-read and cache-write tokens separately.
- Calculate API cost using recorded prices.
- Identify handoff events and model transitions.
- Export episode-level and workflow-level JSONL or CSV summaries.

Expected demo:

Generate a report showing how many tokens were consumed by each model, how often escalation happened, and the corresponding costs.

### E. `pi-handoff-lab` — Evaluation Harness

**Type:** Companion benchmark tooling, not necessarily a Pi extension.

Expected capabilities:

- Run predefined workflows in isolated environments.
- Launch Pi with selected extensions and policy configurations.
- Repeat tasks under identical budgets and resource limits.
- Collect correctness scores and telemetry.
- Generate comparative plots and aggregate results.

Expected demo:

Run one benchmark workflow using Always-Cheap, Always-Strong, fixed-prefix escalation and pi-handoff, then compare their token consumption and outcomes.

### Repository organization

```text
pi-handoff/
├── extensions/
│   ├── pi-handoff/
│   ├── pi-trajectory/
│   ├── pi-episodes/
│   └── pi-ledger/
├── packages/
│   └── shared/
├── benchmarks/
│   ├── runner/
│   ├── tasks/
│   └── analysis/
├── examples/
│   └── multi-hop-demo/
└── README.md
```

Extensions share small, documented event and data contracts. They should not each register competing model routers.

For the first working prototype, the core router can implement minimal signal extraction and boundary handling internally. Extraction into separate packages should happen once the interfaces are stable.

## 5. Evaluation

### 5.1 Research questions

**RQ1:** Can a simple cumulative-risk policy reduce strong-model usage and inference cost while preserving task success?

**RQ2:** Does trajectory-triggered escalation outperform fixed-prefix escalation?

**RQ3:** Does releasing the strong model at episode boundaries improve efficiency in heterogeneous, multi-hop workflows?

Only one proposed routing policy is implemented. Baseline conditions are static configurations or existing implementations.

### 5.2 Baselines

| Arm | Behavior |
|---|---|
| B0 — Always Cheap | All episodes use Cheap |
| B1 — Always Strong | All episodes use Strong |
| B2 — Fixed Prefix | Escalate after a predetermined number of requests |
| B3 — pi-model-router | Use its documented dynamic classification mechanism |
| P — pi-handoff | Accumulated risk, one-way episode handoff, boundary reset |

B3 should be included when the existing package can be run reproducibly on a compatible Pi version. Its classifier usage must be counted.

### 5.3 Workloads

Use two complementary evaluation settings.

**A. Coding-task benchmark**

Use a selected Terminal-Bench or SWE-bench subset to test episode-level escalation on realistic coding and debugging tasks.

These tasks primarily measure the quality of the handoff decision itself.

**B. Mixed-complexity workflow benchmark**

Construct reproducible workflows containing easy and difficult steps, for example:

1. Inspect an unfamiliar repository.
2. Diagnose and fix a nontrivial failure.
3. Update straightforward configuration or documentation.
4. Perform another validation or debugging operation.

Preserve dependencies between steps, and define episode boundaries before evaluation.

This setting measures the full Workflow-level benefit of releasing Strong after a difficult episode.

Use identical tasks, environments, stopping criteria and token budgets for every arm. Avoid excluding tasks solely because one model always succeeds or always fails.

### 5.4 Metrics

**Primary metrics**

- Total input and output tokens per completed workflow.
- Task and workflow success rate.
- Total API cost.
- Cost per successful workflow.

**Diagnostic metrics**

- Strong-model token share.
- Percentage of episodes escalated.
- Average escalation checkpoint.
- Tokens spent before escalation.
- Prompt-cache read/write usage.
- Additional tokens and cost attributable to model switching.
- Number of model transitions per workflow.
- Successful recovery following escalation.
- Latency and time to completion.

Cache accounting must distinguish logical token volume from the financial effect of discounted cached tokens.

### 5.5 Experimental procedure

1. Validate the router, boundary controller and telemetry using small deterministic test trajectories.
2. Select a development set and a disjoint held-out test set.
3. Calibrate one cumulative-risk threshold using only the development set.
4. Run all baseline and proposed configurations on the same held-out tasks.
5. Compare paired success outcomes, total tokens, cost and escalation behavior.
6. Analyze cases where pi-handoff escalated unnecessarily, too late, or failed to escalate.

A pilot of approximately 8–12 tasks is sufficient for infrastructure validation. A 25–30 task main sample is appropriate for exploratory comparison, but larger samples or repeated runs may be required for statistically meaningful conclusions.

## 6. MVP Scope and Non-Goals

### Must implement

- One Cheap model and one Strong model.
- One cumulative-risk rule.
- One-way escalation within an episode.
- Explicit episode reset and Strong-to-Cheap release.
- Full-context handoff.
- Reproducible token and cost measurements.
- One multi-hop workflow demonstration.

### Explicitly out of scope

- Learning TACIT-Switch's censored-supervision model.
- Training a routing classifier or reward model.
- Arbitrary step-level Cheap/Strong oscillation.
- Automatic semantic task decomposition.
- Multi-tier routing across three or more models.
- Complex context rewriting or transcript cleaning.
- Additional handoff algorithms.

## 7. Success Criteria

The system is technically successful if it can:

1. Stay active across a multi-episode workflow without requiring manual model selection.
2. Escalate exactly once within a stalled episode.
3. Preserve the Strong lock while that episode continues.
4. Release the lock at an explicit boundary.
5. Correctly return to Cheap for the next episode.
6. Attribute tokens and inference costs to the appropriate models and episodes.

The research outcome is determined empirically.

A positive result would demonstrate lower overall token consumption or inference cost at comparable task success. A negative result would clarify where risk signals, late escalation or cache losses make the strategy ineffective.

The intended contribution is a compact, interpretable and experimentally validated handoff mechanism for persistent coding-agent workflows.

**Pi docs (opened)**

- [earendil-works/pi README](https://github.com/earendil-works/pi)
- [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Virtual models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md)
- [Session file format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)

**Pi packages and projects (search results)**

- [pi-model-router](https://pi.dev/packages/@kdejaeger/pi-model-router), [cortiq-pi-router](https://pi.dev/packages/cortiq-pi-router)

**Papers (abstracts via search)**

- [TACIT-Switch](https://arxiv.org/pdf/2608.27911)


### 8. Running Tests

#### 8.1 TypeScript Extension Deterministic Tests (`pi-handoff`, `pi-trajectory`, `pi-episodes`)

Run the scripted suite verifying state transitions, trajectory risk observation, and boundary controls using a mocked Pi runtime:

```bash
npm test

uv run pytest -v test/test_pitok_and_eval.py
```

### Benchmark Tasks Setup & Evaluation

#### 1. Setup and Reset Benchmark Tasks

To generate or restore the 10 progressive benchmark tasks to their initial failing state, run:

```bash
python3 reset_benchmark.py
```

#### 2. Example Prompt for the LLM Agent
Provide the following prompt directly in the pi interface to test the agent and trajectory-triggered escalation:
```
Run pytest benchmark_tasks/task_01/test_solution.py. Inspect the failure, edit benchmark_tasks/task_01/solution.py to fix the bug, and keep running tests until all tests pass.
```