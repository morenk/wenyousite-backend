export const FONT_COMPILER_STAGES = [
  'environment',
  'read-input',
  'open-font',
  'read-metadata',
  'decompile',
  'instantiate',
  'normalize',
  'subset',
  'rename',
  'serialize-mobile',
  'serialize-web',
  'render-specimen',
  'write-manifest',
] as const;
export const FONT_DIAGNOSTIC_CATEGORIES = [
  'validation',
  'memory-error',
  'invalid-font',
  'value-error',
  'type-error',
  'key-error',
  'attribute-error',
  'io-error',
  'assertion-error',
  'unsupported-operation',
  'unexpected-error',
] as const;
export type FontCompilerDiagnostic = {
  stage: (typeof FONT_COMPILER_STAGES)[number];
  category: (typeof FONT_DIAGNOSTIC_CATEGORIES)[number];
};
export type FontProcessingStage =
  | 'authorization'
  | 'build-identity'
  | 'cached-assets'
  | 'workspace'
  | 'source-read'
  | 'compiler'
  | 'manifest-validation'
  | 'asset-validation'
  | 'asset-write'
  | 'persist'
  | 'workspace-cleanup';

/** 子进程输出不可信；只接收有限枚举，不透传消息、路径、栈或额外字段。 */
export function fontCompilerDiagnostic(value: unknown): FontCompilerDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { stage, category } = value as Partial<FontCompilerDiagnostic>;
  if (!FONT_COMPILER_STAGES.includes(stage!) || !FONT_DIAGNOSTIC_CATEGORIES.includes(category!))
    return undefined;
  return { stage: stage!, category: category! };
}
