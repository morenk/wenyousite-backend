import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCode } from './error-codes';
describe('业务错误码唯一性', () => {
  it('源码每个名称占用独立数值，避免客户端枚举生成重复键', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });
  it('已生成 OpenAPI 错误码不包含重复数值且与源码一致', () => {
    const api = JSON.parse(readFileSync(join(__dirname, '../../../contracts/openapi.json'), 'utf8'));
    const values = api.components.schemas.BusinessErrorCode.enum as number[];
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort((a,b) => a-b)).toEqual(Object.values(ErrorCode).sort((a,b) => a-b));
  });
});
