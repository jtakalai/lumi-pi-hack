# pitok

Token usage monitor for [pi](https://github.com/earendil-works/pi) sessions.
A single Python 3 script, stdlib only, no dependencies. Read-only — it never
modifies session data.

pi records `model`, `provider`, full `usage` (input / output / cacheRead /
cacheWrite / totalTokens / cost) and a timestamp on every assistant message
in its JSONL session files, plus standalone `usage` entries (e.g. cache
warming) and, for sessions renamed in the `/resume` picker, a `session_info`
entry carrying the name. pitok reads those files and answers: **how many
tokens did a session use, per model, and at what time — and what is it
called?**

## Quick start

```bash
cd pitok
./install.sh        # or: cp pitok ~/.local/bin/  (any dir on your PATH)
pitok               # summarize all sessions, newest first
```

```
SESSION                                  REQUESTS       IN      OUT   CACHE_R   CACHE_W     TOTAL      COST  NAME                      MODELS
2026-10-21 11:06:52 01a15d7f                   19   328.4k    16.1k         0         0    344.4k        $0  pitok_creation            Qwen3.8-27B
2026-10-18 12:16:42 01a14e4c                  235   27.95M   371.5k         0         0    28.32M        $0  -                         Qwen3.8-27B
...
TOTAL                                       1251  119.68M    1.42M         0         0   121.10M        $0
```

## Usage

```
pitok                      # all sessions: requests, tokens, cost, models
pitok <session.jsonl>      # one session: per-request timeline + per-model breakdown
pitok --watch [SECS]       # live: refresh the most recent session in place (Ctrl-C stops)
```

The table is sorted by session start date, newest first. Use
`--sort tokens` for biggest-total-first ordering. The NAME column shows the
session name as set in pi's `/resume` picker (`-` for unnamed sessions); the
detail view and the JSON log carry it too. If a session is renamed several
times, the latest name wins.

One-session detail view shows which model answered when, with a running total:

```
TIME                 MODEL               IN     OUT  ...        CUM
2026-10-21 11:41:11  Qwen/Qwen3.8-27B  22.4k    64  ...     188.8k
2026-10-21 11:41:59  Qwen/Qwen3.8-27B  24.6k   148  ...     262.3k

per model:
  Qwen/Qwen3.8-27B                    16 req  ...  total    262.3k  $0
```

(the detail view header shows `session`, `name`, `cwd`, `window`, `models`.)

### Options

| Flag | Meaning |
| --- | --- |
| `--all` | Count every branch, not just the active one (pi sessions are trees; default counts only the branch currently live, matching what the context actually contained) |
| `--sort {date,tokens}` | Table ordering: `date` (default) = newest session first, `tokens` = biggest total first |
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
{"scanned_at": "...", "session": "/.../....jsonl", "name": "pitok_creation",
 "cwd": "/home/aare",
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
