import { test, expect } from 'bun:test';
import { TurnManager } from '../turn/manager';
import { EconomyManager } from '../economy/manager';
import { DevelopmentManager } from '../development/manager';
import { TradeManager } from '../trade/manager';
import { FinanceManager } from '../finance/manager';
import { InfrastructureManager } from '../infrastructure/manager';
import { BudgetManager } from '../budget/manager';
import type { GameState, TurnPlan } from '../types';

function createGameState(plan: TurnPlan): GameState {
  return {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'execution',
    currentPlan: plan,
    nextPlan: plan,
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

// Scenario 1: Baseline Growth under Adequate Inputs
// Runs 10 turns with sufficient funding, LP, and energy.
// Verifies stable utilization, UL progress, and no debt.
test('Scenario 1: Baseline Growth under Adequate Inputs (10 turns)', () => {
  const plan: TurnPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: { agriculture: 5, logistics: 1 } },
  };
  const state = createGameState(plan);
  const econ = state.economy;
  // Setup canton with adequate capacity and resources
  EconomyManager.addCanton(econ, 'A');
  econ.cantons.A.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.agriculture = 10;
  econ.cantons.A.suitability.logistics = 0;
  econ.cantons.A.urbanizationLevel = 2;
  econ.resources.gold = 100;
  econ.resources.coal = 200;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);

  // Patch development to gain +1 meter per turn
  const originalDev = (TurnManager as any).resolveDevelopment;
  (TurnManager as any).resolveDevelopment = (gs: GameState) => {
    const inputs: Record<string, any> = {};
    for (const id of Object.keys(gs.economy.cantons)) {
      inputs[id] = { baseRoll: 1 };
    }
    DevelopmentManager.run(gs.economy, inputs);
  };

  try {
    for (let t = 0; t < 10; t++) {
      TurnManager.advanceTurn(state);
      state.nextPlan = plan; // repeat plan each turn
    }
  } finally {
    (TurnManager as any).resolveDevelopment = originalDev;
  }

  const canton = econ.cantons.A;
  expect(canton.sectors.agriculture.utilization).toBe(5);
  expect(econ.energy.state.ratio).toBe(1);
  expect(econ.finance.debt).toBe(0);
  expect(canton.urbanizationLevel).toBeGreaterThan(2);
  expect(econ.resources.gold).toBeGreaterThan(0);
});

// Scenario 2: Energy-Constrained Economy
// Runs two sub-cases over 8 turns each with and without Essentials First.
test('Scenario 2: Energy-Constrained Economy (8 turns)', () => {
  const plan: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
    },
  };

  const setup = (essentials: boolean) => {
    const state = createGameState(plan);
    const econ = state.economy;
    EconomyManager.addCanton(econ, 'A');
    const c = econ.cantons.A;
    c.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
    c.sectors.manufacturing = { capacity: 5, funded: 0, idle: 0 } as any;
    c.sectors.logistics = { capacity: 2, funded: 0, idle: 0 } as any;
    c.suitability.agriculture = 10;
    c.suitability.manufacturing = 10;
    c.suitability.logistics = 0;
    c.urbanizationLevel = 5;
    econ.resources.gold = 1000;
    econ.resources.coal = 200;
    econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);
    econ.energy.essentialsFirst = essentials;
    return state;
  };

  const run = (state: GameState) => {
    const original = (TurnManager as any).logisticsGate;
    (TurnManager as any).logisticsGate = (gs: GameState) => {
      (gs as any).lastLogistics = { lp: { lp_ratio: 1 } };
    };
    try {
      for (let t = 0; t < 8; t++) {
        TurnManager.advanceTurn(state);
        state.nextPlan = plan;
      }
    } finally {
      (TurnManager as any).logisticsGate = original;
    }
  };

  const noPriority = setup(false);
  run(noPriority);
  expect(noPriority.economy.energy.state.ratio).toBeLessThan(1);
  const c1 = noPriority.economy.cantons.A;
  expect(c1.sectors.agriculture.utilization).toBeLessThan(5);
  expect(c1.sectors.manufacturing.utilization).toBeLessThan(5);

  const essentials = setup(true);
  run(essentials);
  expect(essentials.economy.energy.state.ratio).toBeLessThan(1);
  const c2 = essentials.economy.cantons.A;
  expect(c2.sectors.agriculture.utilization).toBeGreaterThan(c2.sectors.manufacturing.utilization);
});

// Scenario 3: Logistics Bottleneck & Recovery
test('Scenario 3: Logistics Bottleneck & Recovery (8 turns)', () => {
  const plan0: TurnPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: { agriculture: 5, manufacturing: 5 } },
  };
  const plan1: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
    },
  };
  const state = createGameState(plan0);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  const c = econ.cantons.A;
  c.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
  c.sectors.manufacturing = { capacity: 5, funded: 0, idle: 0 } as any;
  c.sectors.logistics = { capacity: 2, funded: 0, idle: 0 } as any;
  c.suitability.agriculture = 10;
  c.suitability.manufacturing = 10;
  c.suitability.logistics = 0;
  c.urbanizationLevel = 5;
  econ.resources.gold = 1000;
  econ.resources.coal = 200;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);

  for (let t = 0; t < 4; t++) {
    TurnManager.advanceTurn(state);
    state.nextPlan = plan0;
  }
  expect((state as any).lastLogistics.lp.lp_ratio).toBe(0);
  expect(c.sectors.agriculture.utilization).toBe(0);

  for (let t = 0; t < 4; t++) {
    state.nextPlan = plan1;
    TurnManager.advanceTurn(state);
  }
  expect((state as any).lastLogistics.lp.lp_ratio).toBe(1);
  expect(c.sectors.agriculture.utilization).toBeGreaterThan(0);
});

// Scenario 4: Trade Rebalancing: FX-Rich vs. Gold-Poor
test('Scenario 4: Trade Rebalancing (6 turns)', () => {
  const econ = EconomyManager.createInitialState();
  econ.resources.fx = 100;
  econ.resources.gold = 0;
  EconomyManager.addCanton(econ, 'A');
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 1, idle: 0 } as any;
  const orders = {
    imports: [
      { good: 'food', quantity: 10, price: 2, tariff: 0.25, gateway: 'port' },
    ],
    exports: [
      { good: 'materials', quantity: 5, price: 10, gateway: 'port' },
    ],
  };
  for (let t = 0; t < 6; t++) {
    const trade = TradeManager.run(econ, {
      orders,
      capitalUL: 1,
      lastFinanceOutput: 50,
      swap: { from: 'fx', amount: 20 },
    });
    expect(trade.tariff_gold).toBeCloseTo(5);
    TradeManager.applyPending(econ);
    FinanceManager.run(econ, {
      revenues: trade.fx_earned + trade.tariff_gold,
      expenditures: trade.fx_spent + trade.freight_fx,
    });
    expect(econ.resources.fx).toBeGreaterThanOrEqual(0);
  }
  expect(econ.resources.gold).toBeGreaterThan(0);
});

// Scenario 5: Debt Spiral, Stress, and Default Gate
test('Scenario 5: Debt Spiral (10 turns)', () => {
  const plan: TurnPlan = {
    budgets: { military: 0, welfare: 50, sectorOM: {} },
  };
  const state = createGameState(plan);
  const econ = state.economy;
  econ.finance.creditLimit = 100;
  econ.resources.gold = 0;

  for (let t = 0; t < 10; t++) {
    TurnManager.advanceTurn(state);
    state.nextPlan = plan;
  }

  expect(econ.finance.debt).toBe(econ.finance.creditLimit);
  expect(econ.finance.defaulted).toBe(true);
  expect(econ.finance.debtStress[0]).toBe(true);
});

// Scenario 6: Urbanization Dynamics: Divergent Cantons
test('Scenario 6: Urbanization Dynamics (12 turns)', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'Coast');
  EconomyManager.addCanton(econ, 'Inland');
  econ.cantons.Coast.urbanizationLevel = 2;
  econ.cantons.Inland.urbanizationLevel = 2;

  const original = (TurnManager as any).resolveDevelopment;
  (TurnManager as any).resolveDevelopment = (gs: GameState) => {
    DevelopmentManager.run(gs.economy, {
      Coast: { baseRoll: 2 },
      Inland: { baseRoll: 0, decayFlags: { siege: true } },
    });
  };

  try {
    for (let t = 0; t < 12; t++) {
      TurnManager.advanceTurn(state);
      state.nextPlan = plan;
    }
  } finally {
    (TurnManager as any).resolveDevelopment = original;
  }

  expect(econ.cantons.Coast.urbanizationLevel).toBeGreaterThan(2);
  expect(econ.cantons.Inland.urbanizationLevel).toBe(1);
});

// Scenario 7: Infrastructure & Capital Projects Timing/Delays
test('Scenario 7: Infrastructure Timing (10 turns)', () => {
  const econ = EconomyManager.createInitialState();
  econ.resources.gold = 1000;
  econ.resources.production = 1000;
  InfrastructureManager.build(econ, 'port', 'A');
  let bonus = 0;
  for (let t = 0; t < 4; t++) {
    ({ lpBonus: bonus } = InfrastructureManager.progressTurn(econ));
  }
  expect(econ.infrastructure.ports.A.status).toBe('active');
  expect(bonus).toBe(10);
  InfrastructureManager.toggle(econ, 'port', 'A', 'inactive');
  InfrastructureManager.progressTurn(econ);
  expect(econ.infrastructure.ports.A.status).toBe('inactive');
});

// Scenario 8: Welfare Policy Ramps & Labor Mix Shifts
test('Scenario 8: Welfare Policy Ramps (8 turns)', () => {
  const state = createGameState({ budgets: { military: 0, welfare: 0, sectorOM: {} } });
  EconomyManager.addCanton(state.economy, 'A');
  state.economy.cantons.A.urbanizationLevel = 2;

  for (let t = 0; t < 8; t++) {
    const tier = Math.min(4, t + 1);
    state.nextPlan = {
      budgets: { military: 0, welfare: 0, sectorOM: {} },
      policies: { welfare: { education: tier, healthcare: tier } },
    };
    TurnManager.advanceTurn(state);
  }

  const canton = state.economy.cantons.A;
  expect(state.economy.welfare.current.education).toBe(4);
  expect(canton.happiness).toBeGreaterThan(0);
  expect(canton.labor.skilled).toBeGreaterThan(0);
});

// Scenario 9: Tariff Extremes and Capacity Limits
test('Scenario 9: Tariff Extremes (6 turns)', () => {
  const econ = EconomyManager.createInitialState();
  econ.resources.fx = 100;
  EconomyManager.addCanton(econ, 'A');
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 1, idle: 0 } as any;
  const run = (tariff: number) => {
    const trade = TradeManager.run(econ, {
      orders: {
        imports: [{ good: 'food', quantity: 10, price: 2, tariff, gateway: 'port' }],
      },
      capitalUL: 0.25,
      lastFinanceOutput: 0,
    });
    TradeManager.applyPending(econ);
    return trade;
  };

  for (let t = 0; t < 6; t++) {
    econ.resources.fx = 100;
    const res0 = run(0);
    expect(res0.tariff_gold).toBe(0);
    econ.resources.fx = 100;
    const res1 = run(0.3);
    expect(res1.tariff_gold).toBeCloseTo(3);
  }
  expect(econ.resources.fx).toBeGreaterThanOrEqual(0);
});

// Scenario 10: Retools & Sector Prioritization under Scarcity
test('Scenario 10: Retools & Prioritization (8 turns)', () => {
  const planA: TurnPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: { manufacturing: 3, logistics: 2 } },
  };
  const planB: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { manufacturing: 1, finance: 1, logistics: 2 },
    },
  };
  const state = createGameState(planA);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  EconomyManager.addCanton(econ, 'B');
  econ.cantons.A.sectors.manufacturing = { capacity: 2, funded: 0, idle: 0 } as any;
  econ.cantons.B.sectors.manufacturing = { capacity: 2, funded: 0, idle: 0 } as any;
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
  econ.cantons.B.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
  econ.cantons.A.suitability.manufacturing = 5;
  econ.cantons.B.suitability.manufacturing = 10;
  econ.cantons.A.urbanizationLevel = 5;
  econ.cantons.B.urbanizationLevel = 5;
  econ.resources.gold = 1000;
  econ.resources.coal = 200;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);
  BudgetManager.scheduleRetool(econ, {
    canton: 'A',
    sector_from: 'manufacturing',
    sector_to: 'finance',
    slots: 1,
  });

  for (let t = 0; t < 2; t++) {
    TurnManager.advanceTurn(state);
    state.nextPlan = planA;
  }

  expect(econ.cantons.A.sectors.finance?.capacity).toBe(1);

  for (let t = 0; t < 6; t++) {
    state.nextPlan = planB;
    TurnManager.advanceTurn(state);
  }

  const a = econ.cantons.A.sectors.manufacturing;
  const b = econ.cantons.B.sectors.manufacturing;
  expect(b.funded).toBeGreaterThan(a.funded);
});

// Scenario 11: Mixed Shock Scenario
test('Scenario 11: Mixed Shock Scenario (12 turns)', () => {
  const plan1: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 5, manufacturing: 5 },
    },
    tradeOrders: {
      imports: [{ good: 'food', quantity: 5, price: 2, tariff: 0.3, gateway: 'port' }],
    },
  };
  const plan2: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { agriculture: 5, manufacturing: 5, logistics: 2 },
    },
    tradeOrders: {
      imports: [{ good: 'food', quantity: 5, price: 2, tariff: 0, gateway: 'port' }],
    },
  };
  const state = createGameState(plan1);
  const econ = state.economy;
  EconomyManager.addCanton(econ, 'A');
  const c = econ.cantons.A;
  c.sectors.agriculture = { capacity: 5, funded: 0, idle: 0 } as any;
  c.sectors.manufacturing = { capacity: 5, funded: 0, idle: 0 } as any;
  c.sectors.logistics = { capacity: 2, funded: 0, idle: 0 } as any;
  c.suitability.agriculture = 10;
  c.suitability.manufacturing = 10;
  c.urbanizationLevel = 5;
  econ.resources.gold = 1000;
  econ.resources.coal = 200;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);

  for (let t = 0; t < 6; t++) {
    TurnManager.advanceTurn(state);
    state.nextPlan = plan1;
  }
  expect(econ.energy.state.ratio).toBeLessThan(1);
  expect((state as any).lastLogistics.lp.lp_ratio).toBeLessThan(1);

  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' } as any);
  for (let t = 0; t < 6; t++) {
    state.nextPlan = plan2;
    TurnManager.advanceTurn(state);
  }
  expect(econ.energy.state.ratio).toBe(1);
  expect((state as any).lastLogistics.lp.lp_ratio).toBe(1);
  expect(econ.resources.gold).toBeGreaterThan(0);
});
