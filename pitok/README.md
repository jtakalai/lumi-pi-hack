# pitok

Token usage monitor for [pi](https://github.com/earendil-works/pi) sessions.
A single Python 3 script, stdlib only, no dependencies. Read-only — it never
modifies session data.

pi records `model`, `provider`, full `usage` (input / output / cacheRead /
cacheWrite / totalTokens / cost) and a timestamp on every assistant message
in its JSONL session files, plus standalone `usage` entries (e.g. cache
warming). pitok reads those files and answers: **how many tokens did a
session use, per model, and at what time?**

## Quick start

```bash
cd pitok
./install.sh        # or: cp pitok ~/.local/bin/  (any dir on your PATH)
pitok               # summarize all sessions, sorted by tokens
```

```
SESSION                                  REQUESTS       IN      OUT   CACHE_R   CACHE_W     TOTAL      COST  MODELS
2026-10-16 17:41:13 01a14528                  421   56.02M   358.6k         0         0    56.38M        $0  Qwen3.8-27B
...
TOTAL                                       1251  119.68M    1.42M         0         0   121.10M        $0
```

## Usage

```
pitok                      # all sessions: requests, tokens, cost, models
pitok <session.jsonl>      # one session: per-request timeline + per-model breakdown
pitok --watch [SECS]       # live: refresh the most recent session in place (Ctrl-C stops)
```

One-session detail view shows which model answered when, with a running total:

```
TIME                 MODEL               IN     OUT  ...        CUM
2026-10-21 11:41:11  Qwen/Qwen3.8-27B  22.4k    64  ...     188.8k
2026-10-21 11:41:59  Qwen/Qwen3.8-27B  24.6k   148  ...     262.3k

per model:
  Qwen/Qwen3.8-27B                    16 req  ...  total    262.3k  $0
```

### Options

| Flag | Meaning |
| --- | --- |
| `--all` | Count every branch, not just the active one (pi sessions are trees; default counts only the branch currently live, matching what the context actually contained) |
| `--json` | Machine-readable output |
| `--no-log` | Don't append to the usage log |
| `--quiet` | No table, log only (for cron) |
| `--log-file PATH` | Where to write the usage log |
| `--sessions-dir PATH` | Where pi keeps session files (see below) |

## Logging

Every summary run appends one JSON line per session to the log file
(default `~/.pi/toklog/pitok.jsonl`, override with `PITOK_LOG` or
`--log-file`):

```json
{"scanned_at": "...", "session": "/.../....jsonl", "cwd": "/home/aare",
 "started": "...", "requests": 16,
 "total": {"input": 247900, "output": 14400, "cacheRead": 0,
           "cacheWrite": 0, "total": 262300, "cost": 0.0, "requests": 16},
 "by_model": {"Qwen/Qwen3.8-27B": {"input": ..., "total": ...}}}
```

To build a time series (e.g. "how much did the session grow per hour"),
let cron scan periodically:

```cron
*/30 * * * * /path/to/pitok --quiet
```

The log is JSONL: query it with `jq` or any language.

## Where it finds pi's data

First match wins:

1. `--sessions-dir PATH`
2. `$PITOK_SESSIONS_DIR`
3. `$PI_CODING_AGENT_DIR/sessions` — pi's own agent-dir override
4. `~/.pi/agent/sessions` — pi's default

So it works as-is wherever pi runs, including setups that relocate pi's
agent directory.

## Setup

Requirements: Python 3.9+ and pi installed (anywhere).

**Option A — installer** (copies to `~/.pi/agent/bin`, symlinks into
`~/.local/bin`, adds `~/.pi/agent/bin` to `PATH` in `~/.bashrc` if missing):

```bash
./install.sh
```

**Option B — manual:**

```bash
cp pitok ~/.local/bin/ && chmod +x ~/.local/bin/pitok
# or, to share pi's tool dir:
cp pitok ~/.pi/agent/bin/ && chmod +x ~/.pi/agent/bin/pitok
```

Then make sure the install dir is on your `PATH`
(`export PATH="$HOME/.local/bin:$PATH"` in `~/.bashrc` is enough for
option B's first form).

If your shell can't find `pitok` after installing in an already-open
terminal, the `~/.local/bin` symlink (option A) takes effect immediately;
otherwise open a new terminal.

## Notes

- Local models (e.g. vLLM) usually report `cost: 0`; hosted providers
  (Anthropic, OpenAI, ...) fill the COST column automatically.
- `cacheRead`/`cacheWrite` are pi's usage fields for prompt-cache hits and
  writes; they show 0 for providers that don't report them.
