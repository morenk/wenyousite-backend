import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '../storage/object-storage.service';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 表情对象存储封装，所有对象均以内容哈希作为不可变 key。 */
@Injectable()
export class StickerStorageService {
  constructor(private readonly storage: ObjectStorageService) {}

  async download(key: string) {
    return this.storage.download(key);
  }

  async upload(key: string, body: Buffer) {
    await this.storage.upload(key, body, {
      contentType: 'image/webp',
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  }

  async remove(key: string) {
    await this.storage.remove(key);
  }

  publicUrl(key: string) {
    return this.storage.publicUrl(key);
  }
}
