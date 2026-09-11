/** 离线保护规则；不调用导航或存储，也不能代替消费端页面接入。 */
export function assessClose(input: {
  readOnly: boolean; dirty: boolean; flushSucceeded: boolean; snapshotSucceeded: boolean;
}): { allowClose: boolean; snapshotSource: 'original' | 'current' | null } {
  if (input.readOnly) {
    if (input.dirty) return { allowClose: false, snapshotSource: null };
    return { allowClose: input.snapshotSucceeded, snapshotSource: 'original' };
  }
  if (!input.flushSucceeded) return { allowClose: false, snapshotSource: null };
  return { allowClose: input.snapshotSucceeded, snapshotSource: 'current' };
}
