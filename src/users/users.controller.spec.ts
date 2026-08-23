import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { UserActivityService } from './user-activity.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController 协作主题端点', () => {
  const users = {} as UsersService;
  const activity = { collaboratedThreads: jest.fn() };
  const controller = new UsersController(users, activity as unknown as UserActivityService);

  beforeEach(() => jest.clearAllMocks());

  it('使用 AuthRead 并将当前用户与不透明游标交给应用服务', async () => {
    expect(
      Reflect.getMetadata(AUTH_MODE_KEY, UsersController.prototype.getMyCollaboratedThreads),
    ).toBe(AuthMode.READ);
    activity.collaboratedThreads.mockResolvedValue({ items: [], pagination: {} });

    await controller.getMyCollaboratedThreads({ cursor: 'opaque', limit: 30 }, {
      id: 'user',
    } as never);

    expect(activity.collaboratedThreads).toHaveBeenCalledWith('user', 'opaque', 30);
  });
});
