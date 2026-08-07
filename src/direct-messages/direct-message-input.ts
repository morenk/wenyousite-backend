import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CreateDirectMessageDto } from './dto/direct-message.dto';

export interface NormalizedDirectMessageInput {
  content: string | null;
  mediaId: string | null;
  stickerAssetId: string | null;
  clientRequestId: string;
}

/** 统一私聊三种互斥载荷，并在幂等比对前规范化纯文本。 */
export function normalizeDirectMessageInput(
  dto: CreateDirectMessageDto,
): NormalizedDirectMessageInput {
  const content = dto.content?.replace(/\r\n?/g, '\n').trim() || null;
  const mediaId = dto.mediaId ?? null;
  const stickerAssetId = dto.stickerAssetId ?? null;
  if (!content && !mediaId && !stickerAssetId) {
    throw new BusinessException(
      ErrorCode.INVALID_DIRECT_MESSAGE,
      '消息正文、图片和表情至少需要一项',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (stickerAssetId && (content || mediaId)) {
    throw new BusinessException(
      ErrorCode.INVALID_DIRECT_MESSAGE,
      '表情必须作为独立消息发送',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { content, mediaId, stickerAssetId, clientRequestId: dto.clientRequestId };
}
