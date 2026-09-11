import { DraftsService } from '../drafts/drafts.service';
import { PostsService } from '../posts/posts.service';
import { SubthreadsService } from '../subthreads/subthreads.service';
import { ThreadsService } from '../threads/threads.service';
import { ThreadAggregateService } from '../threads/thread-aggregate.service';
import { ErrorCode } from './exceptions/error-codes';

const marker = '[wenyousite-align-v1-center]: #';
const reachedDice = new Error('validated-content-reached-dice');

function writeEntries() {
  const parseContent = jest.fn(() => {
    throw reachedDice;
  });
  const transaction = jest.fn();
  const deps = {
    diceService: { parseContent },
    dice: { parseContent },
    prisma: {
      $transaction: transaction,
      thread: { findUnique: jest.fn().mockResolvedValue({ published: false }) },
    },
    threadAccess: { assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }) },
    access: { assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }) },
    findById: jest.fn().mockResolvedValue({ version: 1, content: '旧正文' }),
  };
  const posts = Object.assign(
    Object.create(PostsService.prototype) as object,
    deps,
  ) as unknown as PostsService;
  const drafts = Object.assign(
    Object.create(DraftsService.prototype) as object,
    deps,
  ) as unknown as DraftsService;
  const subthreads = Object.assign(
    Object.create(SubthreadsService.prototype) as object,
    deps,
  ) as unknown as SubthreadsService;
  const threads = Object.assign(
    Object.create(ThreadsService.prototype) as object,
    deps,
  ) as unknown as ThreadsService;
  const aggregate = Object.assign(
    Object.create(ThreadAggregateService.prototype) as object,
    deps,
  ) as unknown as ThreadAggregateService;
  return {
    parseContent,
    transaction,
    entries: [
      { id: '楼层创建', run: (content: string) => posts.create('subthread', { content }, 'user') },
      {
        id: '回复创建',
        run: (content: string) =>
          posts.create('subthread', { content, parentPostId: 'post' }, 'user'),
      },
      {
        id: '楼层回复编辑',
        run: (content: string) => posts.update('post', { content, version: 1 }, 'user'),
      },
      {
        id: '子贴正文upsert',
        run: (content: string) => posts.upsertBody('subthread', content, 1, 'user'),
      },
      {
        id: '子贴创建',
        run: (content: string) => subthreads.create('thread', { title: '子贴', content }, 'user'),
      },
      { id: '主题创建', run: (content: string) => threads.create({ content }, 'user') },
      {
        id: '主题聚合保存',
        run: (content: string) =>
          aggregate.save(
            'thread',
            { content, tagNames: [], version: 1, defaultSubthreadVersion: 1 },
            'user',
          ),
      },
      { id: '草稿创建', run: (content: string) => drafts.create({ content }, 'user') },
      { id: '草稿更新', run: (content: string) => drafts.update('draft', content, 1, 'user') },
    ],
  };
}

describe('真实正文写入口共享边界校验，早于骰子与持久化', () => {
  for (let index = 0; index < writeEntries().entries.length; index++) {
    const name = writeEntries().entries[index].id;
    it.each(['正文', '## 标题', '### 小标题', '![图片](https://cdn.example.com/image.png)'])(
      `${name} 接受无空行对齐目标 %s`,
      async (target) => {
        const { entries, parseContent, transaction } = writeEntries();
        const source = `前文\r\n${marker}\r\n${target}`;
        await expect(entries[index].run(source)).rejects.toBe(reachedDice);
        expect(parseContent).toHaveBeenCalledWith(source.replace(/\r\n/g, '\n'));
        expect(transaction).not.toHaveBeenCalled();
      },
    );
    it.each([
      `${marker}\n<br />`,
      `${marker}\n- 列表`,
      `> ${marker}\n> 正文`,
      `前文\n${marker}\n\n正文`,
    ])(`${name} 拒绝非法目标且无副作用 %s`, async (source) => {
      const { entries, parseContent, transaction } = writeEntries();
      await expect(entries[index].run(source)).rejects.toMatchObject({
        errorCode: ErrorCode.UNSUPPORTED_MARKDOWN_FORMAT,
      });
      expect(parseContent).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  }
});
