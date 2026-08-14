import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/** 设置个人主页背景图请求参数。 */
export class SetProfileCoverDto {
  @ApiProperty({ example: 'clxabc123...', description: '电脑端 3:1 背景图 mediaId' })
  @IsString()
  @MinLength(1)
  mediaId!: string;

  @ApiPropertyOptional({
    example: 'clxmobile456...',
    description: '移动端 2:1 背景图 mediaId；旧客户端省略时会清空移动端裁切',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  mobileMediaId?: string;
}
