import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

type Env = Record<string, string>;

function parseEnv(text: string): Env {
  const values: Env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

async function readLoadtestEnv(): Promise<Env> {
  const envPath = resolve(process.cwd(), 'loadtest', 'target.env');
  const env = parseEnv(await readFile(envPath, 'utf8'));
  if (!env.LOADTEST_DATABASE_URL) {
    throw new Error(`LOADTEST_DATABASE_URL missing from ${envPath}`);
  }
  if (!env.LOADTEST_JWT_ACCESS_SECRET) {
    throw new Error(`LOADTEST_JWT_ACCESS_SECRET missing from ${envPath}`);
  }
  return env;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return fallback;
  return parsed;
}

async function main() {
  const env = await readLoadtestEnv();
  const count = positiveInteger(process.env.LOADTEST_TOKEN_COUNT, 40);
  const outputPath = resolve(
    process.cwd(),
    process.env.LOADTEST_TOKEN_OUTPUT ?? 'loadtest/auth-tokens.json',
  );
  const tokenTtl = process.env.LOADTEST_ACCESS_TOKEN_TTL ?? '2h';
  const prisma = new PrismaClient({ datasources: { db: { url: env.LOADTEST_DATABASE_URL } } });
  const jwt = new JwtService({ secret: env.LOADTEST_JWT_ACCESS_SECRET });
  const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'));
  const tokens: string[] = [];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const user = await prisma.user.upsert({
        where: { email: `loadtest-${suffix}@loadtest.invalid` },
        update: {
          username: `loadtest${suffix}`,
          password: passwordHash,
          deletedAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        create: {
          email: `loadtest-${suffix}@loadtest.invalid`,
          username: `loadtest${suffix}`,
          password: passwordHash,
        },
        select: { id: true },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, platform: 'mobile', revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const family = randomUUID();
      const rawRefreshToken = randomUUID();
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(rawRefreshToken).digest('hex'),
          family,
          platform: 'mobile',
          deviceInfo: 'loadtest-token-generator',
          sessionStartedAt: new Date(),
          expiresAt,
        },
      });
      tokens.push(await jwt.signAsync({ sub: user.id, sid: family }, { expiresIn: tokenTtl }));
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    console.log(`generated ${tokens.length} isolated access tokens at ${outputPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
