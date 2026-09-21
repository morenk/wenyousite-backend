/** 清理失败只公开受控阶段、身份编号与白名单原因，禁止透传异常正文。 */
type CleanupStage = 'process-group' | 'root-identity' | 'root-removal';
const reasons = new Map([
  ['进程组身份漂移，拒绝终止', 'process-identity-mismatch'],
  ['隔离进程仍在运行，保留目录', 'process-still-running'],
  ['拒绝停止未登记进程', 'unregistered-process'],
  ['资源身份验证失败，保留目录供治理核对；未删除未知资源', 'root-identity-mismatch'],
]);
const names = new Set(['Error', 'AssertionError', 'TypeError', 'RangeError']);
const codes = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EBUSY', 'ENOTEMPTY', 'EIO', 'ERR_ASSERTION']);

export function cleanupDiagnostic(runId: string, stage: CleanupStage, error: unknown, group?: number) {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    event: 'cleanup-failed',
    runId: /^e2e_[a-f0-9]{24}$/.test(runId) ? runId : 'unknown',
    stage,
    ...(Number.isSafeInteger(group) && group! > 0 ? { group } : {}),
    errorType: typeof value.name === 'string' && names.has(value.name) ? value.name : 'Error',
    errorCode: typeof value.code === 'string' && codes.has(value.code) ? value.code : 'OTHER',
    reason: typeof value.message === 'string' ? reasons.get(value.message) ?? 'unclassified' : 'unclassified',
  };
}
