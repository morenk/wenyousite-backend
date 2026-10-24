import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const status = (code, message) => ({ code, message });
const repo = (key, code, message) => ({ key, status: status(code, message) });
const info = (code = 0, message = 'ok', repos = [repo(1, code, message)]) =>
  JSON.stringify([{ name: 'wenyousite', status: status(code, message), repo: repos }]);

function runMonitor(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'wenyousite-backup-health-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['bin', 'state', 'private-tmp'])
    mkdirSync(path.join(root, dir), { mode: 0o700 });
  writeFileSync(path.join(root, 'state/security-activated'), '');
  for (const kind of [
    'redis',
    'pgbackrest',
    'postgres-logical',
    'restic-maintenance',
    'restore-drill',
  ]) {
    if (options.missingStamp === kind) continue;
    writeFileSync(
      path.join(root, `state/${kind}.success`),
      `completed_epoch=${Math.floor(Date.now() / 1000)}\n`,
    );
  }
  writeFileSync(path.join(root, 'info'), options.info ?? info());
  writeFileSync(path.join(root, 'stderr'), options.stderr ?? '');
  const docker = path.join(root, 'bin/docker');
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
set -eu
case "$1" in
  compose) echo fake-container ;;
  inspect) echo true ;;
  exec)
    case " $* " in
      *' psql '*) echo 'on|5min|on|0|t' ;;
      *' pgbackrest '*)
        stat -c %a "$TMPDIR"/* "$TMPDIR"/*/* >"$MOCK_ROOT/permissions"
        sleep "$MOCK_DELAY"
        cat "$MOCK_ROOT/info"
        cat "$MOCK_ROOT/stderr" >&2
        exit "$MOCK_EXIT"
        ;;
      *' INFO persistence '*) printf 'aof_enabled:1\\naof_last_write_status:ok\\n' ;;
      *) exit 90 ;;
    esac
    ;;
  *) exit 91 ;;
esac
`,
  );
  chmodSync(docker, 0o755);
  if (options.formatterFailure) {
    writeFileSync(path.join(root, 'bin/jq'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  }
  const result = spawnSync('bash', [path.join(scriptDir, 'monitor-backup-health.sh')], {
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      TMPDIR: path.join(root, 'private-tmp'),
      WENYOUSITE_BACKUP_STATE_DIR: path.join(root, 'state'),
      MOCK_ROOT: root,
      MOCK_EXIT: String(options.exit ?? 0),
      MOCK_DELAY: String(options.delay ?? 0),
    },
  });
  assert.ifError(result.error);
  assert.deepEqual(readFileSync(path.join(root, 'permissions'), 'utf8').trim().split('\n'), [
    '700',
    '600',
    '600',
  ]);
  assert.deepEqual(readdirSync(path.join(root, 'private-tmp')), [], '原始诊断临时文件必须清理');
  return result;
}

function failureDiagnostics(result) {
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /^backup_health_failure elapsed_seconds=\d+ stage=pgbackrest_info exit_code=\d+ stage_elapsed_seconds=\d+ diagnostics=/,
  );
  assert.equal(result.stderr.trim().split('\n').length, 1, '失败必须为单行结构化日志');
  assert.ok(result.stderr.length < 8_000, '日志必须有界');
  return JSON.parse(result.stderr.split(' diagnostics=')[1]);
}

test('健康仓库记录阶段、耗时和成功结果', (t) => {
  const result = runMonitor(t);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^backup_health_check stage=pgbackrest_info event=start\n/);
  assert.match(result.stdout, /event=finish exit_code=0 elapsed_seconds=\d+\n/);
  assert.match(result.stdout, /backup_health_success elapsed_seconds=\d+\n$/);
});

test('真实 other 顶层状态保留仓库内部超时原因与执行耗时', (t) => {
  const result = runMonitor(t, {
    info: info(99, 'other', [
      repo(
        1,
        99,
        '[FileOpenError] unable to load backup.info\n[HostConnectError] timeout after 60000ms',
      ),
    ]),
    delay: 1,
  });
  const diagnostic = failureDiagnostics(result);
  assert.equal(diagnostic.status, 99);
  assert.equal(diagnostic.message, 'other');
  assert.equal(diagnostic.repositories[0].key, 1);
  assert.deepEqual(diagnostic.repositories[0].detail.error_types, [
    'FileOpenError',
    'HostConnectError',
  ]);
  assert.deepEqual(diagnostic.repositories[0].detail.causes, ['timeout']);
  assert.deepEqual(diagnostic.repositories[0].detail.timeout_ms, [60000]);
  assert.match(result.stdout, /event=finish exit_code=0 elapsed_seconds=[1-9]\d*/);
});

test('鉴权错误保留 HTTP/S3 错误码并丢弃 URL、请求头、响应正文与日志注入', (t) => {
  const secret = 'TEST_ONLY_SECRET_CANARY';
  const privateMessage = `[ProtocolError] HTTP request failed with 403 (Forbidden)
<Code>SignatureDoesNotMatch</Code><Message>${secret}</Message>
https://user:${secret}@storage.invalid/private/${secret}?X-Amz-Signature=${secret}
Authorization: AWS4-HMAC-SHA256 Credential=${secret}
Cookie: session=${secret}
{"password":"${secret}","private_body":"${secret}"}
\u001b[31m\nbackup_health_success forged=${secret}`;
  const result = runMonitor(t, {
    info: info(99, privateMessage, [repo(1, 99, privateMessage)]),
    stderr: privateMessage,
  });
  const diagnostic = failureDiagnostics(result);
  for (const detail of [diagnostic.detail, diagnostic.repositories[0].detail, diagnostic.stderr]) {
    assert.deepEqual(detail.http_status, [403]);
    assert.deepEqual(detail.s3_codes, ['SignatureDoesNotMatch']);
    assert.ok(detail.causes.includes('authentication'));
    assert.deepEqual(detail.error_types, ['ProtocolError']);
  }
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /TEST_ONLY_SECRET_CANARY|storage\.invalid|Authorization|Cookie|private_body|forged|\u001b/,
  );
});

test('命令非零退出且无 JSON 时记录 stderr 原因和退出码', (t) => {
  const result = runMonitor(t, {
    info: '',
    exit: 49,
    stderr:
      "ERROR: [049]: [HostConnectError] unable to get address for 'TEST_ONLY_DNS_PRIVATE.invalid': [-2] unknown resolver failure",
  });
  const diagnostic = failureDiagnostics(result);
  assert.equal(diagnostic.output_state, 'empty');
  assert.deepEqual(diagnostic.stderr.causes, ['dns']);
  assert.deepEqual(diagnostic.stderr.pgbackrest_error_codes, [49]);
  assert.match(result.stdout, /event=finish exit_code=49/);
  assert.doesNotMatch(result.stdout + result.stderr, /TEST_ONLY_DNS_PRIVATE/);
});

test('即使命令输出健康 JSON，非零退出也不能判定成功', (t) => {
  const result = runMonitor(t, {
    exit: 125,
    stderr: 'permission denied while connecting to the Docker daemon',
  });
  const diagnostic = failureDiagnostics(result);
  assert.equal(diagnostic.status, 0);
  assert.deepEqual(diagnostic.stderr.causes, ['permission_denied']);
  assert.doesNotMatch(result.stdout, /backup_health_success/);
});

test('格式化失败仍告警，不泄露原始输出', (t) => {
  const result = runMonitor(t, {
    formatterFailure: true,
    info: 'TEST_ONLY_FORMATTER_PRIVATE',
    stderr: 'TEST_ONLY_FORMATTER_PRIVATE',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /diagnostics=formatter_failed/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /TEST_ONLY_FORMATTER_PRIVATE|backup_health_success/,
  );
});

test('TLS 和存储端 503 错误保留不同诊断信息', (t) => {
  const diagnostic = failureDiagnostics(
    runMonitor(t, {
      info: info(99, 'other', [
        repo(1, 99, '[HostConnectError] TLS handshake failed: certificate verify failed'),
        repo(
          2,
          99,
          '[ServiceError] HTTP request failed with 503 (Service Unavailable) <Code>SlowDown</Code>',
        ),
      ]),
    }),
  );
  assert.deepEqual(diagnostic.repositories[0].detail.causes, ['tls']);
  assert.deepEqual(diagnostic.repositories[1].detail.http_status, [503]);
  assert.deepEqual(diagnostic.repositories[1].detail.s3_codes, ['SlowDown']);
});

for (const [raw, state] of [
  ['', 'empty'],
  [' \n', 'empty'],
  ['TEST_ONLY_PRIVATE_NOT_JSON', 'invalid_json'],
  ['null', 'invalid_shape'],
  ['[]', 'invalid_shape'],
  ['{}', 'invalid_shape'],
  ['[{"status":{"code":0}}]', 'invalid_shape'],
  ['[{"status":"TEST_ONLY_PRIVATE_SHAPE"}]', 'invalid_shape'],
  [info(0, 'ok', ['TEST_ONLY_PRIVATE_REPO']), 'invalid_shape'],
  [info(0, 'ok', [{ key: 'TEST_ONLY_PRIVATE_KEY', status: status(99, 'other') }]), 'invalid_shape'],
]) {
  test(`空或异常输出不能静默成功：${state} ${raw.slice(0, 36)}`, (t) => {
    const result = runMonitor(t, { info: raw });
    const diagnostic = failureDiagnostics(result);
    assert.equal(diagnostic.output_state, state);
    assert.doesNotMatch(result.stdout + result.stderr, /TEST_ONLY_PRIVATE/);
  });
}

test('混合仓库状态标明失败仓库编号与原因', (t) => {
  const result = runMonitor(t, {
    info: info(4, 'different across repos', [
      repo(1, 0, 'ok'),
      repo(2, 99, '[CryptoError] unable to decrypt'),
    ]),
  });
  const diagnostic = failureDiagnostics(result);
  assert.equal(diagnostic.repository_count, 2);
  assert.equal(diagnostic.repositories.length, 1);
  assert.equal(diagnostic.repositories[0].key, 2);
  assert.deepEqual(diagnostic.repositories[0].detail.causes, ['repository_invalid']);
});

test('顶层健康但仓库级异常时仍失败', (t) => {
  const diagnostic = failureDiagnostics(
    runMonitor(t, { info: info(0, 'ok', [repo(1, 2, 'no valid backups')]) }),
  );
  assert.equal(diagnostic.healthy, false);
  assert.equal(diagnostic.repositories[0].message, 'no valid backups');
});

test('超长消息与未知错误内容不进入日志，记录截断标识', (t) => {
  const message =
    '[HostConnectError] Connection refused\n' + 'TEST_ONLY_UNKNOWN_PRIVATE '.repeat(5_000);
  const result = runMonitor(t, {
    info: info(99, 'other', [repo(1, 99, message)]),
    stderr: message,
  });
  const diagnostic = failureDiagnostics(result);
  assert.equal(diagnostic.repositories[0].detail.truncated, true);
  assert.equal(diagnostic.stderr.truncated, true);
  assert.deepEqual(diagnostic.stderr.causes, ['connection_refused']);
  assert.doesNotMatch(result.stdout + result.stderr, /TEST_ONLY_UNKNOWN_PRIVATE/);
});

test('非 pgBackRest 检查失败仍保留且不输出成功结果', (t) => {
  const result = runMonitor(t, { missingStamp: 'redis' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing_stamp=redis/);
  assert.doesNotMatch(result.stdout, /backup_health_success/);
});
