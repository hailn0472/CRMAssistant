#!/bin/bash
set -euo pipefail

# The repo does not yet maintain a stable changed-file-to-test mapping.
# Run the full package-level test suite to avoid false confidence.
pnpm test
