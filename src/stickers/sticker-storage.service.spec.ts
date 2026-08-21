import { ObjectStorageService } from '../storage/object-storage.service';
import { StickerStorageService } from './sticker-storage.service';

describe('StickerStorageService', () => {
  const storage = {
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn(),
  };
  let service: StickerStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StickerStorageService(storage as unknown as ObjectStorageService);
  });

  it('复用统一对象存储下载对象', async () => {
    const body = Buffer.from('image');
    storage.download.mockResolvedValue(body);

    await expect(service.download('stickers/a.webp')).resolves.toBe(body);
    expect(storage.download).toHaveBeenCalledWith('stickers/a.webp');
  });

  it('上传 WebP 时声明不可变缓存策略', async () => {
    const body = Buffer.from('image');
    storage.upload.mockResolvedValue(undefined);

    await service.upload('stickers/a.webp', body);

    expect(storage.upload).toHaveBeenCalledWith('stickers/a.webp', body, {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('删除和公开地址均委托给统一对象存储', async () => {
    storage.remove.mockResolvedValue(undefined);
    storage.publicUrl.mockReturnValue('https://cdn.example.com/stickers/a.webp');

    await service.remove('stickers/a.webp');

    expect(storage.remove).toHaveBeenCalledWith('stickers/a.webp');
    expect(service.publicUrl('stickers/a.webp')).toBe('https://cdn.example.com/stickers/a.webp');
  });
});
