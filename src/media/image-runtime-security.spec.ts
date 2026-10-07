import sharp from 'sharp';

describe('实际图片运行库的安全基线', () => {
  it('AVIF 解码使用包含修复的 libheif 1.23.2 或更新版本', () => {
    // 检查实际加载的原生库，避免 JS 包升级而部署仍加载旧 libheif。
    const version = sharp.versions.heif ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major > 1 || (major === 1 && (minor > 23 || (minor === 23 && patch >= 2)))).toBe(true);
  });

  it('SVG 原生解码库包含 GHSA-wq5f-xc86-pv6w 的 librsvg 2.63.2 修复', () => {
    // 同时验证原生库，防止部署环境绕过 sharp 的已修复预编译包。
    const version = sharp.versions.rsvg ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major > 2 || (major === 2 && (minor > 63 || (minor === 63 && patch >= 2)))).toBe(true);
  });

});
