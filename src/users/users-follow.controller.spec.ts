import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { UserRelationsService } from './user-relations.service';
import { UsersFollowController } from './users-follow.controller';

describe('UsersFollowController 本人关系管理契约', () => {
  const relations = { userFollowing: jest.fn(), userFollowers: jest.fn(), removeFollower: jest.fn(), following: jest.fn(), followers: jest.fn() };
  const controller = new UsersFollowController(relations as unknown as UserRelationsService);

  beforeEach(() => jest.clearAllMocks());

  it('公开关系查询只委托应用服务', async () => {
    relations.userFollowing.mockResolvedValue([{ id: 'f1' }]);
    relations.userFollowers.mockResolvedValue([{ id: 'f2' }]);
    await expect(controller.userFollowing('u1')).resolves.toEqual([{ id: 'f1' }]);
    await expect(controller.userFollowers('u1')).resolves.toEqual([{ id: 'f2' }]);
    expect(relations.userFollowing).toHaveBeenCalledWith('u1', undefined);
    expect(relations.userFollowers).toHaveBeenCalledWith('u1', undefined);
  });

  it('移除粉丝要求写权限，不能从请求参数选择列表所有者', async () => {
    expect(Reflect.getMetadata(AUTH_MODE_KEY, UsersFollowController.prototype.removeFollower)).toBe(AuthMode.WRITE);
    relations.removeFollower.mockResolvedValue({ message: '已移除粉丝' });
    await expect(controller.removeFollower('follower', { id: 'authenticated-owner' } as never))
      .resolves.toEqual({ message: '已移除粉丝' });
    expect(relations.removeFollower).toHaveBeenCalledWith('authenticated-owner', 'follower');
  });

  it.each(['following', 'followers'] as const)('%s 保留读权限且使用本人投影', async (operation) => {
    expect(Reflect.getMetadata(AUTH_MODE_KEY, UsersFollowController.prototype[operation])).toBe(AuthMode.READ);
    await controller[operation]({ id: 'owner' } as never);
    expect(relations[operation]).toHaveBeenCalledWith('owner', 'owner');
  });
});
