import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/** 为主题帖添加标签 DTO */
export class AddThreadTagDto {
  @ApiProperty({ description: '标签名', minLength: 1, maxLength: 20 })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  name: string;
}
