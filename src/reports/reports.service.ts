import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 举报服务：提交、查询、处理 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** 提交举报 */
  async create(reporterId: string, targetType: string, targetId: string, reason: string) {
    return this.prisma.report.create({
      data: { reporterId, targetType, targetId, reason },
    });
  }

  /** 管理员查看举报列表 */
  async findAll(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    return this.prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** 管理员处理举报 */
  async handle(id: string, adminId: string, status: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('举报不存在');
    if (report.status !== 'PENDING') throw new ForbiddenException('举报已处理');

    return this.prisma.report.update({
      where: { id },
      data: { status, handledBy: adminId, handledAt: new Date() },
    });
  }
}
