import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCsvExport,
  buildDebugSidebarData,
  buildJsonExportPayload,
  __resetDebugSidebarStateForTest,
} from './debugSidebar';

const BASE_SNAPSHOT: any = {
  turnNumber: 2,
  meta: {
    seed: 'seed-1',
    nations: [
      { id: 'alpha', name: 'Alpha Union' },
      { id: 'beta', name: 'Beta Collective' },
    ],
  },
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
    beta: {
      canton: 'c2',
      finance: { treasury: 40, debt: 0 },
      status: {
        stockpiles: { fx: { current: 20, delta: 1 } },
        flows: { energy: 8, logistics: 5, research: 2 },
        happiness: { value: 20, emoji: '😃' },
      },
      energy: { ratio: 0.9, supply: 18, demand: 20, plants: [] },
      logistics: { ratio: 0.8, supply: 8, demand: 10, throttledSectors: {} },
      labor: {
        available: { general: 5, skilled: 2, specialist: 1 },
        assigned: { general: 3, skilled: 1, specialist: 1 },
        happiness: 0.4,
      },
      sectors: {
        industry: { capacity: 4, funded: 2, utilization: 2 },
      },
      idleCost: 0.5,
      omCost: 10,
    },
  },
  economy: {
    cantons: {
      c1: {
        sectors: {
          agriculture: { capacity: 5, funded: 3, utilization: 2, idle: 3 },
        },
        laborDemand: { agriculture: { general: 4, skilled: 2, specialist: 1 } },
        laborAssigned: { agriculture: { general: 4, skilled: 2, specialist: 1 } },
        labor: { general: 6, skilled: 3, specialist: 2 },
        consumption: { foodRequired: 5, foodProvided: 5, luxuryRequired: 5, luxuryProvided: 4 },
        suitability: { agriculture: 80 },
        urbanizationLevel: 4,
        development: 1.2,
        happiness: 0.6,
      },
      c2: {
        sectors: {
          industry: { capacity: 4, funded: 2, utilization: 2, idle: 2 },
        },
        laborDemand: { industry: { general: 3, skilled: 1, specialist: 1 } },
        laborAssigned: { industry: { general: 3, skilled: 1, specialist: 1 } },
        labor: { general: 5, skilled: 2, specialist: 1 },
        consumption: { foodRequired: 3, foodProvided: 3, luxuryRequired: 2, luxuryProvided: 2 },
        suitability: { industry: 70 },
        urbanizationLevel: 3,
        development: 0.9,
        happiness: 0.5,
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
  nationCantons: {
    alpha: ['c1'],
    beta: ['c2'],
  },
  cantonMeta: {
    c1: { owner: 'alpha' },
    c2: { owner: 'beta' },
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
    const alpha = data.nations.alpha;
    expect(alpha?.finance.gold.numeric).toBe(-12);
    expect(alpha?.finance.gold.formatted.includes('-')).toBe(true);
  });

  it('computes sector ceilings and idle taxes from capacities', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    const alpha = data.nations.alpha!;
    const agriculture = alpha.sectors.find((sector) => sector.key === 'agriculture');
    expect(agriculture).toBeDefined();
    expect(agriculture!.ceiling).toBeGreaterThan(0);
    expect(agriculture!.ceiling).toBe(agriculture!.capacity * agriculture!.perSlotCost);
    expect(agriculture!.idleCost).toBeGreaterThanOrEqual(0);
  });

  it('flags energy bottlenecks when throttled', () => {
    const snapshot = cloneSnapshot();
    snapshot.nations.alpha.energy.throttledSectors = { agriculture: 1 };
    const data = buildDebugSidebarData(snapshot, 'alpha');
    const alpha = data.nations.alpha!;
    const agriculture = alpha.sectors.find((sector) => sector.key === 'agriculture');
    expect(agriculture?.bottlenecks.some((item) => item.toLowerCase().includes('energy'))).toBe(true);
  });

  it('exposes all nations while defaulting to the player selection', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    expect(data.activeNationId).toBe('alpha');
    expect(Object.keys(data.nations)).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(data.nations.beta?.label).toBe('Beta Collective');
  });

  it('generates grouped csv exports for every nation', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    const csv = buildCsvExport(data);
    expect(csv).toContain('Alpha Union,Overview,Gold,Numeric');
    expect(csv).toContain('Beta Collective,Overview,Gold,Numeric');
    expect(csv).toContain('Alpha Union,Canton,c1,LaborAvailable');
  });

  it('passes reconciliation diagnostics when canton sums match nations', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    const alphaDiagnostics = data.nations.alpha?.diagnostics ?? [];
    const laborDiag = alphaDiagnostics.find((diag) => diag.id === 'labor-reconcile');
    const sectorDiag = alphaDiagnostics.find((diag) => diag.id === 'sector-reconcile');
    expect(laborDiag?.passed).toBe(true);
    expect(sectorDiag?.passed).toBe(true);
  });

  it('includes all nation data in the json export payload', () => {
    const data = buildDebugSidebarData(cloneSnapshot(), 'alpha');
    const json = buildJsonExportPayload(data);
    expect(json).toContain('Alpha Union');
    expect(json).toContain('Beta Collective');
  });
});

