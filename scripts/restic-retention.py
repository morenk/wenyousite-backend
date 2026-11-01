#!/usr/bin/env python3
"""只输出受控清单。历史范围由已审阅清单固定，新快照才自动进入相同保留政策。"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

POLICY = "wenyousite-host-tags-35d-v1"
TAGS = ("redis", "postgres-logical")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("invalid_id")
    return value


def instant(value):
    date = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        raise ValueError("missing_timezone")
    return date


def restic(*args):
    result = subprocess.run(["restic", *args], capture_output=True)
    if result.returncode:
        # 原始 stderr 可能包含 S3 请求、签名和路径；不回显。
        raise subprocess.CalledProcessError(result.returncode, "restic")
    return result.stdout


def repository_id():
    return identifier(json.loads(restic("--no-lock", "--json", "cat", "config"))["id"])


def make_plan():
    plan = {"policy": POLICY, "repositoryId": repository_id(),
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "host": "wenyousite", "groupBy": "host,tags", "keepWithin": "35d", "groups": []}
    for tag in TAGS:
        output = restic("--no-lock", "--json", "forget", "--dry-run", "--host", "wenyousite",
                        "--tag", tag, "--group-by", "host,tags", "--keep-within", "35d")
        # restic 0.16.4 对没有匹配快照的过滤条件返回成功和空 stdout。
        raw = json.loads(output) if output.strip() else []
        group = {"tag": tag, "keep": [], "remove": []}
        for item in raw or []:
            # --tag 是包含关系；额外标签或其它主机不属于本政策。
            if item["host"] != "wenyousite" or item["tags"] != [tag]:
                continue
            for action in ("keep", "remove"):
                for snapshot in item.get(action) or []:
                    if snapshot["hostname"] != "wenyousite" or snapshot["tags"] != [tag]:
                        raise ValueError("scope_mismatch")
                    instant(snapshot["time"])
                    group[action].append({"id": identifier(snapshot["id"]), "time": snapshot["time"]})
                group[action].sort(key=lambda snapshot: snapshot["id"])
        plan["groups"].append(group)
    validate_plan(plan)
    return plan


def validate_plan(plan):
    if (plan["policy"] != POLICY or plan["host"] != "wenyousite" or
            plan["groupBy"] != "host,tags" or plan["keepWithin"] != "35d" or
            [g["tag"] for g in plan["groups"]] != list(TAGS)):
        raise ValueError("policy_mismatch")
    identifier(plan["repositoryId"])
    instant(plan["generatedAt"])
    seen = set()
    for group in plan["groups"]:
        for entry in group["keep"] + group["remove"]:
            key = identifier(entry["id"])
            instant(entry["time"])
            if key in seen:
                raise ValueError("duplicate_snapshot")
            seen.add(key)
    return seen


def activate(plan_path, approval_path):
    raw = Path(plan_path).read_bytes()
    plan = json.loads(raw)
    validate_plan(plan)
    age = (dt.datetime.now(dt.timezone.utc) - instant(plan["generatedAt"])).total_seconds()
    if not 0 <= age <= 86400 or repository_id() != plan["repositoryId"]:
        raise ValueError("stale_review_or_wrong_repository")
    approval = {"sourceFileSha256": hashlib.sha256(raw).hexdigest(), "reviewSha256": review_digest(plan), "review": plan}
    path = Path(approval_path)
    fd, temporary = tempfile.mkstemp(prefix=".retention-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(approval, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def review_digest(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def approved_removals(plan, approval):
    review = approval["review"]
    approved = validate_plan(review)
    validate_plan(plan)
    identifier(approval["reviewSha256"])
    if approval["reviewSha256"] != review_digest(review):
        raise ValueError("review_digest_mismatch")
    if review["repositoryId"] != plan["repositoryId"]:
        raise ValueError("repository_mismatch")
    cutoff = instant(review["generatedAt"])
    ids = []
    for group in plan["groups"]:
        for entry in group["remove"]:
            if entry["id"] not in approved and instant(entry["time"]) <= cutoff:
                raise ValueError("unreviewed_history")
            ids.append(entry["id"])
    return ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("plan", "activate", "apply"))
    parser.add_argument("--plan")
    parser.add_argument("--approval")
    args = parser.parse_args()
    if args.action == "plan":
        print(json.dumps(make_plan(), indent=2))
    elif args.action == "activate":
        activate(args.plan, args.approval)
        print("retention_activation result=success")
    else:
        plan = make_plan()
        ids = approved_removals(plan, json.loads(Path(args.approval).read_text()))
        for offset in range(0, len(ids), 128):
            # 精确候选 ID 来自本轮作用域验证；真实 forget 保留原生排他锁。
            restic("forget", "--quiet", *ids[offset:offset + 128])
        print(f"retention_apply result=success removed_count={len(ids)}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(f"retention_error category=restic exit_code={error.returncode}", file=sys.stderr)
        sys.exit(error.returncode if error.returncode > 0 else 130)
    except (ValueError, KeyError, TypeError, OSError):
        print("retention_error category=invalid_review_or_output", file=sys.stderr)
        sys.exit(1)
