import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, MaxLength, Min } from 'class-validator';

/** 编辑帖子 DTO */
export class UpdatePostDto {
  @ApiProperty({
    example: '编辑后的内容...',
    description: '新正文；骰子节点随正文移动或删除，新增节点由服务端结算',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '乐观锁版本号（必填，前端需先 fetch 获取当前 version，传入过期版本会返回 409）',
  })
  @IsInt()
  @Min(1)
  version: number;
}
