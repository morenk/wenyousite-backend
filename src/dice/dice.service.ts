import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt as cryptoRandomInt } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export const MAX_DICE_ROLLS_PER_POST = 20;
export const DICE_PROTOCOL_VERSION = 1;
export const DICE_NODE_PREFIX = '[[dice:v1:';

const UUID_V4_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DICE_NODE_AT_START_RE = new RegExp(
  `^\\[\\[dice:v1:(${UUID_V4_SOURCE}):([^\\]\\r\\n]{1,32})\\]\\]`,
  'iu',
);

export interface ParsedDiceNotation {
  notation: string;
  quantity: number;
  sides: number;
  modifier: number;
}

export interface DiceNodeIntent extends ParsedDiceNotation {
  nodeId: string;
}

export interface ParsedDiceContent {
  content: string;
  contentWithoutDice: string;
  nodes: DiceNodeIntent[];
}

export interface GeneratedDiceRoll extends ParsedDiceNotation {
  protocolVersion: number;
  results: number[];
  total: number;
}

export interface GeneratedDiceNodeRoll extends GeneratedDiceRoll {
  nodeId: string;
}

export interface DiceRollCreateData extends GeneratedDiceNodeRoll {
  postId: string;
}

export type DiceRandomInt = (minInclusive: number, maxExclusive: number) => number;

/** 使用可替换的密码学整数源生成结果；maxExclusive 与 node:crypto.randomInt 一致。 */
export function generateDiceRoll(
  parsed: ParsedDiceNotation,
  randomInt: DiceRandomInt = cryptoRandomInt,
): GeneratedDiceRoll {
  const results = Array.from({ length: parsed.quantity }, () => randomInt(1, parsed.sides + 1));
  if (
    results.length !== parsed.quantity ||
    !results.every((value) => Number.isSafeInteger(value) && value >= 1 && value <= parsed.sides)
  ) {
    throw new Error('随机整数源返回了超出骰子范围的结果');
  }

  return {
    ...parsed,
    protocolVersion: DICE_PROTOCOL_VERSION,
    results,
    total: results.reduce((sum, value) => sum + value, parsed.modifier),
  };
}

/** 基础骰子协议：正文保存位置节点，正式结果仅由服务端密码学随机源生成。 */
@Injectable()
export class DiceService {
  private readonly logger = new Logger(DiceService.name);

  parse(notation: string): ParsedDiceNotation {
    const match = /^\s*(?:(\d+)\s*)?[dD]\s*(\d+)(?:\s*([+-])\s*(\d+))?\s*$/.exec(notation);
    if (!match) this.invalidNotation();

    const quantity = Number(match![1] ?? 1);
    const sides = Number(match![2]);
    const modifierMagnitude = Number(match![4] ?? 0);
    const modifier = match![3] === '-' ? -modifierMagnitude : modifierMagnitude;

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 100 ||
      !Number.isSafeInteger(sides) ||
      sides < 2 ||
      sides > 1000 ||
      !Number.isSafeInteger(modifier) ||
      Math.abs(modifier) > 10000
    ) {
      this.invalidNotation();
    }

    const modifierText = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
    return {
      notation: `${quantity}d${sides}${modifierText}`,
      quantity,
      sides,
      modifier,
    };
  }

  /** 解析并规范化正文中的骰子节点；代码、围栏代码和反斜杠转义中的标记保持为普通文字。 */
  parseContent(markdown: string): ParsedDiceContent {
    const lines = markdown.split('\n');
    const nodes: DiceNodeIntent[] = [];
    const nodeIds = new Set<string>();
    const canonicalLines: string[] = [];
    const withoutDiceLines: string[] = [];
    let fence: { marker: '`' | '~'; length: number } | null = null;

    for (const line of lines) {
      const fenceToken = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (fence) {
        canonicalLines.push(line);
        withoutDiceLines.push(line);
        const closing = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
        if (closing?.[0] === fence.marker && closing.length >= fence.length) fence = null;
        continue;
      }
      if (fenceToken) {
        fence = { marker: fenceToken[0] as '`' | '~', length: fenceToken.length };
        canonicalLines.push(line);
        withoutDiceLines.push(line);
        continue;
      }

      let canonical = '';
      let withoutDice = '';
      let index = 0;
      while (index < line.length) {
        if (line[index] === '\\') {
          const escaped = line.slice(index, Math.min(index + 2, line.length));
          canonical += escaped;
          withoutDice += escaped;
          index += escaped.length;
          continue;
        }

        if (line[index] === '`') {
          let runLength = 1;
          while (line[index + runLength] === '`') runLength++;
          const delimiter = '`'.repeat(runLength);
          const closingIndex = line.indexOf(delimiter, index + runLength);
          if (closingIndex >= 0) {
            const code = line.slice(index, closingIndex + runLength);
            canonical += code;
            withoutDice += code;
            index = closingIndex + runLength;
            continue;
          }
        }

        if (
          line.slice(index, index + DICE_NODE_PREFIX.length).toLowerCase() === DICE_NODE_PREFIX
        ) {
          const match = DICE_NODE_AT_START_RE.exec(line.slice(index));
          if (!match) this.invalidNode('骰子节点格式不合法');
          const nodeId = match![1].toLowerCase();
          if (nodeIds.has(nodeId)) this.invalidNode('同一正文中不能重复使用骰子节点');
          const parsed = this.parse(match![2]);
          const marker = this.serializeNode(nodeId, parsed.notation);
          nodeIds.add(nodeId);
          nodes.push({ nodeId, ...parsed });
          canonical += marker;
          index += match![0].length;
          continue;
        }

        canonical += line[index];
        withoutDice += line[index];
        index++;
      }
      canonicalLines.push(canonical);
      withoutDiceLines.push(withoutDice);
    }

    if (nodes.length > MAX_DICE_ROLLS_PER_POST) {
      throw new BusinessException(
        ErrorCode.DICE_ROLL_LIMIT_EXCEEDED,
        `每个帖子最多包含 ${MAX_DICE_ROLLS_PER_POST} 个骰子节点`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      content: canonicalLines.join('\n'),
      contentWithoutDice: withoutDiceLines.join('\n'),
      nodes,
    };
  }

  serializeNode(nodeId: string, notation: string): string {
    return `${DICE_NODE_PREFIX}${nodeId}:${notation}]]`;
  }

  roll(parsed: ParsedDiceNotation): GeneratedDiceRoll {
    try {
      return generateDiceRoll(parsed);
    } catch (error) {
      this.logger.error(`生成骰子结果失败 notation=${parsed.notation}`, error);
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '骰子结果生成失败，请稍后重试',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  rollNodes(nodes: DiceNodeIntent[]): GeneratedDiceNodeRoll[] {
    return nodes.map((node) => ({ nodeId: node.nodeId, ...this.roll(node) }));
  }

  buildCreateData(postId: string, rolls: GeneratedDiceNodeRoll[]): DiceRollCreateData[] {
    return rolls.map((roll) => ({ postId, ...roll }));
  }

  private invalidNotation(): never {
    throw new BusinessException(
      ErrorCode.INVALID_DICE_NOTATION,
      '骰子表达式不合法，请使用 NdM、NdM+K 或 NdM-K',
      HttpStatus.BAD_REQUEST,
    );
  }

  private invalidNode(message: string): never {
    throw new BusinessException(
      ErrorCode.INVALID_DICE_NOTATION,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
