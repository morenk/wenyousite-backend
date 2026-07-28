import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

/** UUID 校验管道：用于 @Param() 路径参数的 UUID 格式校验 */
@Injectable()
export class ParseUUIDPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUUID(value, '4')) {
      throw new BadRequestException(`'${value}' 不是有效的 UUID 格式`);
    }
    return value;
  }
}
