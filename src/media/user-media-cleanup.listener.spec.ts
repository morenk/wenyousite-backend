import { Test, TestingModule } from '@nestjs/testing';
import { MediaService } from './media.service';
import { UserMediaCleanupListener } from './user-media-cleanup.listener';

const mockMediaService = {
  cleanupOrphanByUrl: jest.fn().mockResolvedValue(true),
};

describe('UserMediaCleanupListener', () => {
  let listener: UserMediaCleanupListener;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserMediaCleanupListener,
        { provide: MediaService, useValue: mockMediaService },
      ],
    }).compile();
    listener = module.get(UserMediaCleanupListener);
    jest.clearAllMocks();
  });

  it('注销事件携带头像时触发孤儿检查', async () => {
    await listener.handleUserDeleted({
      userId: 'u1',
      avatarUrl: 'https://example.com/avatar.webp',
    });

    expect(mockMediaService.cleanupOrphanByUrl).toHaveBeenCalledWith(
      'https://example.com/avatar.webp',
    );
  });

  it('没有头像时跳过回收', async () => {
    await listener.handleUserDeleted({ userId: 'u1', avatarUrl: null });
    expect(mockMediaService.cleanupOrphanByUrl).not.toHaveBeenCalled();
  });

  it('对象存储失败不影响注销流程', async () => {
    mockMediaService.cleanupOrphanByUrl.mockRejectedValueOnce(new Error('cos down'));
    await expect(
      listener.handleUserDeleted({ userId: 'u1', avatarUrl: 'https://example.com/avatar.webp' }),
    ).resolves.toBeUndefined();
  });
});
