import { Controller, Get, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';

/** 用户控制器：查询和修改个人资料 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户资料' })
  async getMe(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前登录用户资料' })
  async updateMe(@Req() req: FastifyRequest, @Body() dto: UpdateUserDto) {
    const user = req['user'] as { id: string };
    return this.usersService.update(user.id, dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '根据用户 ID 获取公开资料' })
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
