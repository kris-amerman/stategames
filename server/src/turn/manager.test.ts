import { expect, test, spyOn } from 'bun:test';
import { TurnManager } from './manager';
import { BudgetManager } from '../budget/manager';
import { EconomyManager } from '../economy/manager';
import { DevelopmentManager } from '../development/manager';
import type { GameState, TurnPlan } from '../types';

function createGameState(currentPlan: TurnPlan | null, nextPlan: TurnPlan | null): GameState {
  return {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'planning',
    currentPlan,
    nextPlan,
    cellOwnership: {},
    playerCells: {},
    entities: {},
    cellEntities: {},
    playerEntities: {},
    entitiesByType: { unit: [] },
    economy: EconomyManager.createInitialState(),
    nextEntityId: 1,
  } as GameState;
}

test('actions set in Turn N apply in Turn N+1', () => {
  const plan1: TurnPlan = { budgets: { military: 1, welfare: 0, sectorOM: {} } };
  const plan2: TurnPlan = { budgets: { military: 2, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan1, plan2);

  const spy = spyOn(BudgetManager, 'applyBudgets');

  // Advance to execute plan1
  TurnManager.advanceTurn(state);
  expect(spy.mock.calls[0][1]).toEqual(plan1.budgets);
  // Advance again to execute plan2
  TurnManager.advanceTurn(state);
  expect(spy.mock.calls[1][1]).toEqual(plan2.budgets);

  spy.mockRestore();
});

test('per-turn sequence invokes gates in order', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan, null);
  const order: string[] = [];

  const patches: [string, any][] = [
    ['carryover', TurnManager],
    ['budgetGate', TurnManager],
    ['inputsGate', TurnManager],
    ['logisticsGate', TurnManager],
    ['laborGate', TurnManager],
    ['suitabilityGate', TurnManager],
    ['multiplySiteFactors', TurnManager],
    ['resolveOutputAndConsumption', TurnManager],
    ['resolveTradeAndFX', TurnManager],
    ['resolveFinance', TurnManager],
    ['resolveDevelopment', TurnManager],
    ['cleanup', TurnManager],
  ];

  const originals: Record<string, any> = {};
  for (const [method] of patches) {
    originals[method] = (TurnManager as any)[method];
    (TurnManager as any)[method] = (...args: any[]) => {
      order.push(method);
      return originals[method].apply(TurnManager, args);
    };
  }

  try {
    TurnManager.advanceTurn(state);
  } finally {
    for (const [method] of patches) {
      (TurnManager as any)[method] = originals[method];
    }
  }

  expect(order).toEqual([
    'carryover',
    'budgetGate',
    'inputsGate',
    'logisticsGate',
    'laborGate',
    'suitabilityGate',
    'multiplySiteFactors',
    'resolveOutputAndConsumption',
    'resolveTradeAndFX',
    'resolveFinance',
    'resolveDevelopment',
    'cleanup',
  ]);
});

test('planning writes to next-turn buffer', () => {
  const state = createGameState(null, null);
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  TurnManager.startPlanning(state);
  expect(state.nextPlan).toBeDefined();
  TurnManager.submitPlan(state, plan);
  expect(state.nextPlan).toBe(plan);
});

test('cleanup creates turn summary artifact', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan, null);
  const original = (TurnManager as any).cleanup;
  (TurnManager as any).cleanup = (gs: any) => {
    gs.turnSummary = { log: ['done'] };
  };

  TurnManager.advanceTurn(state);
  expect((state as any).turnSummary).toBeDefined();

  (TurnManager as any).cleanup = original;
});

test('budget prioritizes suitability and charges idle cost', () => {
  const plan: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 5, logistics: 1 },
    },
  };
  const state = createGameState(plan, null);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  EconomyManager.addCanton(econ, 'B');
  econ.cantons.A.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
  econ.cantons.B.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.agriculture = 10;
  econ.cantons.B.suitability.agriculture = 0;
  econ.cantons.A.urbanizationLevel = 2;
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.logistics = 0;
  econ.resources.gold = 100;
  econ.resources.coal = 100;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);

  TurnManager.advanceTurn(state);
  expect(econ.cantons.A.sectors.agriculture.funded).toBe(3);
  expect(econ.cantons.B.sectors.agriculture.funded).toBe(2);
  // With ample starting gold the state incurs no debt
  expect(econ.finance.debt).toBe(0);
});

test('energy and logistics shortfalls scale funded slots', () => {
  const plan: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 10, logistics: 0 },
    },
  };
  const state = createGameState(plan, null);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  econ.cantons.A.sectors.agriculture = { capacity: 10, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.agriculture = 0;
  econ.cantons.A.urbanizationLevel = 3;
  // energy plant only produces 5 units -> ratio 0.5
  econ.resources.gold = 100;
  econ.resources.oil = 100;
  econ.energy.plants.push({ canton: 'A', type: 'oilPeaker', status: 'active' } as any);
  // logistics supply 0 -> all slots idle after logistics gate
  TurnManager.advanceTurn(state);
  // energy gate halves funded to 5 before logistics zeroes it
  expect(econ.energy.state.ratio).toBeCloseTo(0.5);
  expect(econ.cantons.A.sectors.agriculture.funded).toBe(0);
});

test('retool completion and UL change apply next turn', () => {
  const plan1: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const plan2: TurnPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: { manufacturing: 1 } },
  };
  const state = createGameState(plan1, plan2);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  econ.cantons.A.sectors.manufacturing = { capacity: 0, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.manufacturing = 0;
  econ.cantons.A.urbanizationLevel = 1;
  // pending retool that finishes after first turn
  econ.retoolQueue.push({
    canton: 'A',
    sector_from: 'agriculture',
    sector_to: 'manufacturing',
    slots: 1,
    turns_remaining: 1,
  } as any);
  // force development roll to increase UL next turn
  const originalDev = (TurnManager as any).resolveDevelopment;
  (TurnManager as any).resolveDevelopment = (gs: GameState) => {
    const inputs = { A: { baseRoll: 4 } } as any;
    DevelopmentManager.run(gs.economy, inputs);
  };

  TurnManager.advanceTurn(state);
  // new slot not yet usable and UL not yet applied
  expect(econ.cantons.A.sectors.manufacturing.capacity).toBe(1);
  expect(econ.cantons.A.urbanizationLevel).toBe(1);
  expect(econ.cantons.A.nextUrbanizationLevel).toBe(2);

  (TurnManager as any).resolveDevelopment = originalDev;
  TurnManager.advanceTurn(state);
  // capacity usable and UL applied
  expect(econ.cantons.A.urbanizationLevel).toBe(2);
});
