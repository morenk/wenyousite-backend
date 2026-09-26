import { runReleaseCommand } from './mobile-release-cli';
import { MobileReleasePublication } from './mobile-release-publication';
import { mockDeep } from 'jest-mock-extended';

describe('受限发布 CLI 参数', () => {
  const store = mockDeep<MobileReleasePublication>();
  beforeEach(() => jest.clearAllMocks());
  it('预检只返回固定身份与确认 revision，拒绝命令注入和额外参数', async () => {
    const identity = { platform: 'android', versionName: '1.0.0', buildNumber: 42 };
    store.preflight.mockResolvedValue({ ...identity, schemaVersion: 1, confirmedRevision: 7 });
    await expect(runReleaseCommand(store, 'preflight', identity)).resolves.toEqual({
      ...identity,
      schemaVersion: 1,
      confirmedRevision: 7,
    });
    for (const patch of [
      { platform: 'ios' },
      { versionName: 'x;id' },
      { buildNumber: 0 },
      { helper: '/tmp/evil' },
    ]) {
      await expect(
        runReleaseCommand(store, 'preflight', { ...identity, ...patch }),
      ).rejects.toThrow();
    }
    expect(store.preflight).toHaveBeenCalledTimes(1);
  });
  it('晋级要求准确 APK URL 和确认记录', async () => {
    const input = {
      platform: 'android',
      versionName: '1.0.0',
      buildNumber: 42,
      confirmedRevision: 7,
      operationId: '46b8438f-fb15-4e73-a1ea-f6d754c9e88a',
      apkSha256: 'a'.repeat(64),
      apkSize: '123',
      updateUrl: 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-1.0.0-42.apk',
    };
    await runReleaseCommand(store, 'begin', input);
    for (const patch of [
      { confirmedRevision: undefined },
      { updateUrl: 'file:///etc/passwd' },
      { apkSha256: '' },
      { operationId: '../other' },
    ]) {
      await expect(runReleaseCommand(store, 'begin', { ...input, ...patch })).rejects.toThrow();
    }
    expect(store.begin).toHaveBeenCalledTimes(1);
  });
});
