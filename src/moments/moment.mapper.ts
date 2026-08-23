import { publicUserSummarySelect } from '../common/user-summary';
import { mediaVariantUrls } from '../media/media-response.mapper';
import { formatInternalReferencePreview } from '../common/internal-reference';

export const momentAuthorSelect = publicUserSummarySelect;

export const momentMediaSelect = {
  id: true,
  url: true,
  status: true,
  width: true,
  height: true,
} as const;

type MediaRow = {
  id: string;
  url: string;
  status: string;
  width: number | null;
  height: number | null;
};

type AuthorRow = {
  id: string;
  username: string;
  avatar: string | null;
  level: number;
  deletedAt: Date | null;
};

export type MomentCardRow = {
  id: string;
  authorId: string;
  author: AuthorRow;
  title: string;
  content: string;
  textCoverTheme: 'ROSE' | 'LILAC' | 'MINT' | 'AMBER';
  coverMedia: MediaRow | null;
  likeCount: number;
  commentCount: number;
  bookmarkCount: number;
  tipTotal: bigint;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  likes: { id: string }[];
  bookmarks: { id: string }[];
  _count: { images: number };
};

export type MomentDetailRow = MomentCardRow & {
  images: { media: MediaRow; sortOrder: number }[];
};

function mapMedia(media: MediaRow) {
  return { ...media, ...mediaVariantUrls(media), status: undefined };
}

function excerpt(value: string, length = 160) {
  const characters = Array.from(formatInternalReferencePreview(value).trim());
  return characters.length > length ? `${characters.slice(0, length).join('')}…` : characters.join('');
}

export function mapMomentCard(moment: MomentCardRow) {
  const coverMedia = moment.coverMedia ? mapMedia(moment.coverMedia) : null;
  return {
    id: moment.id,
    authorId: moment.authorId,
    author: moment.author,
    title: moment.title,
    contentExcerpt: excerpt(moment.content),
    coverType: coverMedia ? ('IMAGE' as const) : ('TEXT' as const),
    textCoverTheme: moment.textCoverTheme,
    coverMedia,
    imageCount: moment._count.images,
    likeCount: moment.likeCount,
    commentCount: moment.commentCount,
    bookmarkCount: moment.bookmarkCount,
    tipTotal: moment.tipTotal,
    viewerLiked: moment.likes.length > 0,
    viewerBookmarked: moment.bookmarks.length > 0,
    canInteract: moment.author.deletedAt === null,
    createdAt: moment.createdAt,
    updatedAt: moment.updatedAt,
  };
}

export function mapMomentDetail(moment: MomentDetailRow, viewer?: { id: string; role?: string }) {
  return {
    ...mapMomentCard(moment),
    content: moment.content,
    images: moment.images.map((image) => mapMedia(image.media)),
    version: moment.version,
    canEdit: viewer?.id === moment.authorId,
    canDelete: viewer?.id === moment.authorId || viewer?.role === 'ADMIN' || viewer?.role === 'SUPER_ADMIN',
  };
}

type CommentRow = {
  id: string;
  momentId: string;
  authorId: string;
  author: AuthorRow;
  content: string;
  media: MediaRow | null;
  sticker: {
    id: string;
    url: string;
    thumbnailUrl: string;
    width: number;
    height: number;
    animated: boolean;
    frameCount: number;
    durationMs: number;
  } | null;
  parentCommentId: string | null;
  replyToComment: { id: string; author: AuthorRow } | null;
  deletedAt: Date | null;
  createdAt: Date;
};

export function mapMomentComment(
  comment: CommentRow,
  viewer?: { id: string; role?: string },
  momentAuthorId?: string,
) {
  const deleted = comment.deletedAt !== null;
  return {
    id: comment.id,
    momentId: comment.momentId,
    author: comment.author,
    content: deleted ? null : comment.content,
    media: deleted || !comment.media ? null : mapMedia(comment.media),
    sticker: deleted || !comment.sticker
      ? null
      : { ...comment.sticker, mediumUrl: comment.sticker.url },
    parentCommentId: comment.parentCommentId,
    replyToComment: comment.replyToComment,
    deleted,
    canDelete:
      !deleted &&
      (viewer?.id === comment.authorId ||
        viewer?.id === momentAuthorId ||
        viewer?.role === 'ADMIN' ||
        viewer?.role === 'SUPER_ADMIN'),
    createdAt: comment.createdAt,
  };
}
