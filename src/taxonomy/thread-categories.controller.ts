import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ThreadCategoryResponseDto } from './dto/thread-category-response.dto';
import { ThreadCategoriesService } from './thread-categories.service';

@ApiTags('Thread Categories')
@Controller('thread-categories')
export class ThreadCategoriesController {
  constructor(private readonly categories: ThreadCategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '获取管理员配置的可用主题帖分类' })
  @ApiOkResponse({ type: ThreadCategoryResponseDto, isArray: true })
  list() {
    return this.categories.listActive();
  }
}
