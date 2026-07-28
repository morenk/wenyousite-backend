import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostQueryDto } from './dto/post-query.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 楼层控制器：发帖、楼中楼、编辑、删除 */
@ApiTags('Posts')
@Controller()
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Get('subthreads/:subthreadId/posts')
  @Public()
  @ApiOperation({ summary: '获取子贴的楼层列表（Cursor 分页）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数' })
  async findFloors(
    @Param('subthreadId') subthreadId: string,
    @Query() query: PostQueryDto,
  ) {
    return this.postsService.findAllBySubthread(subthreadId, query.cursor, query.limit);
  }

  @Get('posts/:id/replies')
  @Public()
  @ApiOperation({ summary: '获取楼中楼回复列表（cursor 分页，无限下拉）' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findReplies(
    @Param('id') id: string,
    @Query() query: PostQueryDto,
  ) {
    return this.postsService.findReplies(id, query.cursor, query.limit);
  }

  @Post('subthreads/:subthreadId/posts')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '发帖（创建新楼层或楼中楼回复）' })
  async create(
    @Param('subthreadId') subthreadId: string,
    @Body() dto: CreatePostDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.postsService.create(subthreadId, dto, user.id);
  }

  @Get('posts/:id')
  @Public()
  @ApiOperation({ summary: '获取帖子详情' })
  async findById(@Param('id') id: string) {
    return this.postsService.findById(id);
  }

  @Patch('posts/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑帖子' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.postsService.update(id, dto, user.id);
  }

  @Delete('posts/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除帖子（不能删除子贴第一楼）' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.remove(id, user.id);
    return { message: '帖子已删除' };
  }

  @Post('posts/:id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞帖子' })
  async like(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.postsService.like(id, user.id);
  }

  @Delete('posts/:id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消点赞' })
  async unlike(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.postsService.unlike(id, user.id);
  }
}
