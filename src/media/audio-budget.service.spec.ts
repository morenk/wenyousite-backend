import { ConfigService } from '@nestjs/config';
import { AudioBudgetService } from './audio-budget.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { withMediaVariants } from './media-response.mapper';

function setup(active = 0, bytes = 0) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'u' }]), media: {
    count: jest.fn().mockResolvedValue(active), aggregate: jest.fn().mockResolvedValue({ _sum: { audioInputBytes: bytes } }),
    create: jest.fn().mockImplementation(({data}) => Promise.resolve(data)), findUnique: jest.fn(), update: jest.fn(),
  } };
  const prisma = { $transaction: jest.fn((run) => run(tx)) };
  const service = new AudioBudgetService(prisma as unknown as PrismaService, new ConfigService());
  return { tx, service };
}
const input = { userId: 'u', key: 'synthetic', url: 'https://example.invalid/media/audio/a.mp3' };
describe('音频准入预算', () => {
  it('活动名额拒绝早于新增记录，不扣每日额度', async () => {
    const { tx, service } = setup(2);
    await expect(service.create(input, 1)).rejects.toMatchObject({ errorCode: ErrorCode.AUDIO_ACTIVE_LIMIT, status: 429 });
    expect(tx.media.create).not.toHaveBeenCalled(); expect(tx.media.aggregate).not.toHaveBeenCalled();
  });
  it('每日拒绝保留当前记录且错误提示不暗示本机午夜', async () => {
    const { tx, service } = setup(0, 300 * 1024 * 1024);
    await expect(service.create(input, 1)).rejects.toMatchObject({ errorCode: ErrorCode.AUDIO_DAILY_BYTES_LIMIT, message: '音频上传额度已用完，请稍后再试' });
    expect(tx.media.create).not.toHaveBeenCalled();
  });
  it('完成态重复确认不扣费、不申请名额也不再次取得入队权', async () => {
    const { tx, service } = setup(2);
    tx.media.findUnique.mockResolvedValue({ id: 'm', userId: 'u', purpose: 'RICH_CONTENT_AUDIO', status: 'COMPLETED' });
    expect((await service.startProcessing('m', 'u', 100, 'audio/wav')).claimed).toBe(false);
    expect(tx.media.count).not.toHaveBeenCalled(); expect(tx.media.aggregate).not.toHaveBeenCalled();
  });
  it('新增内部预算字段不透传给旧成功DTO', () => {
    const value = withMediaVariants({ url: input.url, status: 'UPLOADING', audioInputBytes: 123, audioUploadLeaseUntil: new Date() });
    expect(value).not.toHaveProperty('audioInputBytes'); expect(value).not.toHaveProperty('audioUploadLeaseUntil');
  });
});
