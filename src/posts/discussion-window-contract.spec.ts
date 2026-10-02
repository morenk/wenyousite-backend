import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { PostsController } from './posts.controller';
import { FloorWindowResponseDto, ReplyWindowResponseDto } from './dto/discussion-window.dto';
describe('讨论窗口传输契约', () => {
  it.each([
    ['findFloorWindow', 'floors', FloorWindowResponseDto],
    ['findReplyWindow', 'replies', ReplyWindowResponseDto],
  ] as const)('%s 使用有界对象而非旧分页 envelope', async (method, scope, dto) => {
    expect(
      Reflect.getMetadata(DECORATORS.API_RESPONSE, PostsController.prototype[method])[200].type,
    ).toBe(dto);
    const windows = { find: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new PostsController({} as never, windows as never);
    await controller[method]('scope', { number: 2800 }, { user: { id: 'viewer' } } as never);
    expect(windows.find).toHaveBeenCalledWith(scope, 'scope', { number: 2800 }, 'viewer');
  });
});
