#!/usr/bin/env bash
# Desktop entry: recycle Arena dev processes, apply oneAPI env, start fresh.
# Opens the browser automatically after startup.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
LOG="${ARENA_LOG:-$ROOT/.arena-dev.log}"
PIDFILE="$ROOT/.arena-dev.pid"

# Log startup attempt
echo "$(date -Is) Launcher starting (HOME=$HOME PATH=$PATH)" >>"$LOG"

# --- Find node/npm ---
# Try common locations before resorting to nvm/fnm
for cand in \
  /home/mike/.nvm/versions/node/v22.22.2/bin \
  "$HOME/.nvm/versions/node/v22.22.2/bin" \
  /usr/local/bin \
  ; do
  [ -d "$cand" ] && export PATH="$cand:$PATH"
done

# Sourcing nvm if available (provides node/npm aliases)
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" || true

if ! command -v node >/dev/null 2>&1; then
  echo "$(date -Is) ERROR: node not found. PATH=$PATH" >>"$LOG"
  exit 1
fi

# --- Intel oneAPI for SYCL llama-server ---
if [ "${ARENA_NO_SETVARS:-}" != "1" ] && [ -f /opt/intel/oneapi/setvars.sh ]; then
  echo "$(date -Is) Sourcing setvars.sh..." >>"$LOG"
  set +eu
  source /opt/intel/oneapi/setvars.sh --force >>"$LOG" 2>&1
  _setvars_rc=$?
  set -eu
  echo "$(date -Is) setvars.sh returned $_setvars_rc" >>"$LOG"
  if [ $_setvars_rc -ne 0 ]; then
    echo "$(date -Is) WARNING: setvars.sh failed (rc=$_setvars_rc), continuing" >>"$LOG"
  fi
else
  echo "$(date -Is) Skipping setvars (ARENA_NO_SETVARS=$ARENA_NO_SETVARS)" >>"$LOG"
fi

# --- Kill any stale Arena processes ---
if [ "${ARENA_LAUNCH_NO_KILL:-}" != "1" ]; then
  node "$ROOT/scripts/restart.mjs" --kill >>"$LOG" 2>&1 || true
fi

# --- Start the dev server ---
touch "$LOG"
nohup npm run dev >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "$(date -Is) Started Arena (pid $!)" >>"$LOG"

# --- Open browser after a short delay ---
VITE_DEV_PORT="${VITE_DEV_PORT:-5173}"
URL="${ARENA_URL:-http://127.0.0.1:${VITE_DEV_PORT}}"
DELAY="${ARENA_BROWSER_DELAY:-6}"
(
  sleep "$DELAY"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || echo "$(date -Is) WARNING: xdg-open failed for $URL" >>"$LOG"
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || echo "$(date -Is) WARNING: open failed for $URL" >>"$LOG"
  fi
) &

exit 0
