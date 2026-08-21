#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CHECK_SCRIPT="$SCRIPT_DIR/assert-releasable-repo.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-release-source-test.XXXXXX")
REMOTE_REPO="$TEST_ROOT/remote.git"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-release-source-test.*)
      rm -rf --one-file-system -- "$TEST_ROOT"
      ;;
    *)
      echo "拒绝清理非测试目录: $TEST_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT INT TERM

configure_identity() {
  local repo=$1
  git -C "$repo" config user.name "Release Gate Test"
  git -C "$repo" config user.email "release-gate@example.invalid"
}

clone_case() {
  local name=$1
  local repo="$TEST_ROOT/$name"
  git clone --quiet --branch dev "$REMOTE_REPO" "$repo"
  configure_identity "$repo"
  printf '%s\n' "$repo"
}

expect_reject() {
  local label=$1
  local repo=$2
  local branch=${3:-dev}
  if bash "$CHECK_SCRIPT" "$repo" "$branch" >/dev/null 2>"$TEST_ROOT/error.log"; then
    echo "发布源门禁未拒绝场景: $label" >&2
    exit 1
  fi
}

git init --quiet --bare --initial-branch=dev "$REMOTE_REPO"
seed_repo="$TEST_ROOT/seed"
git init --quiet --initial-branch=dev "$seed_repo"
configure_identity "$seed_repo"
printf 'initial\n' >"$seed_repo/tracked.txt"
git -C "$seed_repo" add tracked.txt
git -C "$seed_repo" commit --quiet -m "initial"
git -C "$seed_repo" remote add origin "$REMOTE_REPO"
git -C "$seed_repo" push --quiet --set-upstream origin dev

clean_repo=$(clone_case clean)
clean_sha=$(bash "$CHECK_SCRIPT" "$clean_repo" dev)
if [ "$clean_sha" != "$(git -C "$clean_repo" rev-parse HEAD)" ]; then
  echo "发布源门禁返回了错误 SHA" >&2
  exit 1
fi

untracked_repo=$(clone_case untracked)
printf 'untracked\n' >"$untracked_repo/untracked.txt"
expect_reject untracked "$untracked_repo"

unstaged_repo=$(clone_case unstaged)
printf 'changed\n' >"$unstaged_repo/tracked.txt"
expect_reject unstaged "$unstaged_repo"

staged_repo=$(clone_case staged)
printf 'staged\n' >"$staged_repo/tracked.txt"
git -C "$staged_repo" add tracked.txt
expect_reject staged "$staged_repo"

no_upstream_repo=$(clone_case no-upstream)
git -C "$no_upstream_repo" branch --unset-upstream
expect_reject no-upstream "$no_upstream_repo"

ahead_repo=$(clone_case ahead)
printf 'ahead\n' >"$ahead_repo/tracked.txt"
git -C "$ahead_repo" add tracked.txt
git -C "$ahead_repo" commit --quiet -m "ahead"
expect_reject ahead "$ahead_repo"
git -C "$ahead_repo" push --quiet origin dev
bash "$CHECK_SCRIPT" "$ahead_repo" dev >/dev/null

wrong_branch_repo=$(clone_case wrong-branch)
git -C "$wrong_branch_repo" switch --quiet -c feature/release-test
expect_reject wrong-branch "$wrong_branch_repo"

behind_repo=$(clone_case behind)
peer_repo=$(clone_case peer)
printf 'remote ahead\n' >"$peer_repo/tracked.txt"
git -C "$peer_repo" add tracked.txt
git -C "$peer_repo" commit --quiet -m "remote ahead"
git -C "$peer_repo" push --quiet origin dev
expect_reject remote-ahead "$behind_repo"

echo "发布源门禁测试通过"
