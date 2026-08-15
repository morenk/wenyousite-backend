import {
  findUnsupportedMarkdownFormats,
  literalizeUnsupportedMarkdown,
  type UnsupportedMarkdownType,
} from './markdown-content';

export interface VersionedMarkdownRecord {
  id: string;
  content: string;
  version: number;
}

export interface MarkdownV3MigrationChange extends VersionedMarkdownRecord {
  nextContent: string;
  nextVersion: number;
  unsupportedTypes: UnsupportedMarkdownType[];
}

export function planMarkdownV3Migration(
  records: VersionedMarkdownRecord[],
): MarkdownV3MigrationChange[] {
  return records.flatMap((record) => {
    const issues = findUnsupportedMarkdownFormats(record.content);
    if (issues.length === 0) return [];
    return [{
      ...record,
      nextContent: literalizeUnsupportedMarkdown(record.content),
      nextVersion: record.version + 1,
      unsupportedTypes: [...new Set(issues.map((item) => item.type))],
    }];
  });
}

export interface ExistingMentionRelation {
  id: string;
  mentionedUserId: string;
  username: string;
  source: 'DIRECT' | 'ALL_PLAYERS';
}

const DIRECT_MENTION_RE = /(?:^|[^a-zA-Z0-9_\u4e00-\u9fff])@([a-zA-Z0-9_\u4e00-\u9fff]{1,24})/gu;
const CANONICAL_MENTION_RE = /\[@[^\]]{1,32}\]\(\/users\/([a-zA-Z0-9_-]+)\)/g;

function isEscaped(content: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function stripInlineCode(line: string): string {
  let result = '';
  let index = 0;
  while (index < line.length) {
    if (line[index] !== '`') {
      result += line[index];
      index++;
      continue;
    }
    const openingStart = index;
    while (line[index] === '`') index++;
    const openingLength = index - openingStart;
    let cursor = index;
    let closingEnd = -1;
    while (cursor < line.length) {
      const nextRun = line.indexOf('`', cursor);
      if (nextRun < 0) break;
      let runEnd = nextRun;
      while (line[runEnd] === '`') runEnd++;
      if (runEnd - nextRun === openingLength) {
        closingEnd = runEnd;
        break;
      }
      cursor = runEnd;
    }
    if (closingEnd < 0) {
      result += '`'.repeat(openingLength);
      continue;
    }
    result += ' ';
    index = closingEnd;
  }
  return result;
}

function stripMarkdownCode(content: string): string {
  return content.replace(/\r\n?/g, '\n').split('\n').map(stripInlineCode).join('\n');
}

/**
 * 字面降级不会产生新的提及，只可能使原提及失活；迁移据此删除陈旧派生关系。
 * 这条纯函数刻意不创建通知、活动或新收件人。
 */
export function staleMentionRelationIds(
  content: string,
  relations: ExistingMentionRelation[],
): string[] {
  const withoutCode = stripMarkdownCode(content);
  const userIds = new Set<string>();
  const withoutCanonical = withoutCode.replace(
    CANONICAL_MENTION_RE,
    (marker: string, userId: string, offset: number) => {
      if (!isEscaped(withoutCode, offset)) userIds.add(userId);
      return ' '.repeat(marker.length);
    },
  );
  const usernames = new Set(
    [...withoutCanonical.matchAll(DIRECT_MENTION_RE)]
      .filter((match) => {
        const atOffset = match[0].indexOf('@');
        return match.index !== undefined && !isEscaped(withoutCanonical, match.index + atOffset);
      })
      .map((match) => match[1]),
  );
  const hasAllPlayers = usernames.delete('全体玩家');

  return relations
    .filter((relation) => relation.source === 'ALL_PLAYERS'
      ? !hasAllPlayers
      : !userIds.has(relation.mentionedUserId) && !usernames.has(relation.username))
    .map((relation) => relation.id);
}
