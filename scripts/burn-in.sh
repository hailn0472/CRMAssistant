#!/bin/bash
set -euo pipefail

command_to_run="${1:-pnpm test:e2e}"
iterations="${2:-10}"

for iteration in $(seq 1 "$iterations"); do
  echo "Burn-in iteration ${iteration}/${iterations}: ${command_to_run}"
  bash -lc "$command_to_run" || exit 1
done
