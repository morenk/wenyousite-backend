import { Module, Global } from '@nestjs/common';

/** 公共模块：全局导出装饰器、过滤器、拦截器、分页 DTO */
@Global()
@Module({})
export class CommonModule {}
