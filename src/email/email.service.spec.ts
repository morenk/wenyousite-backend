import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn((_options: unknown) => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: (options: unknown) => mockCreateTransport(options),
}));

describe('EmailService', () => {
  const config = { get: jest.fn() };
  let service: EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    config.get.mockImplementation((key: string) => ({
      'ses.host': 'smtp.example.com',
      'ses.port': 465,
      'ses.user': 'smtp-user',
      'ses.pass': 'smtp-password',
      'ses.from': 'noreply@example.com',
    })[key]);
    mockSendMail.mockResolvedValue({ messageId: 'message-1' });
    service = new EmailService(config as unknown as ConfigService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('使用 TLS 和 SMTP 凭据创建 transporter 且日志不包含密码', () => {
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'smtp-user', pass: 'smtp-password' },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'SMTP 初始化: smtp.example.com (smtp-user)',
    );
    expect(Logger.prototype.log).not.toHaveBeenCalledWith(expect.stringContaining('smtp-password'));
  });

  it('测试环境使用本地 JSON transport，不连接外部 SMTP', () => {
    config.get.mockImplementation(
      (key: string) =>
        ({
          'app.nodeEnv': 'test',
          'ses.host': '',
          'ses.user': '',
        })[key],
    );

    new EmailService(config as unknown as ConfigService);

    expect(mockCreateTransport).toHaveBeenLastCalledWith({ jsonTransport: true });
  });

  it.each([
    ['REGISTRATION', '温油站 — 注册验证码', '用于完成注册'],
    ['CHANGE_EMAIL', '温油站 — 更换邮箱验证码', '用于更换绑定邮箱'],
  ] as const)('发送 %s 验证码使用对应主题和说明', async (type, subject, description) => {
    await service.sendVerification('user@example.com', '123456', type);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject,
      html: expect.stringMatching(new RegExp(`123456.*${description}`)),
    });
  });

  it('默认验证码类型为注册', async () => {
    await service.sendVerification('user@example.com', '123456');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: '温油站 — 注册验证码',
    }));
  });

  it('发送密码修改通知且不包含密码或验证码', async () => {
    await service.sendPasswordChanged('user@example.com');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: '温油站 — 密码已修改',
      html: expect.stringContaining('如非本人操作'),
    }));
  });

  it('发送重置密码验证码', async () => {
    await service.sendPasswordReset('user@example.com', '654321');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: '温油站 — 重置密码验证码',
      html: expect.stringContaining('654321'),
    }));
  });

  it('邮箱变更成功通知发送到新地址', async () => {
    await service.sendEmailChanged('new@example.com');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@example.com',
      subject: '温油站 — 邮箱绑定成功',
      html: expect.stringContaining('new@example.com'),
    }));
  });

  it('邮箱变更通知会转义 HTML 内容', async () => {
    await service.sendEmailChanged('new@example.com"><img src=x onerror=alert(1)>');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining(
        'new@example.com&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
      ),
    }));
    expect(mockSendMail).not.toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining('<img src=x onerror=alert(1)>'),
    }));
  });

  it('透传 SMTP 发送失败供上层重试或返回错误', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp unavailable'));

    await expect(service.sendPasswordReset('user@example.com', '654321')).rejects.toThrow(
      'smtp unavailable',
    );
  });
});
