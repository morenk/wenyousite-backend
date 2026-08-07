import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { StickerContentService } from './sticker-content.service';

const ASSET_ID = 'cm1234567890123456789012';
const URL = 'https://cdn.example.com/stickers/aa/test.webp';
const MARKDOWN = `![表情](${URL} "wenyousite-sticker:v1:${ASSET_ID}")`;

describe('StickerContentService', () => {
  const prisma = {
    media: { findMany: jest.fn() },
    userSticker: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const service = new StickerContentService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.media.findMany.mockResolvedValue([]);
    prisma.userSticker.findMany.mockResolvedValue([]);
  });

  it('提取标准表情标记，并忽略代码块和行内代码中的示例', () => {
    expect(service.extract(`${MARKDOWN}\n\`${MARKDOWN}\`\n\`\`\`\n${MARKDOWN}\n\`\`\``)).toEqual([
      { url: URL, title: `wenyousite-sticker:v1:${ASSET_ID}`, stickerAssetId: ASSET_ID },
    ]);
  });

  it('允许编辑时原样保留历史外链，但拒绝新增或复制外链图片', async () => {
    const external = '![历史图](https://external.example/a.png)';
    await expect(service.assertContentAllowed('u1', `${external}\n正文`, external)).resolves.toEqual([]);
    await expect(service.assertContentAllowed('u1', `${external}\n${external}`, external)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STICKER,
    });
  });

  it('新增表情必须属于当前收藏，且 URL 必须与资产匹配', async () => {
    prisma.userSticker.findMany.mockResolvedValue([{ asset: { id: ASSET_ID, url: URL } }]);
    await expect(service.assertContentAllowed('u1', MARKDOWN)).resolves.toEqual([ASSET_ID]);

    prisma.userSticker.findMany.mockResolvedValue([{ asset: { id: ASSET_ID, url: `${URL}?wrong` } }]);
    await expect(service.assertContentAllowed('u1', MARKDOWN)).rejects.toBeInstanceOf(BusinessException);
  });

  it('单篇内容最多允许 20 个表情', async () => {
    await expect(service.assertContentAllowed('u1', Array(21).fill(MARKDOWN).join(' ')))
      .rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STICKER });
  });

  it('新增普通图片必须是当前用户已处理完成的 Media URL', async () => {
    const ownUrl = 'https://cdn.example.com/uploads/a.png';
    prisma.media.findMany.mockResolvedValue([{ url: ownUrl }]);
    await expect(service.assertContentAllowed('u1', `![图](${ownUrl})`)).resolves.toEqual([]);
    expect(prisma.media.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', status: 'COMPLETED', url: { in: [ownUrl] } },
    }));
  });
});
