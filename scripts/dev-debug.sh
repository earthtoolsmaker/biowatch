#!/usr/bin/env bash
#
# Launch the Biowatch dev app wired for sequence-worker OOM troubleshooting:
#   - exposes the Chrome DevTools Protocol port so scripts/repro-seq-oom.mjs can
#     attach over CDP (see docs/troubleshooting.md "Explore tab OOM").
#   - optionally caps the sequences worker's V8 old-space heap so the OOM is
#     reproducible on machines with lots of RAM (where the default ~4GB ceiling
#     hides it). The cap is read by src/main/services/sequences/runInWorker.js.
#
# The dev port cannot be enabled on an already-running renderer, so this first
# stops any existing dev/electron instances of THIS project, then relaunches.
#
# Usage:
#   scripts/dev-debug.sh              # cap 950MB, port 9222 (defaults)
#   CAP=1200 PORT=9333 scripts/dev-debug.sh
#   CAP=0 scripts/dev-debug.sh        # no heap cap (default 4GB ceiling)
#
# Runs in the foreground; Ctrl-C to stop. Then in another shell:
#   node scripts/repro-seq-oom.mjs <studyId>
set -euo pipefail

CAP="${CAP:-950}"
PORT="${PORT:-9222}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

echo "→ Stopping existing dev/electron instances of this project..."
# Match only processes belonging to this repo's node_modules to avoid touching
# unrelated Electron apps.
pkill -9 -f "${ROOT}/node_modules/.bin/electron-vite" 2>/dev/null || true
pkill -9 -f "${ROOT}/node_modules/electron/dist/electron" 2>/dev/null || true

# Wait for the debug port to free up (max ~10s).
for _ in $(seq 1 10); do
  if curl -s --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    sleep 1
  else
    break
  fi
done

if [ "${CAP}" -gt 0 ]; then
  echo "→ Launching dev: worker heap cap=${CAP}MB, CDP port=${PORT}"
  export SEQ_WORKER_MAX_OLD_MB="${CAP}"
else
  echo "→ Launching dev: no worker heap cap, CDP port=${PORT}"
fi

cd "${ROOT}"
exec npm run dev -- --remoteDebuggingPort "${PORT}"
