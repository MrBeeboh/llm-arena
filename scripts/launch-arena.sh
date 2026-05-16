#!/usr/bin/env bash
# Desktop entry: pull latest, recycle Arena dev processes, start fresh.
# Opens the browser automatically after startup.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
LOG="${ARENA_LOG:-$ROOT/.arena-dev.log}"
PIDFILE="$ROOT/.arena-dev.pid"
ICON="$ROOT/assets/arena-icon.png"

# --- Desktop notification helper ---
_notify() {
  local msg="$1" urgency="${2:-normal}"
  command -v notify-send >/dev/null 2>&1 && \
    notify-send -i "$ICON" -u "$urgency" -t 5000 "Arena" "$msg" 2>/dev/null || true
}

echo "$(date -Is) Launcher starting (HOME=$HOME PATH=$PATH)" >>"$LOG"

# --- Find node/npm ---
for cand in \
  /home/mike/.nvm/versions/node/v22.22.2/bin \
  "$HOME/.nvm/versions/node/v22.22.2/bin" \
  /usr/local/bin \
  ; do
  [ -d "$cand" ] && export PATH="$cand:$PATH"
done

[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" || true

if ! command -v node >/dev/null 2>&1; then
  echo "$(date -Is) ERROR: node not found. PATH=$PATH" >>"$LOG"
  _notify "ERROR: node not found — Arena cannot start" critical
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
  [ $_setvars_rc -ne 0 ] && echo "$(date -Is) WARNING: setvars.sh failed (rc=$_setvars_rc), continuing" >>"$LOG"
else
  echo "$(date -Is) Skipping setvars (ARENA_NO_SETVARS=${ARENA_NO_SETVARS:-unset})" >>"$LOG"
fi

# --- Pull latest code ---
_notify "Updating Arena..."
echo "$(date -Is) git pull --ff-only ..." >>"$LOG"
if git -C "$ROOT" pull --ff-only >>"$LOG" 2>&1; then
  echo "$(date -Is) git pull OK" >>"$LOG"
  _notify "Code up to date. Starting server..."
else
  echo "$(date -Is) WARNING: git pull failed, continuing with current version" >>"$LOG"
  _notify "Could not update — starting current version" low
fi

# --- Kill any stale Arena processes ---
if [ "${ARENA_LAUNCH_NO_KILL:-}" != "1" ]; then
  node "$ROOT/scripts/restart.mjs" --kill >>"$LOG" 2>&1 || true
fi

# --- Start the dev server ---
touch "$LOG"
nohup npm run dev >>"$LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PIDFILE"
echo "$(date -Is) Started Arena (pid $SERVER_PID)" >>"$LOG"

# --- Wait for server to respond, then notify + open browser ---
VITE_DEV_PORT="${VITE_DEV_PORT:-5173}"
URL="${ARENA_URL:-http://127.0.0.1:${VITE_DEV_PORT}}"
(
  for i in $(seq 1 30); do
    sleep 2
    if curl -sf --max-time 1 "$URL" >/dev/null 2>&1; then
      _notify "Arena is ready — opening browser"
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      elif command -v open >/dev/null 2>&1; then
        open "$URL" >/dev/null 2>&1 || true
      fi
      echo "$(date -Is) Server ready after $((i*2))s, browser opened" >>"$LOG"
      exit 0
    fi
  done
  _notify "Arena server did not respond after 60s — check log at $LOG" critical
  echo "$(date -Is) ERROR: server never became ready" >>"$LOG"
) &

exit 0
