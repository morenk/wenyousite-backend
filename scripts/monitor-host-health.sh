#!/usr/bin/env bash
# 每分钟采集一次宿主机 I/O 与 API 健康；仅异常时向 journal 输出脱敏汇总。

set -uo pipefail

PSI_WARN="${WENYOU_IO_PSI_FULL_AVG10_WARN:-20}"
AWAIT_WARN_MS="${WENYOU_DISK_AWAIT_WARN_MS:-100}"
HEALTH_WARN_MS="${WENYOU_HEALTH_WARN_MS:-2000}"
HEALTH_URL="${WENYOU_HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"
BACKEND_UNIT="${WENYOU_BACKEND_UNIT:-wenyousite-backend.service}"

number_ge() {
  awk -v value="$1" -v threshold="$2" 'BEGIN { exit !(value + 0 >= threshold + 0) }'
}

psi_full_avg10() {
  if [[ -n "${WENYOU_PSI_FULL_AVG10_OVERRIDE:-}" ]]; then
    printf '%s\n' "$WENYOU_PSI_FULL_AVG10_OVERRIDE"
    return
  fi
  awk '$1 == "full" { for (i = 2; i <= NF; i++) if ($i ~ /^avg10=/) { split($i, value, "="); print value[2]; exit } }' /proc/pressure/io 2>/dev/null
}

root_disk_device() {
  local source parent
  source="$(findmnt -no SOURCE / 2>/dev/null || true)"
  [[ "$source" == /dev/* ]] || return
  parent="$(lsblk -ndo PKNAME "$source" 2>/dev/null | head -n 1)"
  if [[ -n "$parent" ]]; then
    printf '%s\n' "$parent"
  else
    basename "$source"
  fi
}

disk_await_ms() {
  if [[ -n "${WENYOU_DISK_AWAIT_OVERRIDE:-}" ]]; then
    printf '%s\n' "$WENYOU_DISK_AWAIT_OVERRIDE"
    return
  fi

  local device
  device="$(root_disk_device)"
  [[ -n "$device" ]] || return
  iostat -dx "$device" 1 2 2>/dev/null | awk -v device="$device" '
    /^Device/ {
      await_col = r_await_col = w_await_col = d_await_col = 0
      for (i = 1; i <= NF; i++) {
        if ($i == "await") await_col = i
        if ($i == "r_await") r_await_col = i
        if ($i == "w_await") w_await_col = i
        if ($i == "d_await") d_await_col = i
      }
      next
    }
    $1 == device {
      if (await_col) value = $await_col
      else {
        value = 0
        if (r_await_col && $r_await_col > value) value = $r_await_col
        if (w_await_col && $w_await_col > value) value = $w_await_col
        if (d_await_col && $d_await_col > value) value = $d_await_col
      }
    }
    END { if (value != "") printf "%.2f\n", value }
  '
}

health_sample() {
  if [[ -n "${WENYOU_HEALTH_STATUS_OVERRIDE:-}" ]]; then
    printf '%s %s\n' "$WENYOU_HEALTH_STATUS_OVERRIDE" "${WENYOU_HEALTH_MS_OVERRIDE:-0}"
    return
  fi

  local result code seconds millis
  result="$(curl --silent --output /dev/null --write-out '%{http_code} %{time_total}' --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
  read -r code seconds <<<"$result"
  code="${code:-000}"
  millis="$(awk -v seconds="${seconds:-3}" 'BEGIN { printf "%d", seconds * 1000 }')"
  printf '%s %s\n' "$code" "$millis"
}

recent_backend_count() {
  local pattern="$1" override="$2"
  if [[ -n "$override" ]]; then
    printf '%s\n' "$override"
    return
  fi
  journalctl -u "$BACKEND_UNIT" --since '-2 minutes' --no-pager -o cat 2>/dev/null |
    grep -Ec "$pattern" || true
}

psi="$(psi_full_avg10)"
await_ms="$(disk_await_ms)"
read -r health_status health_ms <<<"$(health_sample)"
recent_5xx="$(recent_backend_count 'request errored.*statusCode.:5[0-9][0-9]' "${WENYOU_RECENT_5XX_OVERRIDE:-}")"
recent_p2028="$(recent_backend_count 'Transaction already closed' "${WENYOU_RECENT_P2028_OVERRIDE:-}")"
load1="$(awk '{ print $1 }' /proc/loadavg 2>/dev/null || printf 'unknown')"
memory_available_kb="$(awk '$1 == "MemAvailable:" { print $2 }' /proc/meminfo 2>/dev/null || printf 'unknown')"
restarts="$(systemctl show "$BACKEND_UNIT" -p NRestarts --value 2>/dev/null || printf 'unknown')"

reasons=()
if [[ -z "$psi" ]] || [[ -z "$await_ms" ]]; then
  reasons+=("collector")
fi
if [[ -n "$psi" ]] && number_ge "$psi" "$PSI_WARN"; then
  reasons+=("io_pressure")
fi
if [[ -n "$await_ms" ]] && number_ge "$await_ms" "$AWAIT_WARN_MS"; then
  reasons+=("disk_await")
fi
if [[ "$health_status" != "200" ]] || number_ge "${health_ms:-0}" "$HEALTH_WARN_MS"; then
  reasons+=("health")
fi
if (( ${recent_5xx:-0} > 0 )); then
  reasons+=("http_5xx")
fi
if (( ${recent_p2028:-0} > 0 )); then
  reasons+=("transaction_timeout")
fi

if (( ${#reasons[@]} > 0 )); then
  reason_csv="$(IFS=,; printf '%s' "${reasons[*]}")"
  printf 'host_health_warning reasons=%s io_psi_full_avg10=%s disk_await_ms=%s health_status=%s health_ms=%s load1=%s memory_available_kb=%s backend_restarts=%s recent_5xx=%s recent_p2028=%s\n' \
    "$reason_csv" "${psi:-unknown}" "${await_ms:-unknown}" "${health_status:-000}" "${health_ms:-unknown}" \
    "$load1" "$memory_available_kb" "$restarts" "${recent_5xx:-0}" "${recent_p2028:-0}"
fi
