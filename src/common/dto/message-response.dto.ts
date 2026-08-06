import { ApiProperty } from '@nestjs/swagger';

/** 无额外业务数据的命令结果。运行时会被统一响应拦截器放入 data。 */
export class MessageResponseDto {
  @ApiProperty({ description: '操作结果说明', example: '操作成功' })
  message: string;
}
