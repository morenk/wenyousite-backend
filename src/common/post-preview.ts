import { truncateMarkdown } from './markdown-truncate';

interface DiceSummary {
  nodeId: string;
  notation: string;
  total: number;
}

const DICE_NODE_RE =
  /\[\[dice:v1:([0-9a-f-]{36}):([^\]\r\n]{1,32})\]\]/giu;

/** 通知和动态共用的帖子摘要；骰子结果按正文位置转换为普通文字。 */
export function buildPostPreview(content: string, diceRolls: DiceSummary[] = []): string {
  const byNodeId = new Map(diceRolls.map((roll) => [roll.nodeId, roll]));
  const resolved = content.replace(DICE_NODE_RE, (_, nodeId: string, notation: string) => {
    const roll = byNodeId.get(nodeId.toLowerCase());
    return `${roll?.notation ?? notation} = ${roll?.total ?? '?'}`;
  });
  return truncateMarkdown(resolved);
}
