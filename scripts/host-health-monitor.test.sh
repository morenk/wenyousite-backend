#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR="$SCRIPT_DIR/monitor-host-health.sh"

healthy="$(
  WENYOU_PSI_FULL_AVG10_OVERRIDE=0 \
  WENYOU_DISK_AWAIT_OVERRIDE=1 \
  WENYOU_HEALTH_STATUS_OVERRIDE=200 \
  WENYOU_HEALTH_MS_OVERRIDE=20 \
  WENYOU_RECENT_5XX_OVERRIDE=0 \
  WENYOU_RECENT_P2028_OVERRIDE=0 \
  bash "$MONITOR"
)"
if [[ -n "$healthy" ]]; then
  printf '健康样本不应输出告警: %s\n' "$healthy" >&2
  exit 1
fi

warning="$(
  WENYOU_PSI_FULL_AVG10_OVERRIDE=93.62 \
  WENYOU_DISK_AWAIT_OVERRIDE=278.04 \
  WENYOU_HEALTH_STATUS_OVERRIDE=500 \
  WENYOU_HEALTH_MS_OVERRIDE=84031 \
  WENYOU_RECENT_5XX_OVERRIDE=3 \
  WENYOU_RECENT_P2028_OVERRIDE=2 \
  bash "$MONITOR"
)"

for expected in \
  'host_health_warning' \
  'io_pressure' \
  'disk_await' \
  'health' \
  'http_5xx' \
  'transaction_timeout' \
  'io_psi_full_avg10=93.62' \
  'disk_await_ms=278.04'; do
  if [[ "$warning" != *"$expected"* ]]; then
    printf '告警样本缺少字段 %s: %s\n' "$expected" "$warning" >&2
    exit 1
  fi
done

printf 'host health monitor tests passed\n'
