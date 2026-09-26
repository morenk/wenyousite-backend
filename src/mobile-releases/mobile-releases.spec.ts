import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole, MobileRelease, Prisma } from '@prisma/client';
import { mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { AdminActor } from '../moderation/admin-policy.service';
import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { ADMIN_ROLES_KEY } from '../admin/admin-auth.constants';
import { ErrorCode } from '../common/exceptions/error-codes';
import { CreateMobileReleaseDto, UpdateMobileReleaseDto } from './mobile-release.dto';
import {
  AdminMobileReleasesController,
  MobileReleasesController,
} from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

const admin: AdminActor = { id: 'admin', username: 'admin', role: 'ADMIN' };
const superAdmin: AdminActor = { ...admin, role: 'SUPER_ADMIN' };
const row = (overrides: Partial<MobileRelease> = {}): MobileRelease => ({
  id: 'release',
  platform: 'android',
  versionName: '1.0.0',
  buildNumber: 42,
  summary: '草稿',
  items: ['第一条'],
  revision: 2,
  confirmedRevision: 1,
  confirmedSummary: '旧确认',
  confirmedItems: ['旧条目'],
  confirmedAt: new Date(),
  publishedRevision: null,
  publishedSummary: null,
  publishedItems: [],
  publishedAt: null,
  promotionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});
const valid = {
  platform: 'android',
  versionName: '1.0.0',
  buildNumber: 42,
  summary: '摘要',
  items: ['正文'],
};

describe('移动版本说明契约', () => {
  it.each([
    { summary: '' },
    { summary: ' \n' },
    { summary: '中'.repeat(201) },
    { items: [] },
    { items: [''] },
    { items: [' \n'] },
    { items: ['中'.repeat(501)] },
    { items: Array(31).fill('项目') },
    { platform: 'ios' },
    { buildNumber: 0 },
    { versionName: '1/2' },
  ])('拒绝无效数据 %j', async (patch) => {
    expect(
      (await validate(plainToInstance(CreateMobileReleaseDto, { ...valid, ...patch }))).length,
    ).toBeGreaterThan(0);
  });
  it('接受边界纯文本并强制 revision', async () => {
    expect(
      await validate(
        plainToInstance(CreateMobileReleaseDto, {
          ...valid,
          summary: '中'.repeat(200),
          items: Array(30).fill('中'.repeat(500)),
        }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateMobileReleaseDto, { summary: '文案', items: ['条目'] }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('公开接口不解析身份；管理接口使用 Cookie 管理会话，确认仅超级管理员', () => {
    for (const name of ['list', 'detail'] as const)
      expect(Reflect.getMetadata(AUTH_MODE_KEY, MobileReleasesController.prototype[name])).toBe(
        AuthMode.PUBLIC,
      );
    for (const name of ['list', 'detail', 'create', 'update', 'confirm'] as const)
      expect(
        Reflect.getMetadata(AUTH_MODE_KEY, AdminMobileReleasesController.prototype[name]),
      ).toBe(AuthMode.ADMIN);
    expect(
      Reflect.getMetadata(ADMIN_ROLES_KEY, AdminMobileReleasesController.prototype.confirm),
    ).toEqual([UserRole.SUPER_ADMIN]);
  });
});

describe('移动版本说明策略', () => {
  const db = mockDeep<PrismaService>();
  const audit = mockDeep<AuditService>();
  const service = new MobileReleasesService(db, audit);
  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation(async (callback: unknown) =>
      (callback as (tx: PrismaService) => Promise<unknown>)(db),
    );
    db.mobileRelease.findUnique.mockResolvedValue(row());
    db.mobileRelease.update.mockResolvedValue(row());
  });
  it('列表与详情查询强制 publishedAt 条件，公开投影没有草稿/确认内容', async () => {
    const published = row({
      publishedAt: new Date(),
      publishedRevision: 1,
      publishedSummary: '旧公开',
      publishedItems: ['旧公开条目'],
    });
    db.mobileRelease.findMany.mockResolvedValue([published]);
    const result = await service.list({ platform: 'android' });
    expect(db.mobileRelease.findMany.mock.calls[0][0]?.where).toMatchObject({
      publishedAt: { not: null },
    });
    expect(result.items[0]).toMatchObject({ summary: '旧公开', revision: 1 });
    expect(result.items[0]).not.toHaveProperty('confirmed');
    db.mobileRelease.findFirst.mockResolvedValue(null);
    await expect(service.published('android', 42)).rejects.toMatchObject({ status: 404 });
    expect(db.mobileRelease.findFirst.mock.calls[0][0]?.where).toMatchObject({
      publishedAt: { not: null },
    });
  });
  it('非法游标返回既有 INVALID_CURSOR 业务码', async () => {
    await expect(service.list({ platform: 'android', cursor: 'bad' })).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_CURSOR,
    });
  });
  it('普通管理员不能修正已发布说明或确认草稿', async () => {
    db.mobileRelease.findUnique.mockResolvedValue(row({ publishedAt: new Date() }));
    await expect(
      service.update(admin, 'release', { revision: 2, summary: '新', items: ['新'] }, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.confirm(admin, 'release', 2, {})).rejects.toMatchObject({ status: 403 });
    expect(db.mobileRelease.update).not.toHaveBeenCalled();
  });
  it('超级管理员编辑保留旧快照，确认才替换公开内容', async () => {
    db.mobileRelease.findUnique.mockResolvedValue(row({ publishedAt: new Date() }));
    await service.update(superAdmin, 'release', { revision: 2, summary: '新', items: ['新'] }, {});
    expect(db.mobileRelease.update.mock.calls[0][0]?.data).toEqual({
      summary: '新',
      items: ['新'],
      revision: { increment: 1 },
    });
    await service.confirm(superAdmin, 'release', 2, {});
    expect(db.mobileRelease.update.mock.calls[1][0]?.data).toMatchObject({
      publishedSummary: '草稿',
      publishedRevision: 2,
    });
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
  it.each([row({ revision: 3 }), row({ promotionId: 'locked' })])(
    'revision 竞争/发布锁返回 40900',
    async (current) => {
      db.mobileRelease.findUnique.mockResolvedValue(current);
      await expect(service.confirm(superAdmin, 'release', 2, {})).rejects.toMatchObject({
        status: 409,
        errorCode: ErrorCode.CONFLICT,
      });
      expect(db.mobileRelease.update).not.toHaveBeenCalled();
    },
  );
  it('从未确认的草稿可修正版本名，确认后拒绝身份改绑', async () => {
    db.mobileRelease.findUnique.mockResolvedValue(
      row({ confirmedAt: null, confirmedRevision: null }),
    );
    await service.update(
      admin,
      'release',
      { revision: 2, summary: '新', items: ['新'], versionName: '1.0.1' },
      {},
    );
    expect(db.mobileRelease.update.mock.calls[0][0]?.data).toMatchObject({ versionName: '1.0.1' });
    db.mobileRelease.findUnique.mockResolvedValue(row());
    await expect(
      service.update(
        admin,
        'release',
        { revision: 2, summary: '新', items: ['新'], versionName: '1.0.1' },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT });
  });
  it('重复平台/build 返回 40900，禁止改绑版本', async () => {
    db.mobileRelease.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(service.create(admin, valid as CreateMobileReleaseDto, {})).rejects.toMatchObject({
      status: 409,
      errorCode: ErrorCode.CONFLICT,
    });
  });
});
