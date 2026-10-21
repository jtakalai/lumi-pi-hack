#!/bin/sh
set -eu

export PI_HANDOFF_CHEAP="google/gemma-3-27b-it"
export PI_HANDOFF_STRONG="openai/gpt-oss-120b"

exec pi \
  -e ./extensions/pi-trajectory/index.ts \
  -e ./extensions/pi-episodes/index.ts \
  -e ./extensions/pi-handoff/index.ts \
  --model handoff/auto \
  "$@"