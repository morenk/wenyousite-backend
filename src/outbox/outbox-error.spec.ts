import { outboxErrorDetails } from './outbox-error';

describe('Outbox 受控错误诊断', () => {
  it.each([null, undefined, 12, 'secret', { code: 'secret' }])('不序列化非 Error 原值', (error) => {
    expect(outboxErrorDetails(error)).toEqual({ errorType: 'UnknownError', errorCode: 'operation_failed' });
  });
  it.each([['ECONNRESET', 'Error'], ['P2034', 'Error']])('保留可诊断错误码 %s', (code, errorType) => {
    expect(outboxErrorDetails(Object.assign(new Error('secret'), { code }))).toEqual({ errorType, errorCode: code });
  });
  it('不执行 code getter 或自定义 toString', () => {
    const getter = jest.fn(() => { throw new Error('secret'); });
    const error = Object.defineProperty({ toString: getter }, 'code', { get: getter });
    expect(outboxErrorDetails(error).errorCode).toBe('operation_failed');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([new TypeError('secret'), new RangeError('secret'), new AggregateError([], 'secret')])('只识别内建类型', (error) => {
    expect(outboxErrorDetails(error).errorType).toBe(error.constructor.name);
  });
});
