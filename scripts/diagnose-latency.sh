#!/usr/bin/env bash
# 汇总最近一段时间的脱敏运行证据，不输出请求正文、邮箱、验证码或凭证。

set -uo pipefail

MINUTES="${1:-15}"
if [[ ! "$MINUTES" =~ ^[1-9][0-9]*$ ]] || (( MINUTES > 1440 )); then
  printf '用法: %s [1-1440 分钟]\n' "$0" >&2
  exit 2
fi

SINCE="-${MINUTES} minutes"
SAR_START="$(date -d "$SINCE" '+%H:%M:%S')"

printf '== 服务状态 ==\n'
systemctl show wenyousite-backend.service \
  -p ActiveState -p SubState -p MainPID -p NRestarts -p ExecMainStartTimestamp --no-pager
docker compose ps

printf '\n== 后端异常摘要（最近 %s 分钟） ==\n' "$MINUTES"
journalctl -u wenyousite-backend.service --since "$SINCE" --no-pager -o short-iso 2>/dev/null |
  grep -E 'request (errored|aborted)|Transaction already closed|发送冷却期内|投递状态更新失败|验证邮件发送失败|重置密码邮件发送失败|更换邮箱验证码发送失败' || true

printf '\n== PostgreSQL 存储信号 ==\n'
docker logs wenyousite-postgres --since "${MINUTES}m" 2>&1 |
  grep -E 'checkpoint (starting|complete)|I/O|PANIC|FATAL|could not (read|write|fsync)' || true

printf '\n== 当前 I/O 压力 ==\n'
sed -n '1,2p' /proc/pressure/io 2>/dev/null || true
iostat -dx 1 2 2>/dev/null | tail -n 20 || true

printf '\n== sysstat 历史 ==\n'
sar -q -s "$SAR_START" 2>/dev/null || true
sar -u ALL -s "$SAR_START" 2>/dev/null || true
sar -d -s "$SAR_START" 2>/dev/null || true

printf '\n== 巡检告警 ==\n'
journalctl -u wenyousite-host-health.service --since "$SINCE" --no-pager -o short-iso 2>/dev/null || true
