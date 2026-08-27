import process from 'node:process';
import nodemailer from 'nodemailer';

const required = [
  'OPS_SMTP_HOST',
  'OPS_SMTP_PORT',
  'OPS_SMTP_SECURE',
  'OPS_SMTP_USER',
  'OPS_SMTP_PASS',
  'OPS_SMTP_FROM',
  'OPS_ALERT_TO',
];
for (const key of required) {
  if (!process.env[key] || process.env[key].includes('CHANGE_ME')) {
    throw new Error(`missing operations SMTP setting: ${key}`);
  }
}

const unit = process.argv[2] ?? 'unknown-unit';
if (!/^[a-zA-Z0-9@_.-]+$/.test(unit)) throw new Error('invalid systemd unit name');
let body = '';
for await (const chunk of process.stdin) body += chunk.toString();
if (!body.trim()) body = `Wenyou Site backup failure: ${unit}`;

const transporter = nodemailer.createTransport({
  host: process.env.OPS_SMTP_HOST,
  port: Number(process.env.OPS_SMTP_PORT),
  secure: process.env.OPS_SMTP_SECURE === 'true',
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
  auth: {
    user: process.env.OPS_SMTP_USER,
    pass: process.env.OPS_SMTP_PASS,
  },
});

await transporter.sendMail({
  from: process.env.OPS_SMTP_FROM,
  to: process.env.OPS_ALERT_TO,
  subject: `[温油站] 数据备份告警：${unit}`,
  text: body.slice(0, 20_000),
});
console.log(`backup alert delivered for ${unit}`);
