const UNITS_PER_ETH = 10n ** 18n;

export function parseEth(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,18}))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid ETH decimal: ${value}`);
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(18, '0') || '0');
  return whole * UNITS_PER_ETH + fraction;
}

export function formatEth(units: bigint): string {
  const whole = units / UNITS_PER_ETH;
  const fraction = (units % UNITS_PER_ETH).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function sumCart(items: Array<{ price: string; quantity: number }>): bigint {
  return items.reduce((sum, item) => sum + parseEth(item.price) * BigInt(item.quantity), 0n);
}
