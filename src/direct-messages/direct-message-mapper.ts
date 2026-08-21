import { Prisma } from '@prisma/client';
import { publicUserSummarySelect } from '../common/user-summary';
import { formatDirectMessagePreview } from '../common/internal-reference';
import { mediaVariantUrls } from '../media/media-response.mapper';

export const routingConversationSelect = {
  id: true,
  firstUserId: true,
  secondUserId: true,
  requesterId: true,
  recipientId: true,
  status: true,
} satisfies Prisma.DirectConversationSelect;

export type RoutingConversation = Prisma.DirectConversationGetPayload<{
  select: typeof routingConversationSelect;
}>;

export const directMessageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  recipientId: true,
  content: true,
  recalledAt: true,
  createdAt: true,
  media: {
    select: {
      id: true,
      url: true,
      status: true,
      contentType: true,
      width: true,
      height: true,
    },
  },
  sticker: {
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      contentType: true,
      width: true,
      height: true,
      animated: true,
      frameCount: true,
      durationMs: true,
    },
  },
} satisfies Prisma.DirectMessageSelect;

export function directConversationInclude(userId: string) {
  return {
    firstUser: { select: publicUserSummarySelect },
    secondUser: { select: publicUserSummarySelect },
    participants: {
      where: { userId },
      select: { archivedAt: true },
    },
    messages: {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
      select: {
        id: true,
        senderId: true,
        content: true,
        mediaId: true,
        stickerAssetId: true,
        recalledAt: true,
        createdAt: true,
      },
    },
    _count: {
      select: {
        messages: {
          where: { recipientId: userId, readAt: null },
        },
      },
    },
  } satisfies Prisma.DirectConversationInclude;
}

type DirectConversationRecord = Prisma.DirectConversationGetPayload<{
  include: ReturnType<typeof directConversationInclude>;
}>;

type DirectMessageRecord = Prisma.DirectMessageGetPayload<{
  select: typeof directMessageSelect;
}>;

export function canonicalDirectUserPair(userId: string, otherUserId: string) {
  return userId < otherUserId
    ? { firstUserId: userId, secondUserId: otherUserId }
    : { firstUserId: otherUserId, secondUserId: userId };
}

export function mapDirectMessage(message: DirectMessageRecord) {
  const sticker = message.recalledAt ? null : message.sticker;
  const stickerResponse = sticker ? { ...sticker, mediumUrl: sticker.url } : null;
  const media = message.media
    ? {
        id: message.media.id,
        url: message.media.url,
        contentType: message.media.contentType,
        width: message.media.width,
        height: message.media.height,
        ...mediaVariantUrls(message.media),
      }
    : null;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    recipientId: message.recipientId,
    content: message.recalledAt ? null : message.content,
    // 兼容旧客户端：表情同时降级映射为普通图片；新版优先使用 sticker。
    media: message.recalledAt ? null : media ?? (sticker
      ? {
          id: sticker.id,
          url: sticker.url,
          contentType: sticker.contentType,
          width: sticker.width,
          height: sticker.height,
          thumbnailUrl: sticker.thumbnailUrl,
          mediumUrl: sticker.url,
        }
      : null),
    sticker: stickerResponse,
    recalledAt: message.recalledAt,
    createdAt: message.createdAt,
  };
}

export function mapDirectConversation(
  conversation: DirectConversationRecord,
  userId: string,
  isBlocked: boolean,
) {
  const otherUser = conversation.firstUserId === userId
    ? conversation.secondUser
    : conversation.firstUser;
  const lastMessage = conversation.messages[0];
  const requestDirection: 'NONE' | 'INCOMING' | 'OUTGOING' = conversation.status !== 'PENDING'
    ? 'NONE'
    : conversation.recipientId === userId
      ? 'INCOMING'
      : 'OUTGOING';
  const otherDeactivated = Boolean(otherUser.deletedAt);

  return {
    id: conversation.id,
    status: conversation.status,
    requestDirection,
    otherUser: {
      ...otherUser,
      isDeactivated: otherDeactivated,
    },
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          senderId: lastMessage.senderId,
          contentPreview: lastMessage.recalledAt
            ? null
            : lastMessage.content
              ? formatDirectMessagePreview(lastMessage.content)
              : (lastMessage.stickerAssetId ? '[表情]' : null),
          hasImage: !lastMessage.recalledAt && Boolean(lastMessage.mediaId || lastMessage.stickerAssetId),
          hasSticker: !lastMessage.recalledAt && Boolean(lastMessage.stickerAssetId),
          isRecalled: Boolean(lastMessage.recalledAt),
          createdAt: lastMessage.createdAt,
        }
      : null,
    unreadCount: conversation.status === 'ACCEPTED'
      ? conversation._count.messages
      : 0,
    archivedAt: conversation.participants[0]?.archivedAt ?? null,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    canSend: conversation.status === 'ACCEPTED' && !isBlocked && !otherDeactivated,
    canAccept:
      conversation.status === 'PENDING'
      && conversation.recipientId === userId
      && !isBlocked
      && !otherDeactivated,
    canDecline:
      conversation.status === 'PENDING'
      && conversation.recipientId === userId,
    isBlocked,
  };
}
