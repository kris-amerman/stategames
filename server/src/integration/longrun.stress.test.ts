import { test, expect } from 'bun:test';
import { TurnManager } from '../turn/manager';
import { EconomyManager } from '../economy/manager';
import type { GameState, TurnPlan } from '../types';

// Deterministic pseudo RNG (mulberry32)
function rngFromSeed(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Configuration dimensions ---
const economySize = ['small', 'medium', 'large'] as const;
const geographyMix = ['coastal', 'inland', 'mixed'] as const;
const ulDistribution = ['low', 'mixed', 'developed'] as const;
const welfareBase = ['low', 'mid', 'high'] as const;
const tariffBase = [0, 0.15, 0.30];
const budgetPosture = ['balanced', 'expansionary', 'austerity'] as const;
const energyStack = ['fossil', 'nuclear', 'renewable'] as const;
const logisticsPosture = ['constrained', 'balanced', 'surplus'] as const;
const debtPosture = ['lowDebt', 'highDebt'] as const;
const tradeStance = ['exportLed', 'importDependent'] as const;

type Config = {
  econSize: (typeof economySize)[number];
  geoMix: (typeof geographyMix)[number];
  ul: (typeof ulDistribution)[number];
  welfare: (typeof welfareBase)[number];
  tariff: number;
  budget: (typeof budgetPosture)[number];
  energy: (typeof energyStack)[number];
  logistics: (typeof logisticsPosture)[number];
  debt: (typeof debtPosture)[number];
  trade: (typeof tradeStance)[number];
};

function pick<T>(arr: readonly T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

function generateConfig(r: () => number): Config {
  return {
    econSize: pick(economySize, r),
    geoMix: pick(geographyMix, r),
    ul: pick(ulDistribution, r),
    welfare: pick(welfareBase, r),
    tariff: pick(tariffBase, r),
    budget: pick(budgetPosture, r),
    energy: pick(energyStack, r),
    logistics: pick(logisticsPosture, r),
    debt: pick(debtPosture, r),
    trade: pick(tradeStance, r),
  };
}

// --- Game state setup ---
function createGameState(config: Config, r: () => number): { state: GameState; plan: TurnPlan } {
  const basePlan: TurnPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: {} },
    policies: {},
  };
  const state: GameState = {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'execution',
    currentPlan: basePlan,
    nextPlan: { ...basePlan },
    cellOwnership: {},
    playerCells: {},
    entities: {},
    cellEntities: {},
    playerEntities: {},
    entitiesByType: { unit: [] },
    economy: EconomyManager.createInitialState(),
    nextEntityId: 1,
  } as GameState;

  const econ = state.economy;

  // number of cantons based on size
  const cantonCounts: Record<typeof config.econSize, [number, number]> = {
    small: [3, 5],
    medium: [8, 12],
    large: [16, 20],
  } as any;
  const countRange = cantonCounts[config.econSize];
  const numCantons = Math.floor(r() * (countRange[1] - countRange[0] + 1)) + countRange[0];
  for (let i = 0; i < numCantons; i++) {
    const id = String.fromCharCode(65 + i);
    EconomyManager.addCanton(econ, id);
    const canton = econ.cantons[id];
    // basic sectors
    canton.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
    canton.sectors.manufacturing = { capacity: 5, funded: 0, idle: 0 } as any;
    canton.sectors.logistics = { capacity: 2, funded: 0, idle: 0 } as any;
    canton.suitability.agriculture = 10;
    canton.suitability.manufacturing = 10;
    canton.suitability.logistics = 0;
    const ulRanges: Record<typeof config.ul, [number, number]> = {
      low: [1, 3],
      mixed: [2, 6],
      developed: [5, 9],
    } as any;
    const ulr = ulRanges[config.ul];
    canton.urbanizationLevel = ulr[0];
  }

  // energy plants
  const plantType: Record<typeof config.energy, string> = {
    fossil: 'coal',
    nuclear: 'nuclear',
    renewable: 'wind',
  } as any;
  const plant = { canton: 'A', type: plantType[config.energy], status: 'active' } as any;
  econ.energy.plants.push(plant);
  const big = 1_000_000_000;
  econ.resources = {
    gold: big,
    fx: config.trade === 'exportLed' ? big : big / 10,
    food: big,
    materials: big,
    production: big,
    ordnance: big,
    luxury: big,
    energy: big,
    uranium: big,
    coal: big,
    oil: big,
    rareEarths: big,
    research: big,
    logistics: 0,
    labor: 0,
  };
  econ.finance.debt = config.debt === 'highDebt' ? big / 100 : 0;
  econ.finance.creditLimit = config.debt === 'highDebt' ? big / 10 : big;

  return { state, plan: state.nextPlan! };
}

// --- per-turn invariant checks ---
function invariantChecks(state: GameState) {
  const econ = state.economy;
  for (const canton of Object.values(econ.cantons)) {
    expect(canton.urbanizationLevel).toBeGreaterThanOrEqual(1);
    expect(canton.urbanizationLevel).toBeLessThanOrEqual(12);
    for (const s of Object.values(canton.suitability)) {
      expect(s).toBeGreaterThanOrEqual(-60);
      expect(s).toBeLessThanOrEqual(50);
    }
  }
}

// --- Scenarios ---
interface Scenario {
  name: string;
  applyTurn: (
    state: GameState,
    plan: TurnPlan,
    turn: number,
    r: () => number,
    stats: Record<string, any>,
  ) => void;
  finalize: (state: GameState, stats: Record<string, any>) => void;
}

const scenarios: Scenario[] = [
  {
    name: 'Endurance Baseline',
    applyTurn: (_s, plan, _t, _r, _stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
      };
    },
    finalize: (state) => {
      expect(state.economy.finance.defaulted).toBe(false);
      expect(state.turnNumber).toBe(TURNS + 1);
    },
  },
  {
    name: 'Compound Constraints',
    applyTurn: (state, plan, t, _r, stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
      };
      delete (plan as any).tradeOrders;
      const phase = t % 90;
      if (phase < 30) {
        state.economy.energy.plants.forEach((p) => (p.status = 'inactive' as any));
        stats.energy = true;
      } else if (phase < 60) {
        for (const c of Object.values(state.economy.cantons)) {
          const s = c.sectors.logistics;
          if (s) s.capacity = 0;
        }
        stats.logistics = true;
        state.economy.energy.plants.forEach((p) => (p.status = 'active' as any));
      } else {
        for (const c of Object.values(state.economy.cantons)) {
          const s = c.sectors.logistics;
          if (s) s.capacity = 2;
        }
        stats.tariff = true;
        plan.tradeOrders = {
          imports: [{ good: 'food', quantity: 1, price: 1, tariff: 0.3, gateway: 'port' }],
        } as any;
        state.economy.energy.plants.forEach((p) => (p.status = 'active' as any));
      }
      if (t === TURNS - 1) {
        state.economy.energy.plants.forEach((p) => (p.status = 'active' as any));
        for (const c of Object.values(state.economy.cantons)) {
          const s = c.sectors.logistics;
          if (s) s.capacity = 2;
        }
      }
    },
    finalize: (state, stats) => {
      expect(stats.energy).toBe(true);
      expect(stats.logistics).toBe(true);
      expect(stats.tariff).toBe(true);
      for (const p of state.economy.energy.plants) {
        expect(p.status).toBe('active');
      }
      for (const c of Object.values(state.economy.cantons)) {
        const s = c.sectors.logistics;
        if (s) expect(s.capacity).toBeGreaterThan(0);
      }
    },
  },
  {
    name: 'Debt Pressure Wave',
    applyTurn: (state, plan, t, _r, _stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
      };
      if (t % 40 === 0) {
        state.economy.finance.interestRate += 0.05;
      }
    },
    finalize: (state) => {
      expect(state.economy.finance.interestRate).toBeCloseTo(0.45, 5);
      if (state.economy.finance.defaulted) {
        expect(state.economy.finance.debt).toBeGreaterThanOrEqual(
          state.economy.finance.creditLimit,
        );
      } else {
        expect(state.economy.finance.debt).toBeLessThanOrEqual(
          state.economy.finance.creditLimit,
        );
      }
    },
  },
  {
    name: 'Infrastructure Supercycle',
    applyTurn: (state, plan, t, _r, _stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
      };
      if (t === 0) {
        state.economy.infrastructure.ports['Main'] = { lpBonus: 10 } as any;
      }
    },
    finalize: (state) => {
      expect(state.economy.infrastructure.ports['Main']).toBeDefined();
    },
  },
  {
    name: 'Trade Regime Whiplash',
    applyTurn: (_s, plan, t, _r, stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
      };
      const tariff = t % 2 === 0 ? 0 : 0.3;
      plan.tradeOrders = {
        imports: [{ good: 'food', quantity: 1, price: 1, tariff, gateway: 'port' }],
      } as any;
      if (tariff === 0) stats.zero = true;
      else stats.high = true;
    },
    finalize: (state, stats) => {
      expect(stats.zero).toBe(true);
      expect(stats.high).toBe(true);
      expect(state.economy.resources.fx).toBeGreaterThanOrEqual(0);
    },
  },
  {
    name: 'Urban Divergence Marathon',
    applyTurn: (state, plan, t, _r, stats) => {
      plan.budgets = { military: 0, welfare: 0, sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 } };
      const cantons = Object.keys(state.economy.cantons);
      if (t === 0) {
        stats.aStart = state.economy.cantons[cantons[0]].urbanizationLevel;
        stats.bStart = state.economy.cantons[cantons[1]].urbanizationLevel;
      }
      if (t % 50 === 0) {
        const c = state.economy.cantons[cantons[0]];
        c.urbanizationLevel++;
        c.nextUrbanizationLevel = c.urbanizationLevel;
      }
      if (t % 60 === 0) {
        const c = state.economy.cantons[cantons[1]];
        c.urbanizationLevel = Math.max(1, c.urbanizationLevel - 1);
        c.nextUrbanizationLevel = c.urbanizationLevel;
      }
    },
    finalize: (state, stats) => {
      const cantons = Object.keys(state.economy.cantons);
      expect(state.economy.cantons[cantons[0]].urbanizationLevel).toBeGreaterThan(
        stats.aStart,
      );
      expect(state.economy.cantons[cantons[1]].urbanizationLevel).toBeLessThanOrEqual(
        stats.bStart,
      );
    },
  },
  {
    name: 'Retools & Prioritization Under Chronic Scarcity',
    applyTurn: (_s, plan, t, _r, stats) => {
      plan.budgets = {
        military: 0,
        welfare: 0,
        sectorOM: { agriculture: 5, manufacturing: t % 5 === 0 ? 0 : 5, logistics: 1 },
      };
      if (t % 5 === 0) stats.idle = (stats.idle || 0) + 1;
    },
    finalize: (state, stats) => {
      expect(stats.idle).toBeGreaterThan(0);
      const m = state.economy.cantons[Object.keys(state.economy.cantons)[0]].sectors
        .manufacturing;
      expect(m.capacity).toBeGreaterThanOrEqual(0);
    },
  },
  {
    name: 'Mixed Shock Gauntlet',
    applyTurn: (state, plan, t, _r, stats) => {
      plan.budgets = { military: 0, welfare: 0, sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 } };
      if (t % 20 === 0) {
        state.economy.energy.plants.forEach((p) => (p.status = 'inactive' as any));
        stats.energy = true;
      } else if (t % 20 === 1) {
        state.economy.energy.plants.forEach((p) => (p.status = 'active' as any));
      }
      if (t % 25 === 0) {
        for (const c of Object.values(state.economy.cantons)) {
          const s = c.sectors.logistics;
          if (s) s.capacity = 0;
        }
        stats.logistics = true;
      } else if (t % 25 === 1) {
        for (const c of Object.values(state.economy.cantons)) {
          const s = c.sectors.logistics;
          if (s) s.capacity = 2;
        }
      }
    },
    finalize: (state, stats) => {
      expect(stats.energy).toBe(true);
      expect(stats.logistics).toBe(true);
      for (const p of state.economy.energy.plants) {
        expect(p.status).toBe('active');
      }
      for (const c of Object.values(state.economy.cantons)) {
        const s = c.sectors.logistics;
        if (s) expect(s.capacity).toBeGreaterThan(0);
      }
      if (state.economy.finance.defaulted) {
        expect(state.economy.finance.debt).toBeGreaterThanOrEqual(
          state.economy.finance.creditLimit,
        );
      } else {
        expect(state.economy.finance.debt).toBeLessThanOrEqual(
          state.economy.finance.creditLimit,
        );
      }
    },
  },
];

const TURNS = parseInt(process.env.STRESS_TURNS || '300', 10);
const SEEDS = parseInt(process.env.STRESS_SEEDS || '10', 10);

// main test
for (const scenario of scenarios) {
  test(`${scenario.name} (stress)`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rngFromSeed(seed);
      const config = generateConfig(r);
      if (scenario.name === 'Endurance Baseline') {
        config.debt = 'lowDebt';
      }
      const { state, plan } = createGameState(config, r);
      let curPlan = plan;
      const stats: Record<string, any> = {};
      for (let t = 0; t < TURNS; t++) {
        scenario.applyTurn(state, curPlan, t, r, stats);
        TurnManager.advanceTurn(state);
        invariantChecks(state);
        curPlan = state.nextPlan!;
      }
      scenario.finalize(state, stats);
    }
  });
}
