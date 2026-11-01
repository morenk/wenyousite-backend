#!/usr/bin/env bash

redis_persistence_field() {
  awk -F: -v key="$2" '$1 == key {print $2}' <<<"$1"
}

wait_for_redis_snapshot() {
  local container=$1 before output status=0 previous_saves previous_running saves running last_status
  local started=$SECONDS max_wait=${WENYOUSITE_REDIS_SAVE_WAIT_SECONDS:-60} joined=false
  local initial_run_id current_run_id
  REDIS_SNAPSHOT_EPOCH=$(date +%s)
  [[ "$max_wait" =~ ^[1-9][0-9]*$ ]] || return 2
  initial_run_id=$(redis_cli "$container" INFO server 2>/dev/null | tr -d '\r') || return $?
  initial_run_id=$(redis_persistence_field "$initial_run_id" run_id)
  [[ "$initial_run_id" =~ ^[0-9a-f]{40}$ ]] || return 1
  before=$(redis_cli "$container" INFO persistence 2>/dev/null | tr -d '\r') || return $?
  previous_saves=$(redis_persistence_field "$before" rdb_saves)
  previous_running=$(redis_persistence_field "$before" rdb_bgsave_in_progress)
  [[ "$previous_saves" =~ ^[0-9]+$ && "$previous_running" =~ ^[01]$ ]] || return 1
  output=$(redis_cli "$container" BGSAVE 2>/dev/null) || status=$?
  if [ "$output" = 'Background saving started' ] && [ "$status" -eq 0 ]; then
    joined=false
  elif [ "$output" = 'ERR Background save already in progress' ]; then
    joined=true
    if [ "$previous_running" = 1 ]; then
      local age
      age=$(redis_persistence_field "$before" rdb_current_bgsave_time_sec)
      [[ "$age" =~ ^[0-9]+$ ]] && (( age <= max_wait )) || return 1
      REDIS_SNAPSHOT_EPOCH=$((REDIS_SNAPSHOT_EPOCH - age))
    fi
  else
    printf 'redis_snapshot result=failed reason=start_rejected\n' >&2
    [ "$status" -ne 0 ] || status=1
    return "$status"
  fi
  printf 'redis_snapshot event=wait mode=%s\n' "$([ "$joined" = true ] && echo joined || echo started)"
  while (( SECONDS - started < max_wait )); do
    output=$(redis_cli "$container" INFO persistence 2>/dev/null | tr -d '\r') || return $?
    saves=$(redis_persistence_field "$output" rdb_saves)
    running=$(redis_persistence_field "$output" rdb_bgsave_in_progress)
    last_status=$(redis_persistence_field "$output" rdb_last_bgsave_status)
    [[ "$saves" =~ ^[0-9]+$ && "$running" =~ ^[01]$ ]] || return 1
    (( saves >= previous_saves )) || return 1
    if [ "$running" = 0 ]; then
      [ "$last_status" = ok ] || { printf 'redis_snapshot result=failed reason=save_failed\n' >&2; return 1; }
      # Redis 7.4 在 fork 前递增计数；加入已经运行的任务时不再要求第二次递增。
      if (( saves > previous_saves )) || { [ "$joined" = true ] && [ "$previous_running" = 1 ]; }; then
        current_run_id=$(redis_cli "$container" INFO server 2>/dev/null | tr -d '\r') || return $?
        current_run_id=$(redis_persistence_field "$current_run_id" run_id)
        [ "$current_run_id" = "$initial_run_id" ] || return 1
        return 0
      fi
    fi
    sleep 1
  done
  printf 'redis_snapshot result=failed reason=save_timeout\n' >&2
  return 1
}
