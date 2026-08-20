#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
gateway_script="$script_dir/gateway.mjs"
pid_file="$script_dir/gateway.pid"
log_file="$script_dir/gateway.log"
node_bin=${NODE_BIN:-node}

if [ ! -f "$gateway_script" ]; then
  echo "Gateway script not found: $gateway_script" >&2
  exit 1
fi

if [ ! -f "$script_dir/.env" ] && [ -z "${CODEX_GATEWAY_API_KEY:-}" ]; then
  echo "Missing .env. Copy .env.example to .env and fill in the gateway/upstream keys first." >&2
  exit 1
fi

if [ -f "$pid_file" ]; then
  gateway_pid=$(cat "$pid_file")
  case "$gateway_pid" in
    ''|*[!0-9]*)
      echo "Removing invalid PID file: $pid_file" >&2
      rm -f "$pid_file"
      ;;
    *)
      process_command=$(ps -p "$gateway_pid" -o command= 2>/dev/null || true)
      case "$process_command" in
        *"$gateway_script"*)
          echo "Gateway is already running (PID $gateway_pid)"
          exit 0
          ;;
        '')
          rm -f "$pid_file"
          ;;
        *)
          echo "PID file points to another process; refusing to start." >&2
          echo "PID: $gateway_pid" >&2
          echo "Command: $process_command" >&2
          exit 1
          ;;
      esac
      ;;
  esac
fi

nohup "$node_bin" "$gateway_script" >>"$log_file" 2>&1 < /dev/null &
gateway_pid=$!
printf '%s\n' "$gateway_pid" > "$pid_file"

sleep 1
if ! kill -0 "$gateway_pid" 2>/dev/null; then
  echo "Gateway failed to start. Recent log output:" >&2
  tail -n 20 "$log_file" >&2 || true
  rm -f "$pid_file"
  exit 1
fi

echo "Gateway started (PID $gateway_pid)"
echo "Log: $log_file"
