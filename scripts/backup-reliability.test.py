#!/usr/bin/env python3
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPTS = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("retention", SCRIPTS / "restic-retention.py")
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


def write_executable(path, content):
    path.write_text(content)
    path.chmod(0o700)


def fixture(root):
    for name in ("bin", "config", "state", "tmp", "locks", "backups"):
        (root / name).mkdir(mode=0o700)
    env = {"PATH": f"{root / 'bin'}:{os.environ['PATH']}", "LANG": "C.UTF-8", "TZ": "UTC",
           "TMPDIR": str(root / "tmp"), "FIXTURE": str(root),
           "WENYOUSITE_CONFIG_ROOT": str(root / "config"),
           "WENYOUSITE_BACKUP_ROOT": str(root / "backups"),
           "WENYOUSITE_BACKUP_STATE_DIR": str(root / "state"),
           "WENYOUSITE_RESTIC_LOCK": str(root / "locks/repo"),
           "WENYOUSITE_RESTIC_INTENT_LOCK": str(root / "locks/intent"),
           "WENYOUSITE_RESTIC_MAINTENANCE_LOCK": str(root / "locks/maintenance"),
           "WENYOUSITE_REDIS_BACKUP_LOCK": str(root / "locks/redis"),
           "WENYOUSITE_OFFSITE_REQUIRED": "true", "WENYOUSITE_REDIS_SAVE_WAIT_SECONDS": "60"}
    (root / "config/password").write_text("synthetic-fixture-only")
    (root / "config/restic.env").write_text(
        f"RESTIC_REPOSITORY={root / 'repo'}\nRESTIC_PASSWORD_FILE={root / 'config/password'}\nRESTIC_CACHE_DIR={root / 'cache'}\n")
    for path in (root / "config").iterdir():
        path.chmod(0o600)
    # 仅在私有测试 PATH 中模拟 root 文件 owner/install，不改生产权限检查。
    write_executable(root / "bin/stat", """#!/usr/bin/env python3
import os,sys
if sys.argv[1:3] == ['-c','%u']: print(0)
else: os.execv('/usr/bin/stat',['stat',*sys.argv[1:]])
""")
    write_executable(root / "bin/id", "#!/bin/sh\necho 0\n")
    write_executable(root / "bin/install", """#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
for flag in ['-o','-g']:
 if flag in args:
  i=args.index(flag); del args[i:i+2]
os.execv('/usr/bin/install',['install',*args])
""")
    return env


def state(count, running=0, status="ok", age=1):
    return f"rdb_saves:{count}\nrdb_bgsave_in_progress:{running}\nrdb_last_bgsave_status:{status}\nrdb_current_bgsave_time_sec:{age}\nrdb_last_save_time:100\n"


def redis_mock(root, states, reply="Background saving started", code=0, restart=False):
    (root / "scenario.json").write_text(json.dumps({"states": states, "reply": reply, "code": code, "restart": restart}))
    write_executable(root / "redis-mock", """#!/usr/bin/env python3
import json,os,pathlib,sys
p=pathlib.Path(os.environ['FIXTURE']); s=json.loads((p/'scenario.json').read_text())
if sys.argv[1:] == ['INFO','server']:
 marker=p/'server-read'
 print('run_id:'+('b' if marker.exists() and s['restart'] else 'a')*40); marker.touch()
elif sys.argv[1:] == ['INFO','persistence']:
 f=p/'cursor'; i=int(f.read_text()) if f.exists() else 0; f.write_text(str(i+1))
 print(s['states'][min(i,len(s['states'])-1)])
else: print(s['reply']); sys.exit(s['code'])
""")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="backup-reliability-unit-")
        self.root = Path(self.temp.name)
        self.env = fixture(self.root)

    def tearDown(self):
        self.temp.cleanup()
        self.assertFalse(self.root.exists())

    def snapshot(self, states, reply="Background saving started", code=0, restart=False):
        redis_mock(self.root, states, reply, code, restart)
        return subprocess.run(["bash", "-c", '''set -euo pipefail
source "$1/redis-snapshot.sh"
redis_cli() { shift; "$FIXTURE/redis-mock" "$@"; }
sleep() { SECONDS=$((SECONDS + 10)); }
wait_for_redis_snapshot fake
''', "fixture", str(SCRIPTS)], env=self.env, capture_output=True, text=True, timeout=10)

    def test_started_fast_and_same_second_save(self):
        self.assertEqual(self.snapshot([state(5), state(6)]).returncode, 0)

    def test_join_existing_counter_unchanged(self):
        self.assertEqual(self.snapshot([state(5, 1), state(5)], "ERR Background save already in progress").returncode, 0)

    def test_save_started_between_info_and_command(self):
        self.assertEqual(self.snapshot([state(5), state(6, 1), state(6)], "ERR Background save already in progress").returncode, 0)

    def test_existing_completed_before_own_start(self):
        self.assertEqual(self.snapshot([state(5, 1), state(6)]).returncode, 0)

    def test_failed_existing_save(self):
        self.assertNotEqual(self.snapshot([state(5, 1), state(5, status="err")], "ERR Background save already in progress").returncode, 0)

    def test_real_timeout(self):
        result = self.snapshot([state(5), state(6, 1)])
        self.assertEqual(result.returncode, 1)
        self.assertIn("save_timeout", result.stderr)

    def test_unchanged_counter_does_not_accept_old_success(self):
        self.assertEqual(self.snapshot([state(5), state(5)]).returncode, 1)

    def test_already_reply_without_evidence_does_not_accept_old_save(self):
        self.assertEqual(self.snapshot([state(5), state(5)], "ERR Background save already in progress").returncode, 1)

    def test_old_inflight_snapshot_rejected(self):
        self.assertEqual(self.snapshot([state(5, 1, age=600), state(5)], "ERR Background save already in progress").returncode, 1)

    def test_counter_reset_rejected(self):
        self.assertEqual(self.snapshot([state(5), state(1)]).returncode, 1)

    def test_restart_rejected_even_with_higher_count(self):
        self.assertEqual(self.snapshot([state(5), state(6)], restart=True).returncode, 1)

    def test_zero_exit_error_reply_rejected_and_redacted(self):
        result = self.snapshot([state(5)], "ERR SECRET_SIGNED_URL")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("SECRET_SIGNED_URL", result.stdout + result.stderr)

    def test_command_exit_preserved(self):
        self.assertEqual(self.snapshot([state(5)], "SECRET", 23).returncode, 23)

    def test_log_trap_preserves_exit_and_cleans_private_output(self):
        result = subprocess.run(["bash", "-c", '''set -euo pipefail; umask 077
source "$1/backup-log.sh"
backup_log_init fixture
backup_run failed bash -c 'echo PRIVATE_DATA; echo SECRET_SIGNED_URL >&2; exit 23'
''', "fixture", str(SCRIPTS)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 23)
        self.assertIn("stage=failed event=finish exit_code=23", result.stderr)
        self.assertIn("operation=fixture event=finish exit_code=23", result.stderr)
        self.assertNotIn("SECRET", result.stderr + result.stdout)
        self.assertNotIn("PRIVATE_DATA", result.stderr + result.stdout)
        self.assertEqual(list((self.root / "tmp").iterdir()), [])

    def test_backup_remote_failure_never_records_success(self):
        redis_mock(self.root, [state(5), state(6)])
        write_executable(self.root / "bin/docker", """#!/usr/bin/env python3
import os,pathlib,sys
a=sys.argv[1:]; p=pathlib.Path(os.environ['FIXTURE'])
if a[0]=='compose': print('fixture-container')
elif a[0]=='inspect': print('healthy' if 'State.Health' in a[2] else 'true')
elif a[0]=='cp': pathlib.Path(a[-1]).write_text('synthetic-rdb')
elif 'redis-check-rdb' in a: pass
elif 'BGSAVE' in a: os.execv(str(p/'redis-mock'),['redis-mock','BGSAVE'])
elif 'INFO' in a: os.execv(str(p/'redis-mock'),['redis-mock','INFO',a[-1]])
else: sys.exit(91)
""")
        write_executable(self.root / "bin/restic", "#!/bin/sh\necho SECRET_URL >&2\nexit 23\n")
        result = subprocess.run(["bash", str(SCRIPTS / "backup-redis.sh")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertFalse((self.root / "state/redis.success").exists())
        self.assertIn("stage=remote_backup event=finish exit_code=23", result.stderr)
        self.assertNotIn("SECRET_URL", result.stderr)
        with open(self.root / "locks/intent", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_private_configuration_failure_stops_conditional_loader(self):
        config = self.root / 'config/restic.env'
        config.write_text('touch "$FIXTURE/must-not-execute"\n')
        config.chmod(0o644)
        result = subprocess.run(['bash', '-c', 'set -euo pipefail; source "$1/backup-common.sh"; if load_restic_environment; then exit 0; else exit 19; fi',
                                 'fixture', str(SCRIPTS)], env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 19)
        self.assertFalse((self.root / 'must-not-execute').exists())

    def test_forced_termination_is_failure_and_never_stamps(self):
        write_executable(self.root / 'bin/restic', '#!/usr/bin/env python3\nimport signal,time\nsignal.signal(signal.SIGINT,signal.SIG_IGN)\ntime.sleep(30)\n')
        result = subprocess.run(['bash', str(SCRIPTS / 'restic-maintenance.sh')],
                                env={**self.env, 'WENYOUSITE_MAINTENANCE_PHASE_SECONDS': '1', 'WENYOUSITE_MAINTENANCE_GRACE_SECONDS': '1'},
                                capture_output=True, text=True, timeout=8)
        self.assertEqual(result.returncode, 76)
        self.assertIn('forced_termination_native_lock_may_remain', result.stderr)
        self.assertEqual(list((self.root / 'state').iterdir()), [])


class SupervisorTests(BackupTests):
    # 仅使用本类新增测试，避免继承重复执行上面的测试。
    def phase(self, command, budget=1):
        return [sys.executable, str(SCRIPTS / "restic-maintenance-phase.py"), "--intent-lock", str(self.root / "locks/intent"),
                "--budget", str(budget), "--grace", "2", "--", *command]

    def test_budget_signal_exit_zero_is_deferred(self):
        result = subprocess.run(self.phase([sys.executable, "-c", "import signal,time,sys; signal.signal(signal.SIGINT,lambda *_: sys.exit(0)); time.sleep(10)"]), capture_output=True)
        self.assertEqual(result.returncode, 78)

    def test_natural_failure_preserved(self):
        result = subprocess.run(self.phase(["bash", "-c", "exit 23"]), capture_output=True)
        self.assertEqual(result.returncode, 23)

    def test_multiple_backup_waiters_release_automatically(self):
        path = self.root / "locks/intent"
        holders = []
        try:
            for _ in range(2):
                child = subprocess.Popen(["flock", "--shared", str(path), "sleep", "20"])
                holders.append(child)
            time.sleep(0.2)
            self.assertEqual(subprocess.run(self.phase(["true"])).returncode, 75)
            for index, child in enumerate(holders):
                # flock 的执行子进程也必须结束；测试不留下进程或等待意向。
                descendants = Path(f"/proc/{child.pid}/task/{child.pid}/children").read_text().split()
                for pid in descendants: os.kill(int(pid), signal.SIGTERM)
                child.wait(timeout=3)
                if index == 0: self.assertEqual(subprocess.run(self.phase(["true"])).returncode, 75)
            self.assertEqual(subprocess.run(self.phase(["true"])).returncode, 0)
        finally:
            for child in holders:
                if child.poll() is None: child.kill(); child.wait()

    def test_pending_backup_preempts_running_child_and_releases_lock(self):
        native = self.root / "native-lock"
        child = subprocess.Popen(self.phase([sys.executable, "-c", f"import fcntl,time; f=open({str(native)!r},'w'); fcntl.flock(f,fcntl.LOCK_EX); time.sleep(20)"], 10), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if native.exists(): break
                time.sleep(0.02)
            with open(self.root / "locks/intent", "a") as intent:
                fcntl.flock(intent, fcntl.LOCK_SH)
                self.assertEqual(child.wait(timeout=5), 75)
            with open(native, "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if child.poll() is None: child.terminate(); child.wait(timeout=5)


if __name__ == "__main__":
    suite = unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(BackupTests))
    for name in SupervisorTests.__dict__:
        if name.startswith("test_"): suite.addTest(SupervisorTests(name))
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
