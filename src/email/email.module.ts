import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/** 邮件模块：全局可用，提供验证码发送能力 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
