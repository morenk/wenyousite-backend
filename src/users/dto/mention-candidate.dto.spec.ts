/** 提及候选 DTO 契约测试：保证头像在生成客户端中是可空字符串 */

import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { MentionCandidateDto } from './mention-candidate.dto';

describe('MentionCandidateDto Swagger 契约', () => {
  it('avatar 声明为 string|null', () => {
    const metadata = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      MentionCandidateDto.prototype,
      'avatar',
    );

    expect(metadata).toMatchObject({ type: String, nullable: true });
  });
});
