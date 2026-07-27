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

  async sendVerification(to: string, token: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 请验证你的邮箱',
      html: `<p>你的验证码：<strong>${token}</strong></p><p>发送 POST /auth/verify-email 请求，body 中携带 { token: "${token}" }。</p>`,
    });
  }

  async sendPasswordReset(to: string, token: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 重置密码',
      html: `<p>你的重置验证码：<strong>${token}</strong></p><p>发送 POST /auth/reset-password 请求，body 中携带 { token: "${token}", newPassword: "..." }。</p>`,
    });
  }
}
