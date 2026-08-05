import { NumberGenerator } from '@dice-roller/rpg-dice-roller';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DiceService } from './dice.service';

describe('DiceService', () => {
  let service: DiceService;

  beforeEach(() => {
    service = new DiceService();
  });

  afterEach(() => {
    NumberGenerator.generator.engine = NumberGenerator.engines.nodeCrypto;
  });

  it.each([
    ['d20', '1d20', 1, 20, 0],
    [' 2D6 + 03 ', '2d6+3', 2, 6, 3],
    ['4d8-10', '4d8-10', 4, 8, -10],
  ])('规范化 %s', (input, notation, quantity, sides, modifier) => {
    expect(service.parse(input)).toEqual({ notation, quantity, sides, modifier });
  });

  it.each([
    '0d6',
    '101d6',
    '1d1',
    '1d1001',
    '1d20+10001',
    '2d20kh1',
    'd%',
    '1d6+1d8',
    '1d6 # 标签',
  ])('拒绝超限或高级表达式 %s', (notation) => {
    expect(() => service.parse(notation)).toThrow(BusinessException);
    try {
      service.parse(notation);
    } catch (error) {
      expect(error).toMatchObject({ errorCode: ErrorCode.INVALID_DICE_NOTATION });
    }
  });

  it('限制每帖最多二十次结果', () => {
    expect(() => service.validateNotations(['1d6'], 20)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.DICE_ROLL_LIMIT_EXCEEDED }),
    );
  });

  it('保留逐骰结果、修正值与总计', () => {
    NumberGenerator.generator.engine = NumberGenerator.engines.min;
    const result = service.roll(service.parse('3d6+2'));
    expect(result).toEqual({
      notation: '3d6+2',
      quantity: 3,
      sides: 6,
      modifier: 2,
      protocolVersion: 1,
      results: [1, 1, 1],
      total: 5,
    });
  });
});
