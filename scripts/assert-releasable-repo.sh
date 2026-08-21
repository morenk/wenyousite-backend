#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "用法: $0 <repo-dir> <expected-branch> [remote]" >&2
  exit 2
fi

repo_input=$1
expected_branch=$2
remote=${3:-origin}

if ! git check-ref-format "refs/heads/$expected_branch" >/dev/null 2>&1; then
  echo "目标分支名称无效: $expected_branch" >&2
  exit 1
fi
if ! repo_dir=$(git -C "$repo_input" rev-parse --show-toplevel 2>/dev/null); then
  echo "不是 Git 工作区: $repo_input" >&2
  exit 1
fi
if ! git -C "$repo_dir" remote get-url "$remote" >/dev/null 2>&1; then
  echo "Git remote 不存在: $remote" >&2
  exit 1
fi

branch=$(git -C "$repo_dir" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [ "$branch" != "$expected_branch" ]; then
  echo "拒绝部署分支 '$branch'，期望 '$expected_branch'" >&2
  exit 1
fi

status=$(git -C "$repo_dir" status --porcelain=v1 --untracked-files=normal)
if [ -n "$status" ]; then
  echo "拒绝部署脏工作区（包括 staged、unstaged 或 untracked 差异）: $repo_dir" >&2
  printf '%s\n' "$status" >&2
  exit 1
fi

if ! upstream=$(git -C "$repo_dir" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
  echo "目标分支缺少 upstream: $expected_branch" >&2
  exit 1
fi
expected_upstream="$remote/$expected_branch"
if [ "$upstream" != "$expected_upstream" ]; then
  echo "upstream 不一致: 当前 $upstream，期望 $expected_upstream" >&2
  exit 1
fi

export GIT_TERMINAL_PROMPT=0
if ! git -C "$repo_dir" fetch --quiet --no-tags "$remote" \
  "+refs/heads/$expected_branch:refs/remotes/$remote/$expected_branch"; then
  echo "无法刷新远端分支: $expected_upstream" >&2
  exit 1
fi

local_sha=$(git -C "$repo_dir" rev-parse --verify HEAD)
remote_sha=$(git -C "$repo_dir" rev-parse --verify "refs/remotes/$remote/$expected_branch")
if [ "$local_sha" != "$remote_sha" ]; then
  divergence=$(git -C "$repo_dir" rev-list --left-right --count "$local_sha...$remote_sha")
  echo "本地 HEAD 与 $expected_upstream 不一致（本地/远端: $divergence）" >&2
  echo "local:  $local_sha" >&2
  echo "remote: $remote_sha" >&2
  exit 1
fi

printf '%s\n' "$local_sha"
