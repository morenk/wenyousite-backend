import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/** 根路由控制器：返回 API 基本信息 */
@ApiTags('Root')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API 根路径，返回服务名称和版本' })
  root() {
    return { name: '温油站 API', version: '0.1.0' };
  }
}
