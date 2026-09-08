import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as nodemailer from 'nodemailer';
import MailMessage from 'nodemailer/lib/mailer/mail-message';

function resolveLegacyContent(mail: MailMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    void mail.resolveContent(mail.data, 'html', (error, value: unknown) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function transporter() {
  return nodemailer.createTransport({
    streamTransport: true,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

describe('Nodemailer 实际依赖的内容访问隔离', () => {
  it('旧式 resolveContent 签名也必须拒绝本地文件读取', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wenyou-mail-access-'));
    const file = join(directory, 'fixture.txt');
    try {
      await writeFile(file, 'synthetic mail fixture');
      const mail = new MailMessage(transporter(), { html: { path: file } });
      await expect(resolveLegacyContent(mail)).rejects.toMatchObject({ code: 'EFILEACCESS' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('旧式 resolveContent 签名拒绝 URL 内容且不发出请求', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end('synthetic mail fixture');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const mail = new MailMessage(transporter(), { html: { path: `http://127.0.0.1:${port}/fixture` } });
      await expect(resolveLegacyContent(mail)).rejects.toMatchObject({ code: 'EURLACCESS' });
      expect(requests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
