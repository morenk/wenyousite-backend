import { Job } from 'bullmq';
import { mock, MockProxy, mockReset } from 'jest-mock-extended';
import { ImageProcessor } from './image.processor';
import { ImageProcessJob, MediaService } from './media.service';

function imageJob(attemptsMade: number, attempts?: number) {
  return {
    data: {
      mediaId: 'media-1',
      objectKey: 'uploads/source.webp',
      bucket: 'test-bucket',
    },
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
  } as unknown as Job<ImageProcessJob>;
}

describe('ImageProcessor', () => {
  const media: MockProxy<MediaService> = mock<MediaService>();
  let processor: ImageProcessor;

  beforeEach(() => {
    mockReset(media);
    media.processImage.mockResolvedValue(undefined);
    media.markFailed.mockResolvedValue(undefined);
    processor = new ImageProcessor(media);
    jest.spyOn(
      (processor as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('成功时只执行图片处理', async () => {
    const job = imageJob(0, 2);

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(media.processImage).toHaveBeenCalledWith(job.data);
    expect(media.markFailed).not.toHaveBeenCalled();
  });

  it('仍可重试的失败继续抛出且不提前标记 FAILED', async () => {
    media.processImage.mockRejectedValue(new Error('temporary failure'));

    await expect(processor.process(imageJob(0, 2))).rejects.toThrow('temporary failure');
    expect(media.markFailed).not.toHaveBeenCalled();
  });

  it('最后一次尝试失败时先持久化 FAILED 再交给 BullMQ 记录失败', async () => {
    media.processImage.mockRejectedValue(new Error('permanent failure'));

    await expect(processor.process(imageJob(1, 2))).rejects.toThrow('permanent failure');
    expect(media.markFailed).toHaveBeenCalledWith('media-1');
  });

  it('未配置 attempts 时按单次任务处理', async () => {
    media.processImage.mockRejectedValue(new Error('single failure'));

    await expect(processor.process(imageJob(0))).rejects.toThrow('single failure');
    expect(media.markFailed).toHaveBeenCalledWith('media-1');
  });
});
