#!/bin/sh
set -eu

export PI_HANDOFF_CHEAP="google/gemma-3-27b-it"
export PI_HANDOFF_STRONG="openai/gpt-oss-120b"
# pi-ledger tier labels (optional; same refs as the router):
export PI_LEDGER_CHEAP="${PI_HANDOFF_CHEAP}"
export PI_LEDGER_STRONG="${PI_HANDOFF_STRONG}"

exec pi \
  -e ./extensions/pi-trajectory/index.ts \
  -e ./extensions/pi-episodes/index.ts \
  -e ./extensions/pi-handoff/index.ts \
  -e ./extensions/pi-ledger/index.ts \
  --model handoff/auto \
  "$@"