import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { requireFontRights } from './font-domain';
import { FONT_UPLOAD_RULE_VERSION } from './font-management-contract';

export type FontUploadAuthorization = {
  actorId: string;
  confirmedAt: string;
  sourceSha256: string;
  ruleVersion: typeof FONT_UPLOAD_RULE_VERSION;
};

/** 授权证据只由源绑定事务写入；不传给处理器、公开 notices 或构建身份。 */
export function requireFontAuthorization(
  configuration: FontConfigurationDto,
  sourceSha256: string,
  parametersVersion = 1,
  authorization?: Prisma.JsonValue,
): void {
  if (parametersVersion === 1) return requireFontRights(configuration);
  const evidence = authorization as Partial<FontUploadAuthorization> | null | undefined;
  if (
    parametersVersion !== 2 ||
    !evidence ||
    typeof evidence.actorId !== 'string' ||
    !evidence.actorId ||
    typeof evidence.confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(evidence.confirmedAt)) ||
    evidence.sourceSha256 !== sourceSha256 ||
    evidence.ruleVersion !== FONT_UPLOAD_RULE_VERSION
  )
    throw new BusinessException(
      ErrorCode.TEXT_FONT_RIGHTS_REQUIRED,
      '字体上传确认记录无效，请重新提交',
      HttpStatus.CONFLICT,
    );
}
