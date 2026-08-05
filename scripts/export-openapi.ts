import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/common/swagger/openapi-document';

async function main() {
  const outputPath = process.argv[2] ?? '/tmp/wenyousite-openapi.json';

  // createDocument 只读取控制器元数据，无需 app.init()/listen()，因此不会连接数据库或 Redis。
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error'], abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  const document = createOpenApiDocument(app);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  // 不调用 app.close()：Redis 是 lazyConnect，close 时反而会尝试发送 QUIT 并建立连接。
  process.exit(0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
