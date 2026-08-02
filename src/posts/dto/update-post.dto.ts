import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MinLength, MaxLength, Min } from 'class-validator';

/** 编辑帖子 DTO */
export class UpdatePostDto {
  @ApiProperty({ example: '编辑后的内容...', description: '新正文', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiProperty({ example: 1, minimum: 1, description: '乐观锁版本号（必填，前端需先 fetch 获取当前 version，传入过期版本会返回 409）' })
  @IsInt()
  @Min(1)
  version: number;
}
