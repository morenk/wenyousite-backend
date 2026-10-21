import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';
import { FontStorageService } from './font-storage.service';

@Injectable()
export class FontReadinessService {
  private ready = false;
  private retryAt = 0;
  private pending?: Promise<boolean>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
  ) {}

  supported(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (this.pending) return this.pending;
    if (Date.now() < this.retryAt) return Promise.resolve(false);
    this.pending = this.verify().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async verify(): Promise<boolean> {
    this.retryAt = Date.now() + 10000;
    try {
      this.storage.requireConfigured();
      // 就绪只看固定历史版本的发布事实，不能随当前选择、停用或撤回倒退。
      const versions = await this.prisma.textFontVersion.findMany({
        where: {
          id: { in: FONT_LEGACY_IMPORT.fonts.map((row) => row.versionId) },
          publishedAt: { not: null },
        },
        select: {
          id: true,
          familyId: true,
          artifact: { select: { specimenSha: true, specimenSize: true } },
        },
      });
      if (versions.length !== FONT_LEGACY_IMPORT.fonts.length) return false;
      for (const expected of FONT_LEGACY_IMPORT.fonts) {
        const version = versions.find(
          (row) => row.id === expected.versionId && row.familyId === expected.familyId,
        );
        if (!version) return false;
      }
      // publishedAt 只在全资源校验成功后的事务中写入；冷启动不重下整库。
      // 停用/撤回不删除历史不可变样张，也不撤销已经支持的读取协议。
      const specimen = versions[0].artifact;
      await this.storage.probe({
        sha256: specimen.specimenSha,
        bytes: specimen.specimenSize,
        format: 'png',
      });
      this.ready = true;
      return true;
    } catch {
      return false;
    }
  }
}
