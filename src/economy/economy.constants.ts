export function splitTipAmount(grossAmount: bigint) {
  const recipientAmount = (grossAmount * 85n) / 100n;
  return {
    recipientAmount,
    platformAmount: grossAmount - recipientAmount,
  };
}
