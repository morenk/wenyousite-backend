import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export const FONT_UPLOAD_RULE_VERSION = 'admin-font-upload-v1' as const;
export const FONT_SIMPLIFIED_PARAMETERS_VERSION = 2 as const;
export const FONT_LANGUAGE_SPECIMENS = {
  zh: '温油站，一起书写故事。0123456789',
  ja: '物語を一緒に紡ぎましょう。0123456789',
  en: 'The quick brown fox jumps over the lazy dog. 0123456789',
  other: 'Aa Bb Cc 0123456789',
} as const;

/** 契约先行阶段失败关闭；完整实现提交会替换此入口，不把草案当作上线能力。 */
export function fontManagementPending(): never {
  throw new BusinessException(
    ErrorCode.TEXT_FONT_UNAVAILABLE,
    '字体管理更新暂未就绪',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
