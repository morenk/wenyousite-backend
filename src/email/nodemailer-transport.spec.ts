import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext, createServer, type TLSSocket } from 'node:tls';
import * as nodemailer from 'nodemailer';
import { dnsCache } from 'nodemailer/lib/shared';
import { EmailService } from './email.service';

describe('Nodemailer 真实 transport 兼容与隔离', () => {
  afterEach(() => jest.restoreAllMocks());

  it('JSON 预览仍将验证码写入本地私有收件箱', async () => {
    const mailbox = await mkdtemp(join(tmpdir(), 'wenyou-mail-json-'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const values: Record<string, unknown> = {
        'app.nodeEnv': 'test',
        'ses.previewMailbox': mailbox,
        'ses.from': 'sender@example.invalid',
      };
      const service = new EmailService({ get: (key: string) => values[key] } as ConfigService);
      await service.sendVerification('recipient@example.invalid', '123456');
      const files = await readdir(mailbox);
      expect(files).toHaveLength(1);
      const message: unknown = JSON.parse(await readFile(join(mailbox, files[0]), 'utf8'));
      expect(message).toMatchObject({
        from: 'sender@example.invalid', to: 'recipient@example.invalid',
        subject: '温油站 — 注册验证码', html: expect.stringContaining('123456'),
      });
    } finally {
      await rm(mailbox, { recursive: true, force: true });
    }
  });

  it('stream transport 仍生成邮件正文而不投递', async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: 'sender@example.invalid', to: 'recipient@example.invalid',
        subject: 'Local stream fixture', text: 'Synthetic verification: 123456',
      });
      expect(Buffer.isBuffer(result.message)).toBe(true);
      expect(result.message.toString()).toContain('Synthetic verification: 123456');
      expect(result.envelope.to).toEqual(['recipient@example.invalid']);
    } finally {
      transport.close();
    }
  });

  it('同 DNS 主机缓存命中后仍按各连接的 TLS 名称验证，错证书在 AUTH 前拒绝', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wenyou-mail-tls-'));
    const hostname = `smtp-${randomUUID()}.invalid`;
    const goodName = 'valid.smtp.invalid';
    const wrongName = 'other.smtp.invalid';
    const sockets = new Set<TLSSocket>();
    const serverNames: string[] = [];
    const authUsers: string[] = [];
    const messages: string[] = [];
    const transports: nodemailer.Transporter[] = [];
    let server: ReturnType<typeof createServer> | undefined;
    // 仅固定 DNS 解析为回环地址；缓存、TLS 校验、SMTP 认证与 DATA 都使用真实依赖。
    const resolve4 = jest.spyOn(dns.Resolver.prototype, 'resolve4').mockImplementation(
      ((_host: string, callback: (error: null, addresses: string[]) => void) => callback(null, ['127.0.0.1'])) as typeof dns.Resolver.prototype.resolve4,
    );
    jest.spyOn(dns.Resolver.prototype, 'resolve6').mockImplementation(
      ((_host: string, callback: (error: null, addresses: string[]) => void) => callback(null, [])) as typeof dns.Resolver.prototype.resolve6,
    );
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', `/CN=${goodName}`, '-addext', `subjectAltName=DNS:${goodName}`,
        '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
      ], { stdio: 'ignore' });
      const key = await readFile(join(directory, 'key.pem'));
      const cert = await readFile(join(directory, 'cert.pem'));
      const context = createSecureContext({ key, cert });
      server = createServer({
        key, cert,
        SNICallback: (name, done) => { serverNames.push(name); done(null, context); },
      }, (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => undefined);
        socket.setEncoding('utf8');
        socket.write('220 local fixture SMTP\r\n');
        let pending = '';
        let data: string[] | undefined;
        socket.on('data', (chunk: string) => {
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\r\n')) !== -1) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (data) {
              if (line === '.') {
                messages.push(data.join('\r\n')); data = undefined;
                socket.write('250 stored locally\r\n');
              } else data.push(line);
            } else if (line.startsWith('EHLO')) socket.write('250-local fixture\r\n250 AUTH PLAIN\r\n');
            else if (line.startsWith('AUTH PLAIN ')) {
              authUsers.push(Buffer.from(line.slice(11), 'base64').toString().split('\0')[1]);
              socket.write('235 authenticated fixture\r\n');
            } else if (line === 'DATA') { data = []; socket.write('354 send fixture\r\n'); }
            else if (line === 'QUIT') socket.end('221 bye\r\n');
            else socket.write('250 ok\r\n');
          }
        });
      });
      server.on('tlsClientError', () => undefined);
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      const transport = (servername: string, user: string) => {
        const result = nodemailer.createTransport({
          host: hostname, port, secure: true, tls: { servername, ca: cert, rejectUnauthorized: true },
          auth: { user, pass: 'synthetic-local-password' },
          connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 3000,
          disableFileAccess: true, disableUrlAccess: true,
        });
        transports.push(result);
        return result;
      };
      const mail = {
        from: 'sender@example.invalid', to: 'recipient@example.invalid',
        subject: 'Local TLS fixture', text: 'Synthetic verification: 123456',
      };
      await expect(transport(goodName, 'first-fixture').sendMail(mail)).resolves.toMatchObject({ accepted: ['recipient@example.invalid'] });
      expect(dnsCache.has(hostname)).toBe(true);
      await expect(transport(wrongName, 'must-not-authenticate').sendMail(mail)).rejects.toMatchObject({ code: 'ESOCKET' });
      await expect(transport(goodName, 'last-fixture').sendMail(mail)).resolves.toMatchObject({ accepted: ['recipient@example.invalid'] });
      expect(resolve4).toHaveBeenCalledTimes(1);
      expect(serverNames).toEqual([goodName, wrongName, goodName]);
      expect(authUsers).toEqual(['first-fixture', 'last-fixture']);
      expect(messages).toHaveLength(2);
      expect(messages.every((message) => message.includes('Synthetic verification: 123456'))).toBe(true);
    } finally {
      transports.forEach((transport) => transport.close());
      sockets.forEach((socket) => socket.destroy());
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      dnsCache.delete(hostname);
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
