/** 草稿乐观锁 DTO 契约测试：版本必填规则与 OpenAPI 响应字段 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { DECORATORS } from '@nestjs/swagger';
import { CreateDraftDto } from './create-draft.dto';
import { UpdateDraftDto } from './update-draft.dto';
import { DraftResponseDto } from './draft-response.dto';
import { DeleteDraftQueryDto } from './delete-draft-query.dto';

describe('草稿 version DTO 契约', () => {
  it('创建空槽位可以省略 version，提供时必须为正整数', async () => {
    const valid = Object.assign(new CreateDraftDto(), { content: '正文', slot: 1 });
    const invalid = Object.assign(new CreateDraftDto(), { content: '正文', slot: 1, version: 0 });

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'version')).toBe(true);
  });

  it('创建幂等键省略时兼容旧客户端，提供时必须为 UUID v4', async () => {
    const valid = Object.assign(new CreateDraftDto(), {
      content: '正文',
      clientRequestId: '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77',
    });
    const invalid = Object.assign(new CreateDraftDto(), {
      content: '正文',
      clientRequestId: 'retry-draft-1',
    });

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'clientRequestId')).toBe(
      true,
    );
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

  it('删除 version 在兼容期可省略，提供时必须为正整数', async () => {
    const missing = Object.assign(new DeleteDraftQueryDto(), {});
    const valid = Object.assign(new DeleteDraftQueryDto(), { version: 2 });
    const invalid = Object.assign(new DeleteDraftQueryDto(), { version: 0 });

    expect(await validate(missing)).toEqual([]);
    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'version')).toBe(true);
  });
});
