import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheckService,
  HealthCheck,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './redis-health.indicator';

/** 健康检查控制器：提供数据库连接状态检查，供部署平台轮询 */
@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
    private redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: '健康检查，返回各依赖服务状态' })
  @ApiOkResponse({ description: '{ status: "ok", info: { database: { status: "up" }, redis: { status: "up" } } }' })
  check() {
    return this.health.check([
      // 检查 PostgreSQL 数据库连接是否正常
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisHealth.check(),
    ]);
  }
}
