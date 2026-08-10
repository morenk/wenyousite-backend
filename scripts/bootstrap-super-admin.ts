import { AuditAction, AuditTargetType, PrismaClient, UserRole } from '@prisma/client';
import { acquireSuperAdminBootstrapLock } from '../src/admin/bootstrap-super-admin-lock';

function readEmail(argv: string[]) {
  const inline = argv.find((arg) => arg.startsWith('--email='));
  const indexed = argv.indexOf('--email');
  const value = inline?.slice('--email='.length) ?? (indexed >= 0 ? argv[indexed + 1] : undefined);
  const email = value?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('用法：pnpm admin:bootstrap -- --email=verified@example.com');
  }
  return email;
}

async function main() {
  const email = readEmail(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 跨目标账号串行化 bootstrap，避免并发创建两个超级管理员。
      await acquireSuperAdminBootstrapLock(tx);
      const existing = await tx.user.findFirst({
        where: { role: UserRole.SUPER_ADMIN, deletedAt: null },
        select: { id: true },
      });
      if (existing) throw new Error('系统已经存在超级管理员，bootstrap 已拒绝');

      const user = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          username: true,
          role: true,
          emailVerified: true,
          deletedAt: true,
        },
      });
      if (!user || user.deletedAt) throw new Error('目标用户不存在或已注销');
      if (!user.emailVerified) throw new Error('目标用户尚未验证邮箱');

      await tx.user.update({
        where: { id: user.id },
        data: { role: UserRole.SUPER_ADMIN },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.SUPER_ADMIN_BOOTSTRAPPED,
          targetType: AuditTargetType.USER,
          targetId: user.id,
          reason: '首次超级管理员初始化',
          metadata: {
            actorUsername: user.username,
            previousRole: user.role,
          },
        },
      });
      return { id: user.id, username: user.username };
    });
    process.stdout.write(
      `超级管理员初始化成功：${result.username} (${result.id})\n请重新登录以建立管理员会话。\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  process.stderr.write(`超级管理员初始化失败：${message}\n`);
  process.exitCode = 1;
});
