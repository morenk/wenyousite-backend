import { PipeTransform, Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * 内容安全管道：剥离 HTML 标签和危险协议，保留 BBCode / Markdown 标记
 * 适用于所有 content 字段（帖子正文、草稿、主题帖正文等）
 */
@Injectable()
export class SanitizeContentPipe implements PipeTransform<string, string> {
  private static readonly config: sanitizeHtml.IOptions = {
    allowedTags: [], // 不允许任何 HTML 标签
    allowedAttributes: {}, // 不允许任何 HTML 属性
    disallowedTagsMode: 'discard', // 丢弃标签，保留内容
    // 允许的 URL 协议白名单
    allowedSchemes: ['http', 'https', 'ftp', 'mailto'],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
  };

  transform(value: string): string {
    if (!value) return value;
    return sanitizeHtml(value, SanitizeContentPipe.config);
  }
}
