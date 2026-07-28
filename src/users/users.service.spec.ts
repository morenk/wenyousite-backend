import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const userFixture = { id: 'u1', username: 'test', nickname: 't', avatar: null, bio: null, role: 'USER', deletedAt: null };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('findById 应该返回用户信息', async () => {
    const user = { ...userFixture };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const result = await service.findById('u1');
    expect(result.id).toBe('u1');
    expect(result.username).toBe('test');
  });

  it('findById 用户不存在应该返回404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toThrow(NotFoundException);
  });

  it('update 应该成功更新昵称', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    mockPrisma.user.update.mockResolvedValue({
      ...userFixture, nickname: '新昵称',
    });
    const result = await service.update('u1', { nickname: '新昵称' });
    expect(result.nickname).toBe('新昵称');
  });

  it('修改用户名重复应该返回409', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ ...userFixture, username: 'oldname' })
      .mockResolvedValueOnce({ id: 'other' });
    await expect(
      service.update('u1', { username: 'newname' }),
    ).rejects.toThrow(ConflictException);
  });

  it('update 不存在的用户应该返回404', async () => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('x', { nickname: 'y' })).rejects.toThrow(NotFoundException);
  });

  it('deactivate 应该成功注销', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    mockPrisma.user.update.mockResolvedValue({});
    const result = await service.deactivate('u1');
    expect(result.message).toBe('账号已注销');
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
    mockPrisma.user.findUnique.mockResolvedValue({ ...userFixture });
    const result = await service.findById('u1');
    expect(result.email).toBeUndefined();
  });
});
