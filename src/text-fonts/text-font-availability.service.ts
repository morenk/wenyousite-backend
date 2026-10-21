import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** 契约切片尚未安装运行依赖时关闭新路径；能力不会提前声明可写。 */
@Injectable()
export class TextFontAvailabilityService {
  request(operation: string, ...input: unknown[]): never {
    void operation;
    void input;
    throw new BusinessException(
      ErrorCode.TEXT_FONT_UNAVAILABLE,
      '动态字体暂不可用，请稍后重试',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
