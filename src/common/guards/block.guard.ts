import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 拉黑拦截守卫：被拉黑方不能在拉黑方的帖子里发帖回复 */
@Injectable()
export class BlockGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || request.method === 'GET') return true;

    const subthreadId = request.params?.subthreadId || request.body?.subthreadId;
    if (!subthreadId) return true;

    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, deletedAt: null },
      select: { threadId: true, thread: { select: { ownerId: true } } },
    });
    if (!subthread) return true;

    const blocked = await this.prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: subthread.thread.ownerId, blockedId: user.id } },
    });
    if (blocked) throw new ForbiddenException('你已被该主题帖的楼主拉黑，无法发帖');

    return true;
  }
}
