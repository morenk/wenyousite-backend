import sanitizeHtml from 'sanitize-html';

const sanitizeConfig: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
  allowedSchemes: ['http', 'https', 'ftp', 'mailto'],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
};

/**
 * 内容安全转换函数：剥离 HTML 标签和危险协议
 * 配合 class-transformer @Transform 装饰器在 ValidationPipe transform 阶段使用
 */
export function sanitizeContent(value: unknown): string {
  if (typeof value !== 'string') return '';
  return sanitizeHtml(value, sanitizeConfig);
}
