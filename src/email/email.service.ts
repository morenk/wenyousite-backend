import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/** 邮件服务：通过阿里云企业邮箱 SMTP 发送验证码、通知和重置密码邮件 */
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

  /** 发送 6 位数字验证码 */
  async sendVerification(to: string, code: string, type: 'REGISTRATION' | 'EMAIL_VERIFY' | 'CHANGE_EMAIL' = 'REGISTRATION') {
    const subjectMap: Record<string, string> = {
      REGISTRATION: '温油站 — 注册验证码',
      EMAIL_VERIFY: '温油站 — 邮箱验证',
      CHANGE_EMAIL: '温油站 — 更换邮箱验证码',
    };
    const bodyMap: Record<string, string> = {
      REGISTRATION: '6 位数字，15 分钟内有效。用于完成注册。',
      EMAIL_VERIFY: '6 位数字，15 分钟内有效。',
      CHANGE_EMAIL: '6 位数字，15 分钟内有效。用于更换绑定邮箱。',
    };
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: subjectMap[type],
      html: `<h2>你的验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>${bodyMap[type]}</p>`,
    });
  }

  /** 发送密码修改通知邮件 */
  async sendPasswordChanged(to: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站 — 密码已修改',
      html: `<p>你的密码已于 ${new Date().toLocaleString('zh-CN')} 修改。</p><p>如非本人操作，请立即使用忘记密码功能重置密码。</p>`,
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

  /** 发送邮箱变更成功通知 */
  async sendEmailChanged(newEmail: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to: newEmail,
      subject: '温油站 — 邮箱绑定成功',
      html: `<p>你的邮箱已成功更换为 ${newEmail}。</p><p>如非本人操作，请立即联系支持。</p>`,
    });
  }
}
