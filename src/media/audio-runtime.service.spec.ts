import { ConfigService } from '@nestjs/config';
import { AudioRuntimeService, verifyAudioRuntime } from './audio-runtime.service';
import { resolve } from 'node:path';
describe('音频能力就绪', () => {
  it('默认关闭不返回能力，后端同时拒绝签发', () => {
    const service = new AudioRuntimeService({ get: () => false } as unknown as ConfigService);
    expect(service.capability()).toBeUndefined();
    expect(() => service.requireReady()).toThrow('音频上传暂不可用');
  });
  it('开启但缺失运行依赖仍关闭', () => {
    const service = new AudioRuntimeService({
      get: (key: string) => (key === 'audio.enabled' ? true : '/missing'),
    } as unknown as ConfigService);
    expect(service.capability()).toBeUndefined();
    expect(() => service.requireReady()).toThrow('音频上传暂不可用');
  });
  it('显式开启且固定依赖就绪才提供预算', () => {
    const service = new AudioRuntimeService({
      get: (key: string) => (key === 'audio.enabled' ? true : resolve('.cache/audio-runtime')),
    } as unknown as ConfigService);
    expect(service.capability()).toMatchObject({
      version: 1,
      maxBytes: 31457280,
      maxDurationMs: 600000,
      outputContentType: 'audio/mpeg',
    });
  });
  it('拒绝缺失清单或错误文件', () => {
    expect(() => verifyAudioRuntime(resolve('.cache/audio-runtime'), '/missing')).toThrow();
    expect(() => verifyAudioRuntime('/tmp')).toThrow();
  });
});
