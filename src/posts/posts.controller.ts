import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.postsService.findAllBySubthread(subthreadId, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get('posts/:id/replies')
  @Public()
  @ApiOperation({ summary: '获取楼中楼回复列表' })
  async findReplies(@Param('id') id: string) {
    return this.postsService.findReplies(id);
  }

  @Post('subthreads/:subthreadId/posts')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除帖子（不能删除子贴第一楼）' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.remove(id, user.id);
    return { message: '帖子已删除' };
  }
}
