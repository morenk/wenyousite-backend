export interface PostMentionsUpdatedEvent {
  postId: string;
  threadId: string;
  userId: string;
  authorUsername: string;
  recipientIds: string[];
  preview: string;
  context: 'body' | 'post';
}
