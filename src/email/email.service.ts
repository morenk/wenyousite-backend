import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}

/** 邮件服务：通过阿里云邮件推送 (DirectMail) SMTP 发送验证码、通知和重置密码邮件 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('ses.host');
    const user = this.config.get<string>('ses.user');
    this.logger.log(`SMTP 初始化: ${host} (${user})`);

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('ses.port'),
      secure: true,
      auth: {
        user,
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

  /** 管理会话登录或高风险操作的邮箱验证码。 */
  async sendAdminVerification(to: string, code: string, purpose: 'LOGIN' | 'STEP_UP') {
    const from = this.config.get<string>('ses.from');
    const action = purpose === 'LOGIN' ? '登录温油站务台' : '确认高风险站务操作';
    await this.transporter.sendMail({
      from,
      to,
      subject: `温油站务台 — ${action}`,
      html: `<h2>验证码：<strong style="font-size:32px;letter-spacing:8px">${code}</strong></h2><p>用于${action}，10 分钟内有效。请勿转发给任何人。</p>`,
    });
  }

  /** 新管理会话提醒，不记录或发送任何凭证。 */
  async sendAdminSessionAlert(to: string, occurredAt: Date, ip?: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站务台 — 新的后台登录',
      html: `<p>你的管理员账号于 ${occurredAt.toLocaleString('zh-CN')} 建立了新的后台会话。</p><p>来源 IP：${escapeHtml(ip ?? '未知')}</p><p>如非本人操作，请立即重置密码并联系站务。</p>`,
    });
  }

  async sendAdminInvite(to: string, inviteUrl: string) {
    const from = this.config.get<string>('ses.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: '温油站务台 — 管理员邀请',
      html: `<p>你收到了一份温油站管理员邀请，24 小时内有效。</p><p><a href="${escapeHtml(inviteUrl)}">查看并接受邀请</a></p><p>如果你不认识邀请人，请忽略此邮件。</p>`,
    });
  }
}
