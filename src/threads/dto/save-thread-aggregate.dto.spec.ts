import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveThreadAggregateDto } from './save-thread-aggregate.dto';

const base = { version: 1, defaultSubthreadVersion: 1, content: '正文', tagNames: [] };

describe('主贴聚合发言权限 DTO', () => {
  it.each([undefined, 'PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])('接受省略或有效策略 %s', async (policy) => {
    const dto = plainToInstance(SaveThreadAggregateDto, { ...base, defaultSubthreadPostingPolicy: policy });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([null, 'PUBLIC', '', 0, {}, []])('拒绝非法策略 %s', async (policy) => {
    const dto = plainToInstance(SaveThreadAggregateDto, { ...base, defaultSubthreadPostingPolicy: policy });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'defaultSubthreadPostingPolicy')).toBe(true);
  });
});
