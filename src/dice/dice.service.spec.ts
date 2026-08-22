import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DiceService, generateDiceRoll } from './dice.service';

describe('DiceService', () => {
  let service: DiceService;

  beforeEach(() => {
    service = new DiceService();
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

  it('解析正文节点并规范化表达式，同时忽略代码和转义文本', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const result = service.parseContent(
      `检定 [[dice:v1:${id}:2D6 + 03]] 完成\n\`[[dice:v1:${id}:1d20]]\`\n\\[[dice:v1:${id}:1d8]]`,
    );
    expect(result.nodes).toEqual([
      { nodeId: id, notation: '2d6+3', quantity: 2, sides: 6, modifier: 3 },
    ]);
    expect(result.content).toContain(`[[dice:v1:${id}:2d6+3]]`);
    expect(result.contentWithoutDice).toContain('检定  完成');
  });

  it('大小写不同的协议前缀也会规范化为 canonical 节点', () => {
    const id = '550E8400-E29B-41D4-A716-446655440000';
    const result = service.parseContent(`[[DICE:V1:${id}:D20]]`);

    expect(result.nodes).toEqual([
      {
        nodeId: id.toLowerCase(),
        notation: '1d20',
        quantity: 1,
        sides: 20,
        modifier: 0,
      },
    ]);
    expect(result.content).toBe(`[[dice:v1:${id.toLowerCase()}:1d20]]`);
  });

  it('拒绝重复节点、非法 UUID 和超过二十个节点', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(() =>
      service.parseContent(`[[dice:v1:${id}:1d6]] [[dice:v1:${id}:1d8]]`),
    ).toThrow(BusinessException);
    expect(() => service.parseContent('[[dice:v1:not-a-uuid:1d6]]')).toThrow(
      BusinessException,
    );
    try {
      service.parseContent('[[dice:v1:not-a-uuid:1d6]]');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: ErrorCode.INVALID_DICE_NOTATION });
    }
    const markers = Array.from({ length: 21 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, '0');
      return `[[dice:v1:550e8400-e29b-41d4-a716-${suffix}:1d6]]`;
    }).join(' ');
    expect(() => service.parseContent(markers)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.DICE_ROLL_LIMIT_EXCEEDED }),
    );
  });

  it('保留逐骰结果、修正值与总计', () => {
    const result = generateDiceRoll(service.parse('3d6+2'), (min) => min);
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

  it('随机整数源使用包含最小值、排除最大值的边界', () => {
    const calls: Array<[number, number]> = [];
    const parsed = service.parse('2d8-1');
    const result = generateDiceRoll(parsed, (min, max) => {
      calls.push([min, max]);
      return max - 1;
    });

    expect(calls).toEqual([
      [1, 9],
      [1, 9],
    ]);
    expect(result.results).toEqual([8, 8]);
    expect(result.total).toBe(15);
  });

  it('拒绝随机整数源返回范围外的结果', () => {
    expect(() => generateDiceRoll(service.parse('1d6'), () => 7)).toThrow(
      '随机整数源返回了超出骰子范围的结果',
    );
  });
});
