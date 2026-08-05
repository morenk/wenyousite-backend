import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DiceRoll, NumberGenerator, Results } from '@dice-roller/rpg-dice-roller';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export const MAX_DICE_ROLLS_PER_POST = 20;
export const DICE_PROTOCOL_VERSION = 1;

export interface ParsedDiceNotation {
  notation: string;
  quantity: number;
  sides: number;
  modifier: number;
}

export interface GeneratedDiceRoll extends ParsedDiceNotation {
  protocolVersion: number;
  results: number[];
  total: number;
}

export interface DiceRollCreateData extends GeneratedDiceRoll {
  postId: string;
  sequence: number;
}

/** 基础骰子协议：白名单解析 NdM±K，并由服务端密码学随机源生成正式结果。 */
@Injectable()
export class DiceService {
  private readonly logger = new Logger(DiceService.name);

  constructor() {
    NumberGenerator.generator.engine = NumberGenerator.engines.nodeCrypto;
  }

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

  validateNotations(notations: string[] = [], existingCount = 0): ParsedDiceNotation[] {
    if (existingCount + notations.length > MAX_DICE_ROLLS_PER_POST) {
      throw new BusinessException(
        ErrorCode.DICE_ROLL_LIMIT_EXCEEDED,
        `每个帖子最多包含 ${MAX_DICE_ROLLS_PER_POST} 次骰子结果`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return notations.map((notation) => this.parse(notation));
  }

  canonicalizeNotations(notations: string[] = [], existingCount = 0): string[] {
    return this.validateNotations(notations, existingCount).map((parsed) => parsed.notation);
  }

  roll(parsed: ParsedDiceNotation): GeneratedDiceRoll {
    try {
      const roll = new DiceRoll(parsed.notation);
      const dieResults = roll.rolls[0];
      if (!(dieResults instanceof Results.RollResults)) {
        throw new Error('骰子库返回了非预期的结果结构');
      }
      const results = dieResults.rolls.map((result) => result.value);
      if (results.length !== parsed.quantity || !results.every(Number.isSafeInteger)) {
        throw new Error('骰子库返回的逐骰结果数量或类型不合法');
      }
      return {
        ...parsed,
        protocolVersion: DICE_PROTOCOL_VERSION,
        results,
        total: roll.total,
      };
    } catch (error) {
      this.logger.error(`生成骰子结果失败 notation=${parsed.notation}`, error);
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '骰子结果生成失败，请稍后重试',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  rollAll(parsed: ParsedDiceNotation[]): GeneratedDiceRoll[] {
    return parsed.map((notation) => this.roll(notation));
  }

  buildCreateData(
    postId: string,
    rolls: GeneratedDiceRoll[],
    existingCount = 0,
  ): DiceRollCreateData[] {
    return rolls.map((roll, index) => ({
      postId,
      sequence: existingCount + index + 1,
      ...roll,
    }));
  }

  private invalidNotation(): never {
    throw new BusinessException(
      ErrorCode.INVALID_DICE_NOTATION,
      '骰子表达式不合法，请使用 NdM、NdM+K 或 NdM-K',
      HttpStatus.BAD_REQUEST,
    );
  }
}
