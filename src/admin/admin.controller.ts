import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/** 管理后台入口控制器：提供后台基本信息 */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  /** 管理后台根路径，返回服务状态 */
  @Get()
  @ApiOperation({ summary: '管理后台入口' })
  index() {
    return { name: '温油站管理后台', status: 'running', docs: '/api/docs' };
  }
}
