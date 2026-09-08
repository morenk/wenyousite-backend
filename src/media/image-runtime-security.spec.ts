import sharp from 'sharp';

describe('实际图片运行库的安全基线', () => {
  it('AVIF 解码使用包含修复的 libheif 1.23.2 或更新版本', () => {
    // 检查实际加载的原生库，避免 JS 包升级而部署仍加载旧 libheif。
    const version = sharp.versions.heif ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major > 1 || (major === 1 && (minor > 23 || (minor === 23 && patch >= 2)))).toBe(true);
  });
});
