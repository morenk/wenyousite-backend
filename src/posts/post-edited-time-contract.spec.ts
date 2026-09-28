import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contract = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/openapi.json'), 'utf8'));

describe('帖子编辑时间兼容契约', () => {
  it.each(['PostResponseDto', 'FloorResponseDto', 'ReplyResponseDto', 'PostDetailResponseDto'])(
    '%s 继承可选且可空的 ISO 时间字段，并保留发布时间', (name) => {
      const schema = contract.components.schemas[name];
      expect(schema.properties.editedAt).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
      expect(schema.required).not.toContain('editedAt');
      expect(schema.required).toContain('createdAt');
      expect(schema.required).toContain('updatedAt');
    },
  );
  it('最新回复定位摘要仍然只按发布时间描述', () => {
    expect(contract.components.schemas.LatestThreadPostResponseDto.properties).not.toHaveProperty('editedAt');
  });
});
