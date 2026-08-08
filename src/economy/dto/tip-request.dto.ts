import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class TipRequestDto {
  @ApiProperty({
    type: String,
    example: '10',
    pattern: '^(?:[2-9]|[1-9]\\d+)$',
    description: '打赏升数；只接受不小于 2 的十进制正整数字符串',
  })
  @IsString()
  @Matches(/^(?:[2-9]|[1-9]\d+)$/, { message: '打赏金额必须是不小于 2 的整数升' })
  amount!: string;

  @ApiProperty({ format: 'uuid', description: '客户端生成的幂等请求 ID' })
  @IsUUID()
  clientRequestId!: string;
}
