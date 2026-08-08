import {
  canonicalDirectUserPair,
  mapDirectConversation,
  mapDirectMessage,
} from './direct-message-mapper';

const createdAt = new Date('2026-08-06T20:00:00.000Z');

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'u1',
    recipientId: 'u2',
    content: '你好',
    recalledAt: null,
    createdAt,
    media: null,
    sticker: null,
    ...overrides,
  };
}

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    firstUserId: 'u1',
    secondUserId: 'u2',
    requesterId: 'u1',
    recipientId: 'u2',
    status: 'PENDING',
    firstUser: { id: 'u1', username: '甲', avatar: null, level: 1, deletedAt: null },
    secondUser: { id: 'u2', username: '乙', avatar: null, level: 2, deletedAt: null },
    participants: [{ archivedAt: null }],
    messages: [
      {
        id: 'm1',
        senderId: 'u1',
        content: '最后消息',
        mediaId: null,
        stickerAssetId: null,
        recalledAt: null,
        createdAt,
      },
    ],
    _count: { messages: 3 },
    lastMessageAt: createdAt,
    createdAt,
    ...overrides,
  };
}

describe('direct message mappers', () => {
  it('按用户 ID 固定排序唯一会话用户对', () => {
    expect(canonicalDirectUserPair('u1', 'u2')).toEqual({ firstUserId: 'u1', secondUserId: 'u2' });
    expect(canonicalDirectUserPair('u2', 'u1')).toEqual({ firstUserId: 'u1', secondUserId: 'u2' });
  });

  it('映射已完成图片的衍生图地址', () => {
    expect(
      mapDirectMessage(
        message({
          media: {
            id: 'media1',
            url: 'https://cdn.example.com/image.jpg?token=public',
            status: 'COMPLETED',
            contentType: 'image/jpeg',
            width: 800,
            height: 600,
          },
        }) as never,
      ),
    ).toEqual(
      expect.objectContaining({
        media: expect.objectContaining({
          thumbnailUrl: 'https://cdn.example.com/image_thumb.webp?token=public',
          mediumUrl: 'https://cdn.example.com/image_md.webp?token=public',
        }),
        sticker: null,
      }),
    );
  });

  it('表情为新客户端映射独立字段并为旧客户端提供图片回退', () => {
    const result = mapDirectMessage(
      message({
        content: null,
        sticker: {
          id: 'sticker1',
          url: 'https://cdn.example.com/sticker.webp',
          thumbnailUrl: 'https://cdn.example.com/sticker-thumb.webp',
          contentType: 'image/webp',
          width: 256,
          height: 256,
          animated: false,
          frameCount: 1,
          durationMs: null,
        },
      }) as never,
    );

    expect(result.sticker).toEqual(
      expect.objectContaining({
        id: 'sticker1',
        mediumUrl: 'https://cdn.example.com/sticker.webp',
      }),
    );
    expect(result.media).toEqual(
      expect.objectContaining({
        id: 'sticker1',
        mediumUrl: 'https://cdn.example.com/sticker.webp',
      }),
    );
  });

  it('撤回消息不泄露原正文、媒体或表情', () => {
    expect(
      mapDirectMessage(
        message({
          recalledAt: createdAt,
          content: '敏感正文',
          media: { id: 'media1', url: 'https://cdn.example.com/a.jpg' },
          sticker: { id: 'sticker1', url: 'https://cdn.example.com/s.webp' },
        }) as never,
      ),
    ).toEqual(
      expect.objectContaining({
        content: null,
        media: null,
        sticker: null,
        recalledAt: createdAt,
      }),
    );
  });

  it('会话映射请求方向、未读数与发送权限', () => {
    const incoming = mapDirectConversation(conversation() as never, 'u2', false);
    expect(incoming).toEqual(
      expect.objectContaining({
        requestDirection: 'INCOMING',
        unreadCount: 0,
        canSend: false,
        canAccept: true,
        canDecline: true,
        archivedAt: null,
        lastMessage: expect.objectContaining({ contentPreview: '最后消息' }),
      }),
    );

    const acceptedBlocked = mapDirectConversation(
      conversation({
        status: 'ACCEPTED',
        participants: [],
      }) as never,
      'u1',
      true,
    );
    expect(acceptedBlocked).toEqual(
      expect.objectContaining({
        requestDirection: 'NONE',
        unreadCount: 3,
        canSend: false,
        canAccept: false,
        archivedAt: null,
        isBlocked: true,
      }),
    );
  });

  it('注销用户关闭联系能力，撤回与表情预览不会泄露正文', () => {
    const result = mapDirectConversation(
      conversation({
        status: 'ACCEPTED',
        secondUser: {
          id: 'u2',
          username: '已注销用户',
          avatar: null,
          level: 1,
          deletedAt: createdAt,
        },
        messages: [
          {
            id: 'm2',
            senderId: 'u2',
            content: '旧正文',
            mediaId: null,
            stickerAssetId: 'sticker1',
            recalledAt: createdAt,
            createdAt,
          },
        ],
      }) as never,
      'u1',
      false,
    );

    expect(result.otherUser.isDeactivated).toBe(true);
    expect(result.canSend).toBe(false);
    expect(result.lastMessage).toEqual(
      expect.objectContaining({
        contentPreview: null,
        hasImage: false,
        hasSticker: false,
        isRecalled: true,
      }),
    );
  });
});
