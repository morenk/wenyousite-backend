import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { DiceService } from '../../src/dice/dice.service';
import { prepareMarkdownContent } from '../../src/common/markdown-content';

export type Marks = Record<string, true | string>;
export type Inline = { type: string; text?: string; marks?: Marks; [key: string]: unknown };
export interface Block {
  type: string;
  alignment?: string;
  level?: number;
  children?: Array<Block | Inline>;
}
export interface Summary { blocks: Block[] }
export interface Profile { markdownVersions: number[]; features: string[]; evidence: string }
export interface Selection { anchor: { path: number[]; offset: number }; focus: { path: number[]; offset: number } }
export interface Snapshot {
  canonical: string | null;
  summary: Summary;
  selection?: Selection;
  save?: { requestMarkdown: string | null; persistedMarkdown: string; dirty: boolean; target?: string };
  navigation?: 'stay' | 'close';
}
export interface BehaviorCase {
  id: string;
  initial: Snapshot;
  steps: Array<{ id: string; operation: { type: string; [key: string]: unknown }; expected: Snapshot }>;
}
export interface Fixture {
  cases: BehaviorCase[];
  profiles: Record<string, Profile>;
  compatibilityCases: Array<{ id: string; profile: string; markdown: string; lossless: boolean; expected: Capability }>;
  rejected: Array<{ id: string; markdown: string; errorCode: number }>;
}
export interface Capability { read: 'full' | 'safe-fallback'; create: boolean; edit: boolean; reason: string }

const dice = new DiceService();
export function canonicalize(markdown: string): string {
  return dice.parseContent(prepareMarkdownContent(markdown)).content;
}
const empty = /^ {0,3}<br\s*\/?>[\t ]*$/iu;
const quoteEmpty = /^ {0,3}>[\t ]?<br\s*\/?>[\t ]*$/iu;
const alignment = /^\[wenyousite-align-v1-(center|right)\]: #$/u;
const parser = new MarkdownIt({ html: true, linkify: true, typographer: false });
// 只在真实 inline 位置识别；Markdown 的 escape/code 规则先消费字面标记。
parser.inline.ruler.before('link', 'wenyou-dice', (state, silent) => {
  const match = /^\[\[dice:v1:([0-9a-f-]+):([^\]\r\n]+)\]\]/iu.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('wenyou_dice', '', 0).meta = { nodeId: match[1], notation: match[2] };
  state.pos += match[0].length;
  return true;
});
parser.inline.ruler.before('text', 'wenyou-mention-all', (state, silent) => {
  if (!state.src.startsWith('@全体玩家', state.pos)) return false;
  if (!silent) state.push('wenyou_mention_all', '', 0);
  state.pos += '@全体玩家'.length;
  return true;
});

function inlineSummary(tokens: Token[]): Inline[] {
  const output: Inline[] = [];
  const marks: Marks = {};
  const pushText = (value: string, valueMarks: Marks = marks) => {
    if (!value) return;
    const previous = output.at(-1);
    if (previous?.type === 'text' && equal(previous.marks, valueMarks)) previous.text += value;
    else output.push({ type: 'text', text: value, marks: { ...valueMarks } });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const style = ({ strong: 'bold', em: 'italic', s: 'strike' } as Record<string, string>)[token.type.replace(/_(open|close)$/, '')];
    if (style) {
      if (token.nesting === 1) marks[style] = true;
      else delete marks[style];
      continue;
    }
    if (token.type === 'link_open') {
      const href = token.attrGet('href') ?? '';
      const userId = /^\/users\/([^/?#]+)$/u.exec(href)?.[1];
      if (userId && tokens[index + 1]?.type === 'text' && tokens[index + 1].content.startsWith('@') && tokens[index + 2]?.type === 'link_close') {
        output.push({ type: 'mention', userId, label: tokens[index + 1].content });
        index += 2;
      } else marks.link = href;
    } else if (token.type === 'link_close') delete marks.link;
    else if (token.type === 'text') pushText(token.content);
    else if (token.type === 'code_inline') pushText(token.content, { ...marks, code: true });
    else if (token.type === 'softbreak') output.push({ type: 'softBreak' });
    else if (token.type === 'wenyou_dice') output.push({ type: 'dice', ...token.meta });
    else if (token.type === 'wenyou_mention_all') output.push({ type: 'mentionAll', label: '@全体玩家' });
    else if (token.type === 'image') {
      const title = token.attrGet('title');
      const url = token.attrGet('src') ?? '';
      const assetId = title?.startsWith('wenyousite-sticker:v1:') ? title.slice('wenyousite-sticker:v1:'.length) : null;
      output.push(assetId ? { type: 'sticker', assetId, url, alt: token.content }
        : { type: 'image', url, alt: token.content, title });
    } else throw new Error('summary-unsupported-inline');
  }
  return output;
}

/** 独立离线结构提取；仅覆盖测试 schema 的节点，绝不猜测旧 LF 的输入动作。 */
export function summarize(markdown: string): Summary {
  const canonical = canonicalize(markdown);
  const lines = canonical.split('\n');
  const source = lines.map((line) => empty.test(line) ? '***' : quoteEmpty.test(line) ? '> ***' : line).join('\n');
  const blocks: Block[] = [];
  const stack: Block[] = [];
  const append = (block: Block) => {
    const parent = stack.at(-1);
    if (parent) parent.children!.push(block);
    else blocks.push(block);
  };
  for (const token of parser.parse(source, {})) {
    if (token.type === 'blockquote_open') {
      const block: Block = { type: 'blockquote', children: [] };
      append(block); stack.push(block);
    } else if (token.type === 'paragraph_open' || token.type === 'heading_open') {
      const block: Block = { type: token.type === 'heading_open' ? 'heading' : 'paragraph',
        ...(token.type === 'heading_open' ? { level: Number(token.tag.slice(1)) } : {}),
        alignment: token.level === 0 ? alignment.exec(lines[(token.map?.[0] ?? 0) - 1] ?? '')?.[1] ?? 'left' : 'left', children: [] };
      append(block); stack.push(block);
    } else if (['blockquote_close', 'paragraph_close', 'heading_close'].includes(token.type)) stack.pop();
    else if (token.type === 'inline') stack.at(-1)!.children = inlineSummary(token.children ?? []);
    else if (token.type === 'hr') {
      const original = lines[token.map?.[0] ?? 0];
      append(empty.test(original) || quoteEmpty.test(original)
        ? { type: 'paragraph', alignment: 'left', children: [] } : { type: 'divider' });
    } else throw new Error('summary-unsupported-block');
  }
  return { blocks };
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}
export function equal(a: unknown, b: unknown): boolean { return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); }

/** 仅用来验证消费者声明，不以 Markdown 版本号推定已安装 APK 的实际能力。 */
export function assessCapability(markdown: string, profile: Profile | undefined, lossless: boolean): Capability {
  const reject = (reason: string, read: Capability['read'] = 'safe-fallback'): Capability => ({ read, create: false, edit: false, reason });
  if (!profile) return reject('unknown-profile');
  let canonical: string;
  try { canonical = canonicalize(markdown); } catch { return reject('unsupported-markdown'); }
  const features = new Set(['base']);
  const lines = canonical.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (quoteEmpty.test(lines[index])) features.add('quote-empty-row');
    if (alignment.test(lines[index])) {
      const target = parser.parse(lines[index + 1] ?? '', {}).find((token) => token.type === 'inline');
      const standalone = target?.children?.length === 1 && target.children[0].type === 'image'
        && !target.children[0].attrGet('title')?.startsWith('wenyousite-sticker:v1:');
      features.add(standalone ? 'image-alignment' : 'block-alignment');
    }
  }
  const minimumVersion = features.has('image-alignment') ? 5 : features.has('block-alignment') ? 4 : 3;
  if (!profile.markdownVersions.includes(minimumVersion) || [...features].some((feature) => !profile.features.includes(feature))) return reject('missing-feature');
  if (!lossless) return reject('lossy-roundtrip', 'full');
  return { read: 'full', create: true, edit: true, reason: 'supported' };
}

export function validSelection(summary: Summary, selection: Selection): boolean {
  return [selection.anchor, selection.focus].every(({ path, offset }) => {
    let children: Array<Block | Inline> = summary.blocks;
    let block: Block | undefined;
    for (const index of path) {
      block = children[index] as Block | undefined;
      if (!block) return false;
      children = block.children ?? [];
    }
    if (!block || !['paragraph', 'heading'].includes(block.type)) return false;
    const length = children.reduce((total, child) => total + (child.type === 'text' ? ((child as Inline).text?.length ?? 0) : 1), 0);
    return Number.isInteger(offset) && offset >= 0 && offset <= length;
  });
}
