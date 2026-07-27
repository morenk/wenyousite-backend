import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  @Get()
  @ApiOperation({ summary: '管理后台入口' })
  index() {
    return { name: '温油站管理后台', status: 'running', docs: '/api/docs' };
  }
}
