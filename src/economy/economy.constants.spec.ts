import { splitTipAmount } from './economy.constants';

describe('splitTipAmount', () => {
  it.each([
    [2n, 1n, 1n],
    [3n, 2n, 1n],
    [10n, 8n, 2n],
    [100n, 85n, 15n],
  ])('总额 %s 按 85%% 向下取整到账', (gross, recipient, platform) => {
    expect(splitTipAmount(gross)).toEqual({
      recipientAmount: recipient,
      platformAmount: platform,
    });
  });
});
