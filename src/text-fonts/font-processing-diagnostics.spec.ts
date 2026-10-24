import { fontCompilerDiagnostic } from './font-processing-diagnostics';

describe('字体子进程诊断边界', () => {
  it('只保留固定枚举，丢弃原始消息、路径、栈和附加字段', () => {
    expect(
      fontCompilerDiagnostic({
        stage: 'instantiate',
        category: 'value-error',
        message: 'private-name',
        path: '/private/source',
        stack: 'private-stack',
      }),
    ).toEqual({
      stage: 'instantiate',
      category: 'value-error',
    });
  });
  it.each([
    null,
    [],
    'private-message',
    {},
    { stage: '/private/source', category: 'value-error' },
    { stage: 'instantiate', category: 'private-message' },
    { stage: ['instantiate'], category: 'value-error' },
  ])('拒绝枚举外诊断 %#', (value) => {
    expect(fontCompilerDiagnostic(value)).toBeUndefined();
  });
});
