import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

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

  async sendVerification(to: string, code: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 邮箱验证码',
      html: `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>6 位数字，24 小时内有效。</p>`,
    });
  }

  async sendPasswordReset(to: string, code: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 重置密码验证码',
      html: `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>6 位数字，1 小时内有效。</p>`,
    });
  }
}
