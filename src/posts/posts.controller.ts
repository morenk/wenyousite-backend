import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
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
  @ApiOkResponse({ description: '楼层列表（含楼中楼内联回复），cursor 分页' })
  async findFloors(
    @Param('subthreadId') subthreadId: string,
    @Query() query: PostQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    return this.postsService.findAllBySubthread(subthreadId, query.cursor, query.limit, user?.id);
  }

  @Get('posts/:id/replies')
  @Public()
  @ApiOperation({ summary: '获取楼中楼回复列表（cursor 分页，无限下拉）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标（上一页最后一条记录 ID）' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数（默认 20，最大 50）' })
  @ApiOkResponse({ description: '楼中楼回复列表（平级挂载，含 replyToPostId 追踪回复目标），cursor 分页' })
  async findReplies(
    @Param('id') id: string,
    @Query() query: PostQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    return this.postsService.findReplies(id, query.cursor, query.limit, user?.id);
  }

  @Post('subthreads/:subthreadId/posts')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '发帖（创建新楼层或楼中楼回复）' })
  @ApiCreatedResponse({ description: '创建的帖子（含楼层号或 parentPostId）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '无发帖权限（未加入子贴或权限不足）' })
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
  @ApiOkResponse({ description: '帖子详情（含作者信息、点赞数、是否已点赞）' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = (req as any).user as { id: string } | undefined;
    return this.postsService.findById(id, user?.id);
  }

  @Patch('posts/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑帖子' })
  @ApiOkResponse({ description: '更新后的帖子' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '非本人帖子，无权编辑' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
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
  @ApiOkResponse({ description: '帖子已删除' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '非本人帖子，无权删除' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.remove(id, user.id);
    return { message: '帖子已删除' };
  }

  @Post('posts/:id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞帖子' })
  @ApiOkResponse({ description: '点赞成功（含最新点赞数）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async like(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.postsService.like(id, user.id);
  }

  @Delete('posts/:id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消点赞' })
  @ApiOkResponse({ description: '取消点赞成功（含最新点赞数）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async unlike(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.postsService.unlike(id, user.id);
  }
}
