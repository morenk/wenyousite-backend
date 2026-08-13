import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** 设置个人主页背景图请求参数。 */
export class SetProfileCoverDto {
  @ApiProperty({ example: 'clxabc123...', description: 'upload-url 返回的 mediaId' })
  @IsString()
  @MinLength(1)
  mediaId!: string;
}
