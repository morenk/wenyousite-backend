import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 用户参与帖子分页查询；可见性分类仅对本人查看生效。 */
export class PlayedThreadsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: ['PUBLIC', 'PRIVATE'],
    description: '按公开帖或私密帖筛选。本人可筛选全部实际参与帖；他人请求 PRIVATE 返回空列表',
  })
  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility?: 'PUBLIC' | 'PRIVATE';
}
