import { ConfigService } from '@nestjs/config';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';
import { MetaController } from './meta.controller';

describe('MetaController', () => {
  it('未配置移动版本策略时返回显式 null，不阻断客户端', () => {
    const config = { get: jest.fn((key: string) => key === 'push.enabled' ? false : undefined) };
    const controller = new MetaController(config as unknown as ConfigService);

    expect(controller.getMeta()).toEqual({
      contractVersion: API_CONTRACT_VERSION,
      buildSha: null,
      markdownContractVersion: 5,
      capabilities: {
        stickers: true,
        directMessages: true,
        pushNotifications: false,
      },
      mobileCompatibility: {
        android: {
          minimumSupportedBuild: null,
          recommendedBuild: null,
          updateUrl: null,
        },
        ios: {
          minimumSupportedBuild: null,
          recommendedBuild: null,
          updateUrl: null,
        },
      },
    });
  });

  it('按平台返回最低、推荐构建号和更新地址', () => {
    const values: Record<string, unknown> = {
      'app.buildSha': 'abc123',
      'push.enabled': true,
      'mobileCompatibility.android.minimumSupportedBuild': 120,
      'mobileCompatibility.android.recommendedBuild': 135,
      'mobileCompatibility.android.updateUrl': 'https://play.google.com/store/apps/details?id=site.wenyou',
      'mobileCompatibility.ios.minimumSupportedBuild': 80,
      'mobileCompatibility.ios.recommendedBuild': 90,
      'mobileCompatibility.ios.updateUrl': 'https://apps.apple.com/app/id123456789',
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    const controller = new MetaController(config as unknown as ConfigService);

    expect(controller.getMeta()).toEqual(expect.objectContaining({
      buildSha: 'abc123',
      capabilities: expect.objectContaining({ pushNotifications: true }),
      mobileCompatibility: {
        android: {
          minimumSupportedBuild: 120,
          recommendedBuild: 135,
          updateUrl: 'https://play.google.com/store/apps/details?id=site.wenyou',
        },
        ios: {
          minimumSupportedBuild: 80,
          recommendedBuild: 90,
          updateUrl: 'https://apps.apple.com/app/id123456789',
        },
      },
    }));
  });
});
