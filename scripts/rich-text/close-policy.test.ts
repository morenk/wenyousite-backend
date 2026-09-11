import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessClose } from './close-policy';
test('未知内容只读且没有新编辑：保留原 source 快照后可以退出，不强迫有损 flush', () => {
  assert.deepEqual(assessClose({ readOnly: true, dirty: false, flushSucceeded: false, snapshotSucceeded: true }), { allowClose: true, snapshotSource: 'original' });
  assert.deepEqual(assessClose({ readOnly: true, dirty: false, flushSucceeded: false, snapshotSucceeded: false }), { allowClose: false, snapshotSource: 'original' });
});
test('存在未编码的新编辑时，重复退出不得关闭；成功编码且持久化后才可退出', () => {
  for (let count = 0; count < 2; count++) assert.deepEqual(assessClose({ readOnly: false, dirty: true, flushSucceeded: false, snapshotSucceeded: true }), { allowClose: false, snapshotSource: null });
  assert.deepEqual(assessClose({ readOnly: false, dirty: true, flushSucceeded: true, snapshotSucceeded: false }), { allowClose: false, snapshotSource: 'current' });
  assert.deepEqual(assessClose({ readOnly: false, dirty: true, flushSucceeded: true, snapshotSucceeded: true }), { allowClose: true, snapshotSource: 'current' });
  assert.deepEqual(assessClose({ readOnly: true, dirty: true, flushSucceeded: true, snapshotSucceeded: true }), { allowClose: false, snapshotSource: null });
});
