import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/** 邮件服务：通过阿里云企业邮箱 SMTP 发送验证码和重置密码邮件 */
@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('ses.host'),
      port: this.config.get<number>('ses.port'),
      secure: true,
      auth: {
        user: this.config.get<string>('ses.user'),
        pass: this.config.get<string>('ses.pass'),
      },
    });
  }

  /** 发送 6 位数字邮箱验证码 */
  async sendVerification(to: string, code: string, type: 'REGISTRATION' | 'EMAIL_VERIFY' = 'REGISTRATION') {
    const isRegistration = type === 'REGISTRATION';
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: isRegistration ? '温油站 — 注册验证码' : '温油站 — 邮箱验证',
      html: isRegistration
        ? `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>6 位数字，15 分钟内有效。用于完成注册。</p>`
        : `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>6 位数字，15 分钟内有效。</p>`,
    });
  }

  /** 发送 6 位数字重置密码验证码 */
  async sendPasswordReset(to: string, code: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 重置密码验证码',
      html: `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>6 位数字，15 分钟内有效。</p>`,
    });
  }
}
