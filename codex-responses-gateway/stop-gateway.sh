#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
gateway_script="$script_dir/gateway.mjs"
pid_file="$script_dir/gateway.pid"

if [ ! -f "$pid_file" ]; then
  echo "Gateway is not running (PID file not found)."
  exit 0
fi

gateway_pid=$(cat "$pid_file")
case "$gateway_pid" in
  ''|*[!0-9]*)
    echo "Invalid PID file; removing it." >&2
    rm -f "$pid_file"
    exit 1
    ;;
esac

process_command=$(ps -p "$gateway_pid" -o command= 2>/dev/null || true)
case "$process_command" in
  *"$gateway_script"*)
    ;;
  '')
    echo "Gateway process is already stopped."
    rm -f "$pid_file"
    exit 0
    ;;
  *)
    echo "PID file does not belong to this gateway; refusing to stop another process." >&2
    echo "PID: $gateway_pid" >&2
    echo "Command: $process_command" >&2
    exit 1
    ;;
esac

kill "$gateway_pid"

stopped=0
for wait_step in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    stopped=1
    break
  fi
  sleep 0.1
done

if [ "$stopped" -eq 1 ]; then
  rm -f "$pid_file"
  echo "Gateway stopped (PID $gateway_pid)"
else
  echo "Gateway did not exit within 2 seconds; PID file was kept: $pid_file" >&2
  exit 1
fi
