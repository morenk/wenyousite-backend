import { buildPostPreview } from './post-preview';

const NODE_ONE = '550e8400-e29b-41d4-a716-446655440000';
const NODE_TWO = '550e8400-e29b-41d4-a716-446655440001';

describe('buildPostPreview', () => {
  it('按正文位置把骰子节点转换为表达式和正式总点数', () => {
    const content = `**行动** [[dice:v1:${NODE_ONE}:1d20+2]] 完成`;
    expect(
      buildPostPreview(content, [{ nodeId: NODE_ONE, notation: '1d20+2', total: 17 }]),
    ).toBe('行动 1d20+2 = 17 完成');
  });

  it('纯骰子帖仍产生摘要且不显示骰子图标', () => {
    const content = `[[dice:v1:${NODE_ONE}:2d6]]`;
    expect(buildPostPreview(content, [{ nodeId: NODE_ONE, notation: '2d6', total: 8 }])).toBe(
      '2d6 = 8',
    );
  });

  it('未结算节点显示问号并保留正文顺序', () => {
    const content = `前 [[dice:v1:${NODE_ONE}:1d6]] 中 [[dice:v1:${NODE_TWO}:1d8]] 后`;
    expect(buildPostPreview(content)).toBe('前 1d6 = ? 中 1d8 = ? 后');
  });
});
