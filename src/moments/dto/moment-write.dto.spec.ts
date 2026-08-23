import { validate } from 'class-validator';
import { CreateMomentDto, UpdateMomentDto } from './moment-write.dto';

const mediaId = 'cmsewdo0h000x7qv6aa77ll1v';

describe('moment write DTO', () => {
  it('发布动态的媒体与封面 ID 必须是 CUID', async () => {
    const valid = Object.assign(new CreateMomentDto(), {
      title: '测试动态',
      mediaIds: [mediaId],
      coverMediaId: mediaId,
      clientRequestId: '00000000-0000-4000-8000-000000000001',
    });
    const invalid = Object.assign(new CreateMomentDto(), {
      title: '测试动态',
      mediaIds: ['media-1'],
      coverMediaId: 'media-1',
      clientRequestId: '00000000-0000-4000-8000-000000000001',
    });

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['mediaIds', 'coverMediaId']),
    );
  });

  it('编辑动态的媒体 ID 使用同一契验证', async () => {
    const invalid = Object.assign(new UpdateMomentDto(), {
      version: 1,
      mediaIds: [mediaId, 'not-a-cuid'],
    });

    expect((await validate(invalid)).some((error) => error.property === 'mediaIds')).toBe(true);
  });
});
