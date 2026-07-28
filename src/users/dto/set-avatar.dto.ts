import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** 设置头像请求参数 */
export class SetAvatarDto {
  @ApiProperty({ example: 'clxabc123...', description: 'upload-url 返回的 mediaId' })
  @IsString()
  @MinLength(1)
  mediaId: string;
}
