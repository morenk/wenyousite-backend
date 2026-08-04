/** 草稿乐观锁 DTO 契约测试：版本必填规则与 OpenAPI 响应字段 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { DECORATORS } from '@nestjs/swagger';
import { CreateDraftDto } from './create-draft.dto';
import { UpdateDraftDto } from './update-draft.dto';
import { DraftResponseDto } from './draft-response.dto';

describe('草稿 version DTO 契约', () => {
  it('创建空槽位可以省略 version，提供时必须为正整数', async () => {
    const valid = Object.assign(new CreateDraftDto(), { content: '正文', slot: 1 });
    const invalid = Object.assign(new CreateDraftDto(), { content: '正文', slot: 1, version: 0 });

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'version')).toBe(true);
  });

  it('PATCH 必须提供正整数 version', async () => {
    const missing = Object.assign(new UpdateDraftDto(), { content: '正文' });
    const valid = Object.assign(new UpdateDraftDto(), { content: '正文', version: 2 });

    expect((await validate(missing)).some((error) => error.property === 'version')).toBe(true);
    expect(await validate(valid)).toEqual([]);
  });

  it('响应 DTO 在 OpenAPI 中暴露 version', () => {
    const metadata = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      DraftResponseDto.prototype,
      'version',
    );
    expect(metadata).toMatchObject({ minimum: 1, type: Number });
  });
});
