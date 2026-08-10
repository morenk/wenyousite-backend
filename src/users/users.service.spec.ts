import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    updateMany: jest.fn(),
  },
  media: {
    findUnique: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };
const mockCache = {
  buildKey: jest.fn((...parts: string[]) => parts.join(':')),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
};

const userFixture = {
  id: 'u1',
  username: 'test',
  email: 'test@example.com',
  avatar: null,
  bio: null,
  role: 'USER',
  deletedAt: null,
  lastUsernameChange: null,
  showRecentReplies: true,
  showPlayerBadges: true,
  showBookmarks: true,
  sanctions: [],
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (input: ((tx: typeof mockPrisma) => unknown) | Iterable<unknown>) =>
        typeof input === 'function' ? input(mockPrisma) : Promise.all(input),
    );
  });

  it('findById 应该返回用户信息', async () => {
    const user = { ...userFixture };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const result = await service.findById('u1');
    expect(result.id).toBe('u1');
    expect(result.username).toBe('test');
    expect(result.accountStatus).toBe('ACTIVE');
  });

  it.each([
    ['SUSPENSION', 'SUSPENDED'],
    ['BAN', 'BANNED'],
  ] as const)('findById 把当前有效处罚映射为公开账号状态 %s', async (type, expected) => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...userFixture,
      sanctions: [{ type, endsAt: type === 'SUSPENSION' ? new Date(Date.now() + 60_000) : null }],
    });

    const result = await service.findById('u1');

    expect(result.accountStatus).toBe(expected);
    expect(result.sanctions).toBeUndefined();
  });

  it('findById 用户不存在应该返回404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toThrow(NotFoundException);
  });

  it('update 应该成功更新 bio', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    mockPrisma.user.update.mockResolvedValue({ ...userFixture, bio: '新简介' });
    const result = await service.update('u1', { bio: '新简介' });
    expect(result.bio).toBe('新简介');
  });

  it('update 空 body 不应执行 DB 写', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    await service.update('u1', {});
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('修改用户名重复应该返回409', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname' })
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname' })
      .mockResolvedValueOnce({ id: 'other' });
    await expect(service.update('u1', { username: 'newname' })).rejects.toThrow(ConflictException);
  });

  it('用户名修改间隔不足 7 天应拒绝', async () => {
    const recentChange = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        ...userFixture,
        username: 'oldname',
        lastUsernameChange: recentChange,
      })
      .mockResolvedValueOnce({
        ...userFixture,
        username: 'oldname',
        lastUsernameChange: recentChange,
      });
    await expect(service.update('u1', { username: 'newname' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('用户名修改超 7 天应成功并更新 lastUsernameChange', async () => {
    const oldChange = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname', lastUsernameChange: oldChange }) // find by id
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname', lastUsernameChange: oldChange }) // 锁内复查
      .mockResolvedValueOnce(null); // find by new username (no conflict)
    mockPrisma.user.update.mockResolvedValue({
      ...userFixture,
      username: 'newname',
      lastUsernameChange: new Date(),
    });
    const result = await service.update('u1', { username: 'newname' });
    expect(result.username).toBe('newname');
  });

  it('P2002 用户名唯一冲突应捕获并返回 409', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture }) // find by id
      .mockResolvedValueOnce({ ...userFixture }) // 锁内复查
      .mockResolvedValueOnce(null); // find by new username (no conflict)
    mockPrisma.user.update.mockRejectedValue({ code: 'P2002', meta: { target: ['username'] } });
    await expect(service.update('u1', { username: 'newname' })).rejects.toThrow(ConflictException);
  });

  it('用户名冷却期在用户行锁内复查，拒绝并发期间发生的第二次修改', async () => {
    const recentChange = new Date();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname', lastUsernameChange: null })
      .mockResolvedValueOnce({
        ...userFixture,
        username: 'peer-change',
        lastUsernameChange: recentChange,
      });

    await expect(service.update('u1', { username: 'newname' })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('携带过期旧用户名的资料请求不能在并发改名后把名称写回', async () => {
    const recentChange = new Date();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname', lastUsernameChange: null })
      .mockResolvedValueOnce({
        ...userFixture,
        username: 'peer-change',
        lastUsernameChange: recentChange,
      });

    await expect(service.update('u1', { username: 'oldname', bio: '过期资料' })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('update 不存在的用户应该返回404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('x', { bio: 'y' })).rejects.toThrow(NotFoundException);
  });

  it('更新隐私开关应成功', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    mockPrisma.user.update.mockResolvedValue({ ...userFixture, showRecentReplies: false });
    const result = await service.update('u1', { showRecentReplies: false });
    expect(result.showRecentReplies).toBe(false);
  });

  it('deactivate 应该成功注销', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...userFixture,
      id: 'user_abcdefghijklmnop',
      avatar: 'https://example.com/avatar.webp',
    });
    mockPrisma.user.update.mockResolvedValue({});
    const result = await service.deactivate('user_abcdefghijklmnop');
    expect(result.message).toBe('账号已注销');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_abcdefghijklmnop' },
      data: expect.objectContaining({
        username: 'deleted_abcdefghijklmnop',
        email: 'deleted_user_abcdefghijklmnop@deleted.invalid',
        avatar: null,
        deletedAt: expect.any(Date),
      }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.deleted', {
      userId: 'user_abcdefghijklmnop',
      avatarUrl: 'https://example.com/avatar.webp',
    });
  });

  it('deactivate 已注销再次调用应该返回404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture, deletedAt: new Date() });
    await expect(service.deactivate('u1')).rejects.toThrow(NotFoundException);
  });

  it('findMe 应该返回 email 及完整资料', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture, email: 'a@b.com' });
    const result = await service.findMe('u1');
    expect(result.email).toBe('a@b.com');
  });

  it('findById 不应暴露 email', async () => {
    const noEmail: Partial<typeof userFixture> = { ...userFixture };
    delete noEmail.email;
    mockPrisma.user.findUnique.mockResolvedValue(noEmail);
    const result = await service.findById('u1');
    expect(result.email).toBeUndefined();
  });

  it('setAvatar 应校验 media 归属和 COMPLETED 状态后写入', async () => {
    mockPrisma.media.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'u1',
      url: 'https://example.com/avatar.jpg',
      status: 'COMPLETED',
    });
    mockPrisma.user.update.mockResolvedValue({
      ...userFixture,
      avatar: 'https://example.com/avatar.jpg',
    });
    const result = await service.setAvatar('u1', 'm1');
    expect(result.avatar).toBe('https://example.com/avatar.jpg');
  });

  it('setAvatar media 不存在应 404', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(null);
    await expect(service.setAvatar('u1', 'nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('setAvatar 拒绝他人 media', async () => {
    mockPrisma.media.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'otherUser',
      url: '...',
      status: 'COMPLETED',
    });
    await expect(service.setAvatar('u1', 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('setAvatar 拒绝未处理完成的 media', async () => {
    mockPrisma.media.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'u1',
      url: '...',
      status: 'PROCESSING',
    });
    await expect(service.setAvatar('u1', 'm1')).rejects.toThrow(BadRequestException);
  });

  it('setAvatar(null) 应清除头像且不查询 media', async () => {
    mockPrisma.user.update.mockResolvedValue({ ...userFixture, avatar: null });
    const result = await service.setAvatar('u1', null);
    expect(result.avatar).toBeNull();
    expect(mockPrisma.media.findUnique).not.toHaveBeenCalled();
  });
});
