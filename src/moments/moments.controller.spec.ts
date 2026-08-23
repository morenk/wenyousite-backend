import { MomentsController } from './moments.controller';

describe('MomentsController', () => {
  it('发现流与发布端点使用独立限流配额', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', MomentsController.prototype.list)).toBe(
      10,
    );
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', MomentsController.prototype.list)).toBe(
      60_000,
    );
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', MomentsController.prototype.create)).toBe(
      5,
    );
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', MomentsController.prototype.create)).toBe(
      60_000,
    );
  });
});
