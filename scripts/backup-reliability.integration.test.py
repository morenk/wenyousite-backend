#!/usr/bin/env python3
"""只使用本轮私有目录/仓库和自建 REST 服务，不读取宿主 restic 配置。"""
import collections
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fixtures", SCRIPTS / "backup-reliability.test.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class NativeResticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="backup-reliability-native-")
        self.root = Path(self.temp.name)
        self.run_id = uuid.uuid4().hex
        (self.root / "ownership.json").write_text(json.dumps({"runId": self.run_id, "uid": os.getuid(), "root": str(self.root)}))
        self.env = fixtures.fixture(self.root)
        self.env.update(RESTIC_REPOSITORY=str(self.root / "repo"), RESTIC_PASSWORD_FILE=str(self.root / "config/password"), RESTIC_CACHE_DIR=str(self.root / "cache"))
        self.native("init")
        self.current = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)

    def tearDown(self):
        self.assertEqual(json.loads((self.root / "ownership.json").read_text())["runId"], self.run_id)
        self.temp.cleanup()
        self.assertFalse(self.root.exists())

    def native(self, *args, check=True, env=None):
        result = subprocess.run(["restic", *args], env=env or self.env, capture_output=True, text=True, timeout=60)
        if check:
            self.assertEqual(result.returncode, 0, f"restic fixture command failed: {args[0]}")
        return result

    def snapshot(self, name, age, tag="redis", host="wenyousite"):
        path = self.root / name
        path.write_bytes(os.urandom(4096))
        timestamp = (self.current - dt.timedelta(days=age)).strftime("%Y-%m-%d %H:%M:%S")
        self.native("backup", "--quiet", "--host", host, "--tag", tag, "--time", timestamp, str(path))
        return path

    def shell(self, *args):
        return subprocess.run(["bash", str(SCRIPTS / "restic-maintenance.sh"), *args], env=self.env, capture_output=True, text=True, timeout=60)

    def test_shell_review_activation_scope_and_retention(self):
        for tag in ("redis", "postgres-logical"):
            self.snapshot(tag + "-old", 60, tag)
            self.snapshot(tag + "-new", 0, tag)
        self.snapshot("other-host", 60, host="other-fixture-host")
        self.snapshot("other-tag", 60, tag="foreign")
        self.snapshot("mixed-tags", 60, tag="redis,protected")
        before = {p.name for p in (self.root / "repo/snapshots").iterdir()}
        review = self.shell("--dry-run")
        self.assertEqual(review.returncode, 0, review.stderr)
        plan = json.loads(review.stdout)  # 真实 shell stdout 必须可直接重定向供激活。
        self.assertEqual(before, {p.name for p in (self.root / "repo/snapshots").iterdir()})
        self.assertEqual(len(list((self.root / "repo/locks").iterdir())), 0)
        self.assertEqual([len(g["remove"]) for g in plan["groups"]], [1, 1])
        self.assertNotIn("paths", review.stdout)
        self.assertNotIn(str(self.root / "repo"), review.stdout)
        result = self.shell()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(before, {p.name for p in (self.root / "repo/snapshots").iterdir()})
        self.assertFalse((self.root / "state/restic-maintenance.success").exists())
        review_file = self.root / "review.json"
        review_file.write_text(review.stdout)
        review_file.chmod(0o600)
        activation = self.shell("--activate-reviewed", str(review_file), "--confirm", "ENABLE_WENYOUSITE_RETENTION_V1")
        self.assertEqual(activation.returncode, 0, activation.stderr)
        self.assertEqual(before, {p.name for p in (self.root / "repo/snapshots").iterdir()}, "激活自身不删除")
        approval = self.root / "config/restic-retention-approval.json"
        self.assertEqual(approval.stat().st_mode & 0o777, 0o600)
        result = self.shell()
        self.assertEqual(result.returncode, 0, result.stderr)
        removed = {s["id"] for g in plan["groups"] for s in g["remove"]}
        self.assertEqual(before - removed, {p.name for p in (self.root / "repo/snapshots").iterdir()})
        self.assertTrue((self.root / "state/restic-maintenance.success").exists())
        self.native("check", "--read-data")

    def test_unknown_historical_snapshot_requires_new_review(self):
        self.snapshot("old", 60)
        self.snapshot("new", 0)
        plan = json.loads(self.shell("--dry-run").stdout)
        approval = {"reviewSha256": fixtures.retention.review_digest(plan), "review": plan}
        self.snapshot("late-import", 70)
        fresh = json.loads(self.shell("--dry-run").stdout)
        with self.assertRaisesRegex(ValueError, "unreviewed_history"):
            fixtures.retention.approved_removals(fresh, approval)
        approval_file = self.root / 'config/restic-retention-approval.json'
        approval_file.write_text(json.dumps(approval)); approval_file.chmod(0o600)
        before = {p.name for p in (self.root / 'repo/snapshots').iterdir()}
        result = self.shell()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(before, {p.name for p in (self.root / 'repo/snapshots').iterdir()})
        self.assertFalse((self.root / 'state/restic-maintenance.success').exists())
        fresh["repositoryId"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "repository_mismatch"):
            fixtures.retention.approved_removals(fresh, approval)

    def test_native_lock_busy_defers_without_success(self):
        with open(self.root / "locks/repo", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = self.shell()
        self.assertEqual(result.returncode, 0)
        self.assertIn("reason=repository_busy", result.stdout)
        self.assertFalse((self.root / "state/restic-maintenance.success").exists())
        self.assertFalse((self.root / "state/restic-check.success").exists())

    @contextlib.contextmanager
    def slow_repository(self):
        repo, prefix = self.root / "repo", "/" + self.run_id
        requests = collections.Counter()
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def target(self):
                path = self.path.split("?", 1)[0]
                if not path.startswith(prefix + "/"):
                    raise ValueError("foreign request")
                tail = path[len(prefix) + 1:]
                parts = tail.strip("/").split("/")
                if ".." in parts or parts[0] not in ("config", "keys", "locks", "snapshots", "index", "data"):
                    raise ValueError("invalid fixture path")
                if parts[0] == "data" and len(parts) == 2:
                    return repo / "data" / parts[1][:2] / parts[1]
                return repo / tail

            def do_GET(self):
                path = self.target()
                if path.is_dir():
                    data = json.dumps([{"name": p.name, "size": p.stat().st_size} for p in path.rglob("*") if p.is_file()]).encode()
                elif path.is_file():
                    if path.parent.name in ("snapshots", "index"):
                        requests[path.name] += 1
                        time.sleep(0.12)
                    data = path.read_bytes()
                else:
                    self.send_error(404); return
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.x.restic.rest.v2")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try: self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError): pass

            def do_HEAD(self):
                path = self.target()
                self.send_response(200 if path.exists() else 404)
                self.send_header("Content-Length", str(path.stat().st_size if path.is_file() else 0))
                self.end_headers()

            def do_POST(self):
                path = self.target()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(200); self.end_headers()

            def do_DELETE(self):
                path = self.target()
                path.unlink(missing_ok=True)
                self.send_response(200); self.end_headers()

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        env = {**self.env, "RESTIC_REPOSITORY": f"rest:http://127.0.0.1:{server.server_port}{prefix}", "RESTIC_CACHE_DIR": str(self.root / "check-cache")}
        try:
            yield env, requests
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

    def phase(self, env, *command, budget=1):
        return subprocess.run([sys.executable, str(SCRIPTS / "restic-maintenance-phase.py"), "--intent-lock", str(self.root / "locks/intent"),
                               "--budget", str(budget), "--grace", "5", "--", "restic", *command], env=env, capture_output=True, text=True, timeout=20)

    def test_interrupted_real_check_converges_with_cache_and_unlocks(self):
        for i in range(16): self.snapshot(f"snapshot-{i}", i)
        with self.slow_repository() as (env, requests):
            process = subprocess.Popen([sys.executable, str(SCRIPTS / "restic-maintenance-phase.py"), "--intent-lock", str(self.root / "locks/intent"),
                                        "--budget", "10", "--grace", "5", "--", "restic", "check", "--with-cache"],
                                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(200):
                    if sum(requests.values()) >= 2: break
                    time.sleep(0.02)
                with open(self.root / "locks/intent", "a") as intent:
                    fcntl.flock(intent, fcntl.LOCK_SH)
                    self.assertEqual(process.wait(timeout=10), 75)
                self.assertEqual(list((self.root / "repo/locks").iterdir()), [])
            finally:
                if process.poll() is None: process.terminate(); process.wait(timeout=10)
            outcomes = []
            for _ in range(12):
                result = self.phase(env, "check", "--with-cache")
                outcomes.append(result.returncode)
                self.assertIn(result.returncode, (0, 78), "native check failed")
                self.assertEqual(list((self.root / "repo/locks").iterdir()), [], "原生锁必须已释放")
                if result.returncode == 0: break
            self.assertIn(78, outcomes, "慢仓库必须实际中止过")
            self.assertEqual(outcomes[-1], 0, "保留缓存后必须真正完成")
            before = requests.copy()
            self.assertEqual(self.phase(env, "check", "--with-cache", budget=5).returncode, 0)
            self.assertEqual(before, requests, "已核验元数据应复用缓存")
            # 热缓存仍必须发现仓库缺失 pack，不能把缓存命中当成一致性通过。
            pack = next(p for p in (self.root / "repo/data").rglob("*") if p.is_file())
            saved = pack.read_bytes(); pack.unlink()
            try: self.assertNotEqual(self.phase(env, "check", "--with-cache", budget=5).returncode, 0)
            finally: pack.write_bytes(saved)
        self.native("check", "--read-data")

    def test_interrupted_real_prune_preserves_repository(self):
        for i in range(12): self.snapshot(f"prune-{i}", i * 5)
        self.native("forget", "--host", "wenyousite", "--tag", "redis", "--group-by", "host,tags", "--keep-last", "1")
        snapshots = {p.name for p in (self.root / "repo/snapshots").iterdir()}
        with self.slow_repository() as (env, _):
            result = self.phase(env, "prune", "--max-repack-size", "1M")
            self.assertEqual(result.returncode, 78, "prune 必须实际中止过")
            self.assertEqual(list((self.root / "repo/locks").iterdir()), [])
        self.assertEqual(snapshots, {p.name for p in (self.root / "repo/snapshots").iterdir()})
        self.native("prune")
        self.native("check", "--read-data")


if __name__ == "__main__":
    if not shutil.which("restic"):
        raise SystemExit("缺少 restic，拒绝跳过真实仓库验证")
    unittest.main(verbosity=2)
