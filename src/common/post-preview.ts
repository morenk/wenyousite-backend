import { truncateMarkdown } from './markdown-truncate';

interface DiceSummary {
  notation: string;
  total: number;
}

/** 通知和动态共用的帖子摘要；正文为空时仍能展示正式骰子结果。 */
export function buildPostPreview(content: string, diceRolls: DiceSummary[] = []): string {
  const text = truncateMarkdown(content);
  if (diceRolls.length === 0) return text;
  const shown = diceRolls.slice(0, 3).map((roll) => `${roll.notation}=${roll.total}`);
  const remaining = diceRolls.length - shown.length;
  const diceText = `🎲 ${shown.join('、')}${remaining > 0 ? `，等${diceRolls.length}次` : ''}`;
  return text ? `${text} · ${diceText}` : diceText;
}
