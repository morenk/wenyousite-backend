import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { truncateMarkdown } from '../common/markdown-truncate';
import { MentionsService } from '../mentions/mentions.service';
import { PostMentionsUpdatedEvent } from '../outbox/domain-events';
import { OutboxService } from '../outbox/outbox.service';

export interface EditedMentionInput {
  postId: string;
  version: number;
  content: string;
  previousContent: string;
  userId: string;
  threadId: string;
  authorUsername: string;
  context: 'body' | 'post';
}

/** 编辑后提及差异与可靠通知事件的单一协调器。 */
@Injectable()
export class PostMentionEventsService {
  constructor(
    private readonly mentions: MentionsService,
    private readonly outbox: OutboxService,
  ) {}

  async syncEditedMentions(tx: Prisma.TransactionClient, input: EditedMentionInput) {
    const mentioned = await this.mentions.syncMentionsInTransaction(
      tx,
      input.postId,
      input.content,
      input.userId,
      input.threadId,
      input.previousContent,
    );
    if (mentioned.length === 0) return;

    const payload: PostMentionsUpdatedEvent = {
      postId: input.postId,
      threadId: input.threadId,
      userId: input.userId,
      authorUsername: input.authorUsername,
      recipientIds: mentioned.map((user) => user.userId),
      preview: truncateMarkdown(input.content),
      context: input.context,
    };
    await this.outbox.enqueue(tx, {
      eventType: 'post.mentions.updated',
      aggregateType: 'Post',
      aggregateId: input.postId,
      eventKey: `post-mentions-updated:${input.postId}:v${input.version}`,
      payload,
    });
  }
}
