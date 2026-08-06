import { UsersFollowController } from './users-follow.controller';
import { UserRelationsService } from './user-relations.service';

describe('UsersFollowController', () => {
  const relations = {
    userFollowing: jest.fn(),
    userFollowers: jest.fn(),
  };
  const controller = new UsersFollowController(relations as unknown as UserRelationsService);

  beforeEach(() => jest.clearAllMocks());

  it('公开关系查询只委托应用服务', async () => {
    relations.userFollowing.mockResolvedValue([{ id: 'f1' }]);
    relations.userFollowers.mockResolvedValue([{ id: 'f2' }]);

    await expect(controller.userFollowing('u1')).resolves.toEqual([{ id: 'f1' }]);
    await expect(controller.userFollowers('u1')).resolves.toEqual([{ id: 'f2' }]);
    expect(relations.userFollowing).toHaveBeenCalledWith('u1');
    expect(relations.userFollowers).toHaveBeenCalledWith('u1');
  });
});
