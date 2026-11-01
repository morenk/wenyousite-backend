#!/usr/bin/env python3
"""保留原生仓库锁，等待整个进程组退出后才向外层归还本地锁。"""
import argparse
import fcntl
import os
import signal
import subprocess
import sys
import time


def run(args):
    interrupted = [False]
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: interrupted.__setitem__(0, True))
    with open(args.intent_lock, "a", encoding="utf-8") as intent:
        def backup_pending():
            try:
                fcntl.flock(intent, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(intent, fcntl.LOCK_UN)
                return False
            except BlockingIOError:
                return True

        if backup_pending():
            return 75
        child = subprocess.Popen(args.command, start_new_session=True)
        deadline = time.monotonic() + args.budget
        reason = None
        while child.poll() is None:
            if interrupted[0]:
                reason = 130
            elif backup_pending():
                reason = 75
            elif time.monotonic() >= deadline:
                reason = 78
            if reason is not None:
                try:
                    os.killpg(child.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=args.grace)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                    # 可能留下原生锁：拒绝假报延期成功，也绝不自动 unlock。
                    return 76
                break
            time.sleep(0.1)
        # 包装器先退出而子进程仍持锁时，不能释放本地锁开始下一阶段。
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            pass
        else:
            os.killpg(child.pid, signal.SIGINT)
            end = time.monotonic() + args.grace
            while time.monotonic() < end:
                try:
                    os.killpg(child.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                os.killpg(child.pid, signal.SIGKILL)
                return 76
        if reason is not None:
            return reason
        return 128 - child.returncode if child.returncode < 0 else child.returncode


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--intent-lock", required=True)
    parser.add_argument("--budget", type=int, default=540)
    parser.add_argument("--grace", type=int, default=30)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command.pop(0)
    if not 1 <= args.budget <= 540 or not 1 <= args.grace <= 30 or not args.command:
        sys.exit(2)
    sys.exit(run(args))
