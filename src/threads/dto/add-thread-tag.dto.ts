import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { MAX_TAG_NAME_LENGTH, TAG_NAME_PATTERN } from '../../tags/tag-name';

/** 为主题帖添加标签 DTO */
export class AddThreadTagDto {
  @ApiProperty({ example: '无限流', description: '主题帖标签名', minLength: 1, maxLength: 20 })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TAG_NAME_LENGTH)
  @Matches(TAG_NAME_PATTERN, {
    message: '标签名只能包含字母、数字、下划线、中文和 #',
  })
  name: string;
}
