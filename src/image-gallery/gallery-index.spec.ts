import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { galleryImageUrls, syncGalleryIndex } from './gallery-index';
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/gallery-image-occurrences.json'), 'utf8'),
) as { cases: { id: string; markdown: string; urls: string[] }[] };
describe('普通图片位置共享契约', () => {
  it.each(fixtures.cases)('$id', ({ markdown, urls }) =>
    expect(galleryImageUrls(markdown)).toEqual(urls),
  );
  it('在同一事务替换全部位置，保留重复URL并标记空正文也已索引', async () => {
    const tx = {
      postImageOccurrence: { deleteMany: jest.fn(), createMany: jest.fn() },
      $executeRaw: jest.fn(),
    };
    await syncGalleryIndex(
      tx as never,
      'post',
      '![a](https://example.test/a) ![b](https://example.test/a)',
    );
    expect(tx.postImageOccurrence.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 'post', imageIndex: 0, imageCount: 2, url: 'https://example.test/a' },
        { postId: 'post', imageIndex: 1, imageCount: 2, url: 'https://example.test/a' },
      ],
    });
    await syncGalleryIndex(tx as never, 'post', '');
    expect(tx.postImageOccurrence.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.postImageOccurrence.createMany).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
