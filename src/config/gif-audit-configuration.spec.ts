import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { gifAuditConfiguration } from './gif-audit-configuration';

const environment = {
  DATABASE_URL: 'postgresql://audit:test-only@127.0.0.1:1/audit',
  COS_ENDPOINT: 'http://127.0.0.1:1',
  COS_BUCKET: 'audit-test-bucket',
  COS_ACCESS_KEY_ID: 'audit-test-key',
  COS_SECRET_ACCESS_KEY: 'audit-test-secret',
  PORT: '3000',
  REDIS_PORT: '6379',
  REDIS_DB: '0',
  ARGON2_TIME_COST: '3',
  ARGON2_MEMORY_COST: '65536',
  SES_SMTP_PORT: '587',
};

describe('只读 GIF 审计配置', () => {
  it('只读取所需字符串配置，不依赖应用数字字段的隐式装饰器转换', () => {
    expect(gifAuditConfiguration(environment)).toEqual({
      database: { url: environment.DATABASE_URL },
      cos: {
        endpoint: environment.COS_ENDPOINT,
        region: 'ap-hongkong',
        bucket: environment.COS_BUCKET,
        accessKeyId: environment.COS_ACCESS_KEY_ID,
        secretAccessKey: environment.COS_SECRET_ACCESS_KEY,
      },
    });
  });

  it('实际 tsx 启动可带数字字符串配置构造客户端，并且不连接不可达测试服务', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(__dirname, '../../scripts/audit-gif-metadata.ts'),
        '--check-config',
      ],
      {
        cwd: resolve(__dirname, '../..'),
        env: environment,
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('GIF_METADATA_AUDIT_CONFIG_VALID');
    expect(result.stderr).not.toContain('audit-test-secret');
    expect(result.stderr).not.toContain('test-only');
  });

  it.each([
    'DATABASE_URL',
    'COS_ENDPOINT',
    'COS_BUCKET',
    'COS_ACCESS_KEY_ID',
    'COS_SECRET_ACCESS_KEY',
  ])('缺少 %s 时拒绝启动', (name) => {
    expect(() => gifAuditConfiguration({ ...environment, [name]: '' })).toThrow(
      'GIF_AUDIT_CONFIG_INVALID',
    );
  });

  it('无效连接协议不能通过配置验证', () => {
    expect(() =>
      gifAuditConfiguration({ ...environment, DATABASE_URL: 'https://example.invalid' }),
    ).toThrow('GIF_AUDIT_CONFIG_INVALID');
    expect(() =>
      gifAuditConfiguration({ ...environment, COS_ENDPOINT: 'file:///private' }),
    ).toThrow('GIF_AUDIT_CONFIG_INVALID');
  });
});
