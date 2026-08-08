import { ErrorCode } from '../common/exceptions/error-codes';
import { normalizeDirectMessageInput } from './direct-message-input';

const clientRequestId = '99454040-6a52-4bf3-8bad-42683c4d09be';

describe('normalizeDirectMessageInput', () => {
  it('规范化纯文本换行与首尾空白', () => {
    expect(
      normalizeDirectMessageInput({
        content: '  第一行\r\n第二行  ',
        clientRequestId,
      }),
    ).toEqual({
      content: '第一行\n第二行',
      mediaId: null,
      stickerAssetId: null,
      clientRequestId,
    });
  });

  it('接受纯图片或纯表情载荷', () => {
    expect(normalizeDirectMessageInput({ mediaId: 'media1', clientRequestId })).toEqual({
      content: null,
      mediaId: 'media1',
      stickerAssetId: null,
      clientRequestId,
    });
    expect(
      normalizeDirectMessageInput({
        stickerAssetId: 'cm1234567890123456789012',
        clientRequestId,
      }),
    ).toEqual({
      content: null,
      mediaId: null,
      stickerAssetId: 'cm1234567890123456789012',
      clientRequestId,
    });
  });

  it('拒绝空白消息', () => {
    expect(() =>
      normalizeDirectMessageInput({
        content: ' \r\n ',
        clientRequestId,
      }),
    ).toThrow(expect.objectContaining({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE }));
  });

  it.each([
    { content: '正文', stickerAssetId: 'cm1234567890123456789012', clientRequestId },
    { mediaId: 'media1', stickerAssetId: 'cm1234567890123456789012', clientRequestId },
  ])('拒绝表情与其他载荷组合', (input) => {
    expect(() => normalizeDirectMessageInput(input)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.INVALID_DIRECT_MESSAGE }),
    );
  });
});
