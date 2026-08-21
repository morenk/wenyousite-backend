const PRODUCTION_ORIGIN = 'https://wenyou.site';
export const INTERNAL_REFERENCE_DEFAULT_LABEL = '传送门';
export const INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL = '邀请传送门';

const ID_RE = /^[a-z0-9]{20,32}$/u;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16}$/u;
const THREAD_ROUTE_RE = /^\/threads\/([^/]+)$/u;
const DISCUSSION_ROUTE_RE = /^\/threads\/([^/]+)\/posts\/([^/]+)\/replies$/u;
const INVITE_ROUTE_RE = /^\/join\/([^/]+)$/u;
const TRAILING_PUNCTUATION_RE = /[.,!?;:，。！？；：、]+$/u;
const REFERENCE_CANDIDATE_RE =
  /\[((?:\\.|[^\]\\\r\n])+)\]\(([^)\r\n]+)\)|https:\/\/(?:www\.)?wenyou\.site\/(?:threads\/[a-z0-9_-]+(?:\/posts\/[a-z0-9_-]+\/replies)?|join\/[a-z0-9_-]+)(?:\?[^\s<>\])}.,!;:，。！？；：、]+)?|\/(?:threads\/[a-z0-9_-]+(?:\/posts\/[a-z0-9_-]+\/replies)?|join\/[a-z0-9_-]+)(?:\?[^\s<>\])}.,!;:，。！？；：、]+)?/giu;
const BARE_REFERENCE_LEFT_BOUNDARY_RE = /[\s([{"'，。！？；：、]/u;
const BARE_REFERENCE_RIGHT_BOUNDARY_RE = /[\s)\]}"'.,!?;:，。！？；：、]/u;
const INVITE_MARKDOWN_PREVIEW_RE =
  /\[((?:\\.|[^\]\\\r\n])+)\]\(\s*(?:https:\/\/(?:www\.)?wenyou\.site)?\/join\/[A-Za-z0-9_-]+(?:[?#][^)\s]*)?\s*\)/giu;
const INVITE_LOCATION_PREVIEW_RE =
  /(?:https:\/\/(?:www\.)?wenyou\.site)?\/join\/[A-Za-z0-9_-]+(?:[?#][^\s<>()\]}"']*)?/giu;

export type InternalReference =
  | { kind: 'THREAD'; threadId: string; href: string }
  | { kind: 'SUBTHREAD'; threadId: string; subthreadId: string; href: string }
  | { kind: 'FLOOR'; threadId: string; postId: string; href: string }
  | { kind: 'DISCUSSION'; threadId: string; floorPostId: string; href: string }
  | { kind: 'REPLY'; threadId: string; floorPostId: string; postId: string; href: string }
  | { kind: 'INVITE'; token: string; href: string };

function isValidId(value: string | null): value is string {
  return !!value && ID_RE.test(value);
}

function hasOnlyQuery(url: URL, allowed: string | null): boolean {
  const keys = [...url.searchParams.keys()];
  return allowed === null
    ? keys.length === 0
    : keys.length === 1 && keys[0] === allowed && url.searchParams.getAll(allowed).length === 1;
}

function hasThreadCoordinateQuery(url: URL, primary: 'post'): boolean {
  const keys = [...url.searchParams.keys()];
  const uniqueKeys = new Set(keys);
  return uniqueKeys.has(primary)
    && [...uniqueKeys].every((key) => key === 'post' || key === 'subthread')
    && [...uniqueKeys].every((key) => url.searchParams.getAll(key).length === 1);
}

function isProductionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'wenyou.site' || normalized === 'www.wenyou.site';
}

/** 识别并规范化 v1 站内坐标；不查询目标是否存在，避免元数据泄漏。 */
export function parseInternalReference(input: string): InternalReference | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('#')) return null;

  const relative = trimmed.startsWith('/') && !trimmed.startsWith('//');
  let url: URL;
  try {
    url = new URL(trimmed, PRODUCTION_ORIGIN);
  } catch {
    return null;
  }
  if (!relative && (url.protocol !== 'https:' || !isProductionHost(url.hostname) || url.port)) {
    return null;
  }
  if (url.username || url.password) return null;

  const threadRoute = THREAD_ROUTE_RE.exec(url.pathname);
  if (threadRoute) {
    let threadId: string;
    try {
      threadId = decodeURIComponent(threadRoute[1]);
    } catch {
      return null;
    }
    if (!isValidId(threadId)) return null;
    const subthreadId = url.searchParams.get('subthread');
    const postId = url.searchParams.get('post');
    if (postId !== null) {
      if (!isValidId(postId) || !hasThreadCoordinateQuery(url, 'post')) return null;
      return {
        kind: 'FLOOR',
        threadId,
        postId,
        href: `/threads/${threadId}?post=${postId}`,
      };
    }
    if (subthreadId !== null) {
      if (!isValidId(subthreadId) || !hasOnlyQuery(url, 'subthread')) return null;
      return {
        kind: 'SUBTHREAD',
        threadId,
        subthreadId,
        href: `/threads/${threadId}?subthread=${subthreadId}`,
      };
    }
    return hasOnlyQuery(url, null)
      ? { kind: 'THREAD', threadId, href: `/threads/${threadId}` }
      : null;
  }

  const inviteRoute = INVITE_ROUTE_RE.exec(url.pathname);
  if (inviteRoute) {
    let token: string;
    try {
      token = decodeURIComponent(inviteRoute[1]);
    } catch {
      return null;
    }
    return INVITE_TOKEN_RE.test(token) && hasOnlyQuery(url, null)
      ? { kind: 'INVITE', token, href: `/join/${token}` }
      : null;
  }

  const discussionRoute = DISCUSSION_ROUTE_RE.exec(url.pathname);
  if (!discussionRoute) return null;
  let threadId: string;
  let floorPostId: string;
  try {
    threadId = decodeURIComponent(discussionRoute[1]);
    floorPostId = decodeURIComponent(discussionRoute[2]);
  } catch {
    return null;
  }
  if (!isValidId(threadId) || !isValidId(floorPostId)) return null;
  const postId = url.searchParams.get('post');
  const baseHref = `/threads/${threadId}/posts/${floorPostId}/replies`;
  if (postId !== null) {
    if (!isValidId(postId) || !hasOnlyQuery(url, 'post')) return null;
    return { kind: 'REPLY', threadId, floorPostId, postId, href: `${baseHref}?post=${postId}` };
  }
  return hasOnlyQuery(url, null)
    ? { kind: 'DISCUSSION', threadId, floorPostId, href: baseHref }
    : null;
}

export function decodeInternalReferenceLabel(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const escaped = value[index + 1];
    if (character === '\\' && (escaped === '\\' || escaped === '[' || escaped === ']')) {
      output += escaped;
      index += 1;
    } else {
      output += character;
    }
  }
  return output;
}

export function serializeInternalReference(label: string, href: string): string | null {
  const reference = parseInternalReference(href);
  const normalizedLabel = label.trim();
  if (!reference || !normalizedLabel || /[\r\n]/u.test(normalizedLabel)) return null;
  const escapedLabel = normalizedLabel
    .replace(/\\/gu, '\\\\')
    .replace(/\[/gu, '\\[')
    .replace(/\]/gu, '\\]');
  return `[${escapedLabel}](${reference.href})`;
}

/**
 * 动态、评论和摘要中的传送门降级：自定义名称保留，裸站内链接统一显示“传送门”。
 * 其他 Markdown/外链保持字面文本，交由各自既有管线处理。
 */
export function formatInternalReferencePreview(
  value: string,
  options: { redactInvites?: boolean } = {},
): string {
  const { redactInvites = false } = options;
  const preview = value.replace(
    REFERENCE_CANDIDATE_RE,
    (
      candidate,
      rawLabel: string | undefined,
      markdownHref: string | undefined,
      offset: number,
      source: string,
    ) => {
      const isBareReference = !markdownHref;
      const previousCharacter = offset > 0 ? source[offset - 1] : '';
      const nextCharacter = source[offset + candidate.length] ?? '';
      const hasLeftBoundary = !previousCharacter
        || BARE_REFERENCE_LEFT_BOUNDARY_RE.test(previousCharacter);
      const hasRightBoundary = !nextCharacter
        || BARE_REFERENCE_RIGHT_BOUNDARY_RE.test(nextCharacter);
      if (isBareReference && (!hasLeftBoundary || !hasRightBoundary)) {
        return candidate;
      }
      const href = markdownHref?.trim() ?? candidate;
      const trailing = markdownHref ? '' : (candidate.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '');
      const reference = parseInternalReference(trailing ? href.slice(0, -trailing.length) : href);
      if (!reference) return candidate;
      const label = rawLabel
        ? decodeInternalReferenceLabel(rawLabel).trim()
        : INTERNAL_REFERENCE_DEFAULT_LABEL;
      const visibleLabel = redactInvites && reference.kind === 'INVITE'
        ? INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL
        : label || INTERNAL_REFERENCE_DEFAULT_LABEL;
      return `${visibleLabel}${trailing}`;
    },
  );
  if (!redactInvites) return preview;
  return preview
    .replace(INVITE_MARKDOWN_PREVIEW_RE, INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL)
    .replace(INVITE_LOCATION_PREVIEW_RE, INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL);
}

/** 会话列表只显示脱敏纯文本；完整正文仍由消息详情按原字符串返回。 */
export function formatDirectMessagePreview(value: string): string {
  return formatInternalReferencePreview(value, { redactInvites: true })
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
}
