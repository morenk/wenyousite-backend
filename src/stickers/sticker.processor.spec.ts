import { Job } from 'bullmq';
import { mock, MockProxy, mockReset } from 'jest-mock-extended';
import { StickerProcessor } from './sticker.processor';
import { StickerProcessJob, StickersService } from './stickers.service';

function stickerJob(attemptsMade: number, attempts?: number) {
  return {
    data: { importId: 'import-1' },
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
  } as unknown as Job<StickerProcessJob>;
}

describe('StickerProcessor', () => {
  const stickers: MockProxy<StickersService> = mock<StickersService>();
  let processor: StickerProcessor;

  beforeEach(() => {
    mockReset(stickers);
    stickers.processImport.mockResolvedValue(undefined);
    stickers.markImportFailed.mockResolvedValue(undefined);
    processor = new StickerProcessor(stickers);
    jest.spyOn(
      (processor as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('成功时执行指定导入任务', async () => {
    await expect(processor.process(stickerJob(0, 2))).resolves.toBeUndefined();
    expect(stickers.processImport).toHaveBeenCalledWith('import-1');
  });

  it('中间尝试失败时保留 PROCESSING 供下次重试', async () => {
    stickers.processImport.mockRejectedValue(new Error('temporary failure'));

    await expect(processor.process(stickerJob(0, 2))).rejects.toThrow('temporary failure');
    expect(stickers.markImportFailed).not.toHaveBeenCalled();
  });

  it('末次尝试失败时持久化失败原因', async () => {
    const error = new Error('permanent failure');
    stickers.processImport.mockRejectedValue(error);

    await expect(processor.process(stickerJob(1, 2))).rejects.toThrow(error);
    expect(stickers.markImportFailed).toHaveBeenCalledWith('import-1', error);
  });
});
