import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contract = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/openapi.json'), 'utf8'));

describe('主题互动总数兼容契约', () => {
  it.each(['bookmarkCount', 'subscriberCount'])('%s 是可缺失的非负整数，不以 schema 默认值伪造零', (field) => {
    const schema = contract.components.schemas.ThreadDetailResponseDto;
    expect(schema.properties[field]).toMatchObject({ type: 'integer', minimum: 0 });
    expect(schema.properties[field]).not.toHaveProperty('default');
    expect(schema.required).not.toContain(field);
  });
});
