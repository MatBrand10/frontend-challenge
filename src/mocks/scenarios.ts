export const mockScenarios = [
  'default',
  'empty-catalog',
  'slow-network',
  'variable-latency',
  'offline',
  'server-error',
  'expired-session',
  'invalid-coupon',
  'changed-price',
  'sold-out',
  'pending-timeout',
  'socket-price-change',
  'socket-stale-duplicate',
] as const;

export type MockScenario = typeof mockScenarios[number];

const scenarioKey = 'nft-marketplace-mock-scenario';
const appStoragePrefix = 'nft-marketplace-';

export function getMockScenario(): MockScenario {
  const value = localStorage.getItem(scenarioKey);
  return mockScenarios.find((scenario) => scenario === value) ?? 'default';
}

export function setMockScenario(value: unknown): MockScenario | null {
  if (typeof value !== 'string' || !mockScenarios.includes(value as MockScenario)) return null;
  localStorage.setItem(scenarioKey, value);
  return value as MockScenario;
}

export function resetMockState() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(appStoragePrefix)) localStorage.removeItem(key);
  }
}
