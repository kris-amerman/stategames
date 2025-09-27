import { beforeEach, describe, expect, it } from 'vitest';
import { buildDebugSidebarData, __resetDebugSidebarStateForTest } from './debugSidebar';

const BASE_SNAPSHOT: any = {
  turnNumber: 2,
  meta: { seed: 'seed-1' },
  nations: {
    alpha: {
      canton: 'c1',
      finance: {
        treasury: 25,
        debt: 0,
        waterfall: { operations: 12, welfare: 4, military: 3, projects: 2, interest: 1 },
      },
      status: {
        stockpiles: {
          fx: { current: 40, delta: 2 },
          food: { current: 30, delta: -1 },
          ordnance: { current: 10, delta: 0 },
          production: { current: 5, delta: 1 },
          luxury: { current: 8, delta: 0 },
          materials: { current: 12, delta: 1 },
        },
        flows: { energy: 10, logistics: 6, research: 3 },
        labor: { general: 6, skilled: 3, specialist: 2 },
        happiness: { value: 15, emoji: '🙂' },
      },
      stockpiles: { fx: 40, food: 30, ordnance: 10, production: 5, luxury: 8, materials: 12 },
      energy: {
        ratio: 1,
        supply: 20,
        demand: 20,
        plants: [{ type: 'coal', status: 'active' }],
        throttledSectors: {},
      },
      logistics: { ratio: 1, supply: 12, demand: 12, throttledSectors: {} },
      labor: {
        available: { general: 6, skilled: 3, specialist: 2 },
        assigned: { general: 4, skilled: 2, specialist: 1 },
        happiness: 0.3,
        availableBySector: {},
      },
      sectors: {
        agriculture: { capacity: 5, funded: 3, utilization: 2 },
      },
      idleCost: 1,
      omCost: 15,
      welfare: { education: 1, healthcare: 1, socialSupport: 0 },
      projects: [{ id: 1, sector: 'energy', tier: 'small', turnsRemaining: 3, delayed: false }],
    },
  },
  economy: {
    cantons: {
      c1: {
        sectors: {
          agriculture: { capacity: 5, funded: 3, utilization: 2, idle: 3 },
        },
        laborDemand: { agriculture: { general: 3 } },
        laborAssigned: { agriculture: { general: 2 } },
        labor: { general: 6 },
        consumption: { foodRequired: 5, foodProvided: 5, luxuryRequired: 5, luxuryProvided: 4 },
        suitability: { agriculture: 80 },
        urbanizationLevel: 4,
        development: 1.2,
        happiness: 0.6,
      },
    },
    energy: { state: { supply: 20, demand: 20, ratio: 1 }, oAndMSpent: 5 },
    finance: { summary: { expenditures: 25, interest: 2 }, debt: 10 },
    infrastructure: {
      national: { airport: 'AP-1', rail: 'RH-1' },
      airports: { 'AP-1': { status: 'active' } },
      railHubs: { 'RH-1': { status: 'active' } },
      ports: {},
    },
    trade: { pendingImports: { food: 3 }, pendingExports: { materials: 2 } },
    welfare: { current: { education: 1, healthcare: 1, socialSupport: 0 } },
    resources: { gold: 25, research: 3 },
  },
};

function cloneSnapshot(): any {
  return JSON.parse(JSON.stringify(BASE_SNAPSHOT));
}

describe('buildDebugSidebarData', () => {
  beforeEach(() => {
    __resetDebugSidebarStateForTest();
  });

  it('encodes debt as negative gold when present', () => {
    const snapshot = cloneSnapshot();
    snapshot.nations.alpha.finance.treasury = 0;
    snapshot.nations.alpha.finance.debt = 12;
    const data = buildDebugSidebarData(snapshot, 'alpha');
    expect(data.finance.gold.numeric).toBe(-12);
    expect(data.finance.gold.formatted.includes('-')).toBe(true);
  });

  it('computes sector ceilings and idle taxes from capacities', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    const agriculture = data.sectors.find((sector) => sector.key === 'agriculture');
    expect(agriculture).toBeDefined();
    expect(agriculture!.ceiling).toBeGreaterThan(0);
    expect(agriculture!.ceiling).toBe(agriculture!.capacity * agriculture!.perSlotCost);
    expect(agriculture!.idleCost).toBeGreaterThanOrEqual(0);
  });

  it('flags energy bottlenecks when throttled', () => {
    const snapshot = cloneSnapshot();
    snapshot.nations.alpha.energy.throttledSectors = { agriculture: 1 };
    const data = buildDebugSidebarData(snapshot, 'alpha');
    const agriculture = data.sectors.find((sector) => sector.key === 'agriculture');
    expect(agriculture?.bottlenecks.some((item) => item.toLowerCase().includes('energy'))).toBe(true);
  });

  it('does not leak other nations when player id is missing', () => {
    const snapshot = cloneSnapshot();
    snapshot.nations.beta = {
      canton: 'c2',
      finance: { treasury: 90, debt: 0 },
      status: { stockpiles: { fx: { current: 99, delta: 0 } } },
    };
    const data = buildDebugSidebarData(snapshot, null);
    expect(data.nationId).toBeNull();
    expect(data.gold.numeric).toBe(0);
    expect(data.stockpiles.every((entry) => entry.formatted.startsWith('0'))).toBe(true);
  });
});

