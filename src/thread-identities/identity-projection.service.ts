import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { visiblePostWhere, visibleUserWhere } from '../access/block-visibility.where';
import { readMediaDisplay } from '../media/media-display';
import { canonicalMentions, eligibleIdentity, readIdentity, readMentions } from './identity-policy';

type Row = Record<string, unknown>;
function record(value: unknown): value is Row {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date),
  );
}

/** 在领域访问检查之后投影；从持久快照读取，不覆盖全站账号字段或正文。 */
@Injectable()
export class IdentityProjectionService {
  constructor(private readonly prisma: PrismaService) {}
  async project<T>(
    value: T,
    context: {
      threadId?: string;
      subthreadId?: string;
      postId?: string;
      currentUsers?: boolean;
      viewerId?: string;
    } = {},
  ): Promise<T> {
    const nodes = new Map<string, Row[]>();
    const currentUsers: Row[] = [];
    const notifications: Row[] = [];
    let count = 0;
    const visit = (node: unknown, field = '') => {
      if (++count > 500000) return;
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, field));
        return;
      }
      if (!record(node)) return;
      if (
        typeof node.id === 'string' &&
        (record(node.author) ||
          (typeof node.content === 'string' && !('slot' in node)) ||
          field === 'replyToPost' ||
          field === 'bodyPost')
      ) {
        nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
      }
      if (
        context.currentUsers &&
        field !== 'author' &&
        typeof node.id === 'string' &&
        typeof node.username === 'string'
      )
        currentUsers.push(node);
      if (typeof node.postId === 'string' && record(node.fromUser) && record(node.payload))
        notifications.push(node);
      delete node.authorIdentitySnapshot;
      delete node.mentionIdentitySnapshots;
      delete node.identityAvatarMediaId;
      delete node.identityCreateMode;
      delete node.identityRequestHash;
      delete node.rpIdentityVersion;
      for (const [key, child] of Object.entries(node))
        if (
          ![
            'rpIdentity',
            'mentionIdentities',
            'display',
            'avatarDisplay',
            'mediaDisplays',
          ].includes(key)
        )
          visit(child, key);
    };
    visit(value);
    const ids = [
      ...new Set([...nodes.keys(), ...notifications.map((row) => row.postId as string)]),
    ];
    if (ids.length) {
      const posts = await this.prisma.post.findMany({
        where: { id: { in: ids }, ...visiblePostWhere(context.viewerId) },
        select: {
          id: true,
          authorIdentitySnapshot: true,
          mentionIdentitySnapshots: true,
          content: true,
          author: { select: { deletedAt: true } },
          identityAvatarMedia: {
            select: { url: true, status: true, deletionClaimedAt: true, displayAsset: true },
          },
          thread: { select: { rpIdentityEnabled: true } },
        },
      });
      const mentionedIds = [
        ...new Set(
          posts.flatMap((post) => canonicalMentions(post.content).map((token) => token.userId)),
        ),
      ];
      const users = mentionedIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: mentionedIds }, ...visibleUserWhere(context.viewerId) },
            select: { id: true, username: true },
          })
        : [];
      const names = new Map(users.map((user) => [user.id, user.username]));
      for (const post of posts) {
        const snapshot =
          post.thread.rpIdentityEnabled && !post.author.deletedAt
            ? readIdentity(post.authorIdentitySnapshot)
            : null;
        const media = post.identityAvatarMedia;
        const rpIdentity = snapshot
          ? {
              ...snapshot,
              avatar:
                media?.status === 'COMPLETED' && !media.deletionClaimedAt
                  ? media.url
                  : record(post.authorIdentitySnapshot) && post.authorIdentitySnapshot.avatarMediaId
                    ? null
                    : snapshot.avatar,
              avatarDisplay:
                media?.status === 'COMPLETED' && !media.deletionClaimedAt
                  ? readMediaDisplay(media.displayAsset)
                  : null,
            }
          : null;
        const saved = readMentions(post.mentionIdentitySnapshots);
        const mentionIdentities = canonicalMentions(post.content).map(({ userId, label }) => {
          const mention = saved.find((row) => row.userId === userId && row.label === label);
          const identityId =
            post.thread.rpIdentityEnabled && names.has(userId)
              ? (mention?.identityId ?? null)
              : null;
          return {
            userId,
            label,
            displayName: names.has(userId)
              ? identityId
                ? label
                : names.get(userId)!
              : '不可用用户',
            identityId,
          };
        });
        for (const node of nodes.get(post.id) ?? []) {
          if (record(node.author)) node.author.rpIdentity = rpIdentity;
          if (typeof node.content === 'string') node.mentionIdentities = mentionIdentities;
        }
        for (const node of notifications.filter((item) => item.postId === post.id))
          if (record(node.payload)) node.payload.rpIdentity = rpIdentity;
      }
    }
    if (!context.threadId && context.currentUsers) {
      if (context.subthreadId)
        context.threadId = (
          await this.prisma.subthread.findUnique({
            where: { id: context.subthreadId },
            select: { threadId: true },
          })
        )?.threadId;
      else if (context.postId)
        context.threadId = (
          await this.prisma.post.findUnique({
            where: { id: context.postId },
            select: { threadId: true },
          })
        )?.threadId;
    }
    if (context.threadId && currentUsers.length)
      await this.projectCurrent(
        context.threadId,
        currentUsers as Array<{ id: string; username: string; avatar: string | null }>,
      );
    return value;
  }

  async projectCurrent(
    threadId: string,
    users: Array<{
      id: string;
      username: string;
      avatar: string | null;
      deletedAt?: unknown;
      rpIdentity?: unknown;
    }>,
  ) {
    const ids = [...new Set(users.map((row) => row.id as string))];
    const [thread, identities, members] = await Promise.all([
      this.prisma.thread.findUnique({
        where: { id: threadId, deletedAt: null },
        select: { ownerId: true, rpIdentityEnabled: true },
      }),
      this.prisma.threadIdentity.findMany({
        where: { threadId, userId: { in: ids }, compatibilityIdentity: true, deletedAt: null },
        include: { avatarMedia: true },
      }),
      this.prisma.threadMember.findMany({ where: { threadId, userId: { in: ids } } }),
    ]);
    for (const user of users) {
      user.rpIdentity = null;
      const identity = identities.find((row) => row.userId === user.id);
      const member = members.find((row) => row.userId === user.id) ?? null;
      if (
        !thread?.rpIdentityEnabled ||
        user.deletedAt ||
        !identity ||
        (!identity.nickname && !identity.avatarMediaId) ||
        !eligibleIdentity(thread.ownerId, user.id as string, member)
      )
        continue;
      const media = identity.avatarMedia;
      user.rpIdentity = {
        id: identity.id,
        nickname: identity.nickname ?? user.username,
        avatar: identity.avatarMediaId
          ? media?.status === 'COMPLETED' && !media.deletionClaimedAt
            ? media.url
            : null
          : (user.avatar ?? null),
        avatarDisplay:
          media?.status === 'COMPLETED' && !media.deletionClaimedAt
            ? readMediaDisplay(media.displayAsset)
            : null,
      };
    }
  }
}
