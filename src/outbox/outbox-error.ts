/** 仅保留受控类别与错误码；异常正文、堆栈、cause 和聚合子错误可能包含私密载荷。 */
const SAFE_CODES = new Set([
  'P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2002', 'P2024', 'P2025', 'P2034',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
]);

export function outboxErrorDetails(error: unknown) {
  const errorType = error instanceof AggregateError ? 'AggregateError'
    : error instanceof TypeError ? 'TypeError'
    : error instanceof RangeError ? 'RangeError'
    : error instanceof Error ? 'Error' : 'UnknownError';
  let errorCode = 'operation_failed';
  // 不执行异常对象自定义 getter 或 toString，避免序列化本身失败或泄漏字段。
  if (error && typeof error === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string' && SAFE_CODES.has(descriptor.value)) {
      errorCode = descriptor.value;
    }
  }
  return { errorType, errorCode };
}
