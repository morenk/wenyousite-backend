import { z } from 'zod';

export const DOMAIN_EVENTS = {
  POST_CREATED: 'post.created',
  POST_MENTIONS_UPDATED: 'post.mentions.updated',
  THREAD_PUBLISHED: 'thread.published',
  THREAD_LIKED: 'thread.liked',
  THREAD_UNLIKED: 'thread.unliked',
  USER_FOLLOWED: 'user.followed',
  USER_LEVEL_UP: 'user.level_up',
  MOMENT_COMMENT_CREATED: 'moment.comment.created',
  DIRECT_MESSAGE_CREATED: 'direct-message.created',
  TIP_COMPLETED: 'tip.completed',
  THREAD_COLLABORATOR_ROLE_CHANGED: 'thread.collaborator-role.changed',
} as const;

export interface PostCreatedEvent {
  postId: string;
  content: string;
  userId: string;
  authorUsername?: string;
  occurredAt?: string;
  threadId: string;
  subthreadId: string;
  subthreadTitle: string;
  parentPostId: string | null;
  replyToPostId: string | null;
  /** 发帖事务内固定的直接回复目标；旧 Outbox 事件可能缺失。 */
  replyTargetUserId?: string | null;
  replyTargetName?: string | null;
  isSubthreadBody?: boolean;
  authorRole: 'OWNER' | 'COLLABORATOR' | 'PARTICIPANT';
  authorPlayerMarked: boolean;
  diceRolls?: { nodeId: string; notation: string; total: number }[];
}

export interface PostMentionsUpdatedEvent {
  postId: string;
  threadId: string;
  userId: string;
  authorUsername: string;
  recipientIds: string[];
  preview: string;
  context: 'body' | 'post';
}

export interface ThreadPublishedEvent {
  threadId: string;
  ownerId: string;
  ownerUsername: string;
  /** 旧 Outbox 事件可能缺失；消费者必须回查后再决定是否发送粉丝通知。 */
  visibility?: 'PUBLIC' | 'PRIVATE';
  occurredAt?: string;
}

export interface ThreadLikedEvent {
  eventId: string;
  threadId: string;
  ownerId: string;
  threadTitle: string;
  userId: string;
  username: string;
  occurredAt?: string;
}

export interface ThreadUnlikedEvent {
  eventId: string;
  threadId: string;
}

export interface UserFollowedEvent {
  actorId: string;
  actorUsername: string;
  targetId: string;
  notificationEventKey: string;
}

export interface LevelUpEvent {
  userId: string;
  previousLevel: number;
  level: number;
  experience: number;
}

export interface MomentCommentCreatedEvent {
  commentId: string;
  momentId: string;
  momentTitle: string;
  actorId: string;
  actorUsername: string;
  recipientId: string;
  isReply: boolean;
}

export interface DirectMessageCreatedEvent {
  messageId: string;
  conversationId: string;
  recipientId: string;
}

export interface TipCompletedEvent {
  transactionId: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  targetType: 'THREAD' | 'USER' | 'MOMENT';
  threadId?: string | null;
  threadTitle?: string | null;
  grossAmount: string;
  recipientAmount: string;
  platformAmount: string;
  threadTipTotal?: string | null;
  momentId?: string | null;
  momentTitle?: string | null;
  momentTipTotal?: string | null;
}

export interface ThreadCollaboratorRoleChangedEvent {
  eventId: string;
  threadId: string;
  threadTitle: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  oldRole: 'COLLABORATOR' | 'PARTICIPANT';
  newRole: 'COLLABORATOR' | 'PARTICIPANT';
}

export interface DomainEventMap {
  [DOMAIN_EVENTS.POST_CREATED]: PostCreatedEvent;
  [DOMAIN_EVENTS.POST_MENTIONS_UPDATED]: PostMentionsUpdatedEvent;
  [DOMAIN_EVENTS.THREAD_PUBLISHED]: ThreadPublishedEvent;
  [DOMAIN_EVENTS.THREAD_LIKED]: ThreadLikedEvent;
  [DOMAIN_EVENTS.THREAD_UNLIKED]: ThreadUnlikedEvent;
  [DOMAIN_EVENTS.USER_FOLLOWED]: UserFollowedEvent;
  [DOMAIN_EVENTS.USER_LEVEL_UP]: LevelUpEvent;
  [DOMAIN_EVENTS.MOMENT_COMMENT_CREATED]: MomentCommentCreatedEvent;
  [DOMAIN_EVENTS.DIRECT_MESSAGE_CREATED]: DirectMessageCreatedEvent;
  [DOMAIN_EVENTS.TIP_COMPLETED]: TipCompletedEvent;
  [DOMAIN_EVENTS.THREAD_COLLABORATOR_ROLE_CHANGED]: ThreadCollaboratorRoleChangedEvent;
}

export type DomainEventName = keyof DomainEventMap;
export type DomainEventPayload<K extends DomainEventName> = DomainEventMap[K];

const id = z.string().min(1);
const nullableId = id.nullable();
const optionalTimestamp = z.string().datetime().optional();

export const DOMAIN_EVENT_SCHEMAS = {
  [DOMAIN_EVENTS.POST_CREATED]: z.object({
    postId: id,
    content: z.string(),
    userId: id,
    authorUsername: z.string().optional(),
    occurredAt: optionalTimestamp,
    threadId: id,
    subthreadId: id,
    subthreadTitle: z.string(),
    parentPostId: nullableId,
    replyToPostId: nullableId,
    replyTargetUserId: nullableId.optional(),
    replyTargetName: z.string().nullable().optional(),
    isSubthreadBody: z.boolean().optional(),
    authorRole: z.enum(['OWNER', 'COLLABORATOR', 'PARTICIPANT']),
    authorPlayerMarked: z.boolean(),
    diceRolls: z
      .array(z.object({ nodeId: id, notation: z.string(), total: z.number() }))
      .optional(),
  }),
  [DOMAIN_EVENTS.POST_MENTIONS_UPDATED]: z.object({
    postId: id,
    threadId: id,
    userId: id,
    authorUsername: z.string(),
    recipientIds: z.array(id),
    preview: z.string(),
    context: z.enum(['body', 'post']),
  }),
  [DOMAIN_EVENTS.THREAD_PUBLISHED]: z.object({
    threadId: id,
    ownerId: id,
    ownerUsername: z.string(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    occurredAt: optionalTimestamp,
  }),
  [DOMAIN_EVENTS.THREAD_LIKED]: z.object({
    eventId: id,
    threadId: id,
    ownerId: id,
    threadTitle: z.string(),
    userId: id,
    username: z.string(),
    occurredAt: optionalTimestamp,
  }),
  [DOMAIN_EVENTS.THREAD_UNLIKED]: z.object({ eventId: id, threadId: id }),
  [DOMAIN_EVENTS.USER_FOLLOWED]: z.object({
    actorId: id,
    actorUsername: z.string(),
    targetId: id,
    notificationEventKey: id,
  }),
  [DOMAIN_EVENTS.USER_LEVEL_UP]: z.object({
    userId: id,
    previousLevel: z.number().int(),
    level: z.number().int(),
    experience: z.number().int(),
  }),
  [DOMAIN_EVENTS.MOMENT_COMMENT_CREATED]: z.object({
    commentId: id,
    momentId: id,
    momentTitle: z.string(),
    actorId: id,
    actorUsername: z.string(),
    recipientId: id,
    isReply: z.boolean(),
  }),
  [DOMAIN_EVENTS.DIRECT_MESSAGE_CREATED]: z.object({
    messageId: id,
    conversationId: id,
    recipientId: id,
  }),
  [DOMAIN_EVENTS.TIP_COMPLETED]: z.object({
    transactionId: id,
    senderId: id,
    senderUsername: z.string(),
    recipientId: id,
    targetType: z.enum(['THREAD', 'USER', 'MOMENT']),
    threadId: nullableId.optional(),
    threadTitle: z.string().nullable().optional(),
    grossAmount: z.string(),
    recipientAmount: z.string(),
    platformAmount: z.string(),
    threadTipTotal: z.string().nullable().optional(),
    momentId: nullableId.optional(),
    momentTitle: z.string().nullable().optional(),
    momentTipTotal: z.string().nullable().optional(),
  }),
  [DOMAIN_EVENTS.THREAD_COLLABORATOR_ROLE_CHANGED]: z.object({
    eventId: id,
    threadId: id,
    threadTitle: z.string(),
    actorId: id,
    actorName: z.string(),
    targetUserId: id,
    oldRole: z.enum(['COLLABORATOR', 'PARTICIPANT']),
    newRole: z.enum(['COLLABORATOR', 'PARTICIPANT']),
  }),
} satisfies Record<DomainEventName, z.ZodType>;

export function assertDomainEventPayload(
  eventType: string,
  payload: unknown,
): asserts eventType is DomainEventName {
  const schema = DOMAIN_EVENT_SCHEMAS[eventType as DomainEventName];
  if (!schema) throw new Error(`Unknown domain event type: ${eventType}`);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload for ${eventType}: ${z.prettifyError(result.error)}`);
  }
}
