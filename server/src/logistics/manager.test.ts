import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import type { EconomyState } from '../types';
import {
  LogisticsManager,
  LP_PER_SLOT,
  OPERATING_LP_COST,
  DOMESTIC_MODE_PARAMS,
  GATEWAY_PARAMS,
} from './manager';

function createState(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'C1');
  return state;
}

// 1. LP generation per logistics slot
test('LP generated per active Logistics slot', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 2, funded: 2, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: {},
    domesticPlans: {},
    internationalPlans: {},
  });
  expect(result.lp.supply).toBe(2 * LP_PER_SLOT);
});

// 2. Operating LP costs recorded by sector
test('operating LP costs recorded and summed', () => {
  const state = createState();
  state.cantons.C1.sectors.agriculture = { capacity: 3, funded: 2, idle: 1 };
  state.cantons.C1.sectors.extraction = { capacity: 2, funded: 1, idle: 1 };
  const result = LogisticsManager.run(state, {
    networks: {},
    domesticPlans: {},
    internationalPlans: {},
  });
  const expected =
    2 * OPERATING_LP_COST.agriculture +
    1 * OPERATING_LP_COST.extraction;
  expect(result.lp.demand_operating).toBe(expected);
  expect(result.operatingAllocations.agriculture.planned).toBe(
    2 * OPERATING_LP_COST.agriculture,
  );
  expect(result.operatingAllocations.extraction.planned).toBe(
    1 * OPERATING_LP_COST.extraction,
  );
});

// Helper for domestic network
function makeNetwork(connected: boolean, hops: number, capacity: number) {
  return { connected, hops, capacity_per_turn: capacity };
}

// 3. Mode selection by lowest LP cost with tie-break
test('domestic mode selection chooses lowest LP cost with tie-break', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 1, funded: 1, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: {
      C1: {
        rail: makeNetwork(true, 2, 20),
        sea: makeNetwork(true, 4, 20),
      },
    },
    domesticPlans: { C1: { imports_by_good: { food: 10 }, exports_by_good: {} } },
    internationalPlans: {},
  });
  expect(result.domesticAllocations.C1.rail?.units_planned).toBe(10);
  expect(result.domesticAllocations.C1.sea).toBeUndefined();
});

// 4. Mode capacities and same-turn thresholds
test('domestic mode capacity and same-turn threshold enforced', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 2, funded: 2, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: { C1: { rail: makeNetwork(true, 4, 10) } },
    domesticPlans: { C1: { imports_by_good: { food: 12 }, exports_by_good: {} } },
    internationalPlans: {},
  });
  const alloc = result.domesticAllocations.C1.rail!;
  expect(alloc.units_planned).toBe(10); // capped by capacity
  expect(alloc.same_turn).toBeFalse(); // hops > threshold
  expect(alloc.queued_next_turn).toBe(10);
});

// 5. Imports before exports with pro-rata by good
test('imports ship before exports and exports prorated', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 1, funded: 1, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: { C1: { rail: makeNetwork(true, 1, 10) } },
    domesticPlans: {
      C1: {
        imports_by_good: { food: 8 },
        exports_by_good: { materials: 6, luxury: 6 },
      },
    },
    internationalPlans: {},
  });
  const alloc = result.domesticAllocations.C1.rail!;
  expect(alloc.imports.food.planned).toBe(8);
  expect(alloc.exports.materials.planned).toBeCloseTo(1);
  expect(alloc.exports.luxury.planned).toBeCloseTo(1);
});

// 6. International gateway capacities and costs
test('international gateway capacity and LP/FX costs recorded', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 5, funded: 5, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: {},
    domesticPlans: {},
    internationalPlans: {
      port: { imports_by_good: { food: 15 }, exports_by_good: { materials: 10 } },
    },
    gatewayCapacities: { port: 20 },
  });
  const alloc = result.internationalAllocations.port!;
  expect(alloc.units_planned).toBe(20); // capacity
  expect(alloc.imports.food.planned).toBe(15);
  expect(alloc.exports.materials.planned).toBe(5);
  expect(result.lp.demand_international).toBeCloseTo(20 * GATEWAY_PARAMS.port.costPerHop);
  expect(alloc.fx_cost).toBeCloseTo(20 * GATEWAY_PARAMS.port.fxPerUnit);
});

// 7. LP ratio scales activities uniformly
test('LP ratio uniformly scales activities when supply insufficient', () => {
  const state = createState();
  // logistics slots 1 -> supply 10
  state.cantons.C1.sectors.logistics = { capacity: 1, funded: 1, idle: 0 };
  // operating demand: agriculture 20 funded -> cost 10
  state.cantons.C1.sectors.agriculture = { capacity: 20, funded: 20, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: { C1: { rail: makeNetwork(true, 1, 20) } },
    domesticPlans: { C1: { imports_by_good: { food: 20 }, exports_by_good: {} } },
    internationalPlans: {
      port: { imports_by_good: {}, exports_by_good: { materials: 10 } },
    },
    gatewayCapacities: { port: 10 },
  });
  // demands: operating 10, domestic 2, international 1 => total 13
  expect(result.lp.lp_ratio).toBeCloseTo(10 / 13);
  expect(result.operatingAllocations.agriculture.after_lp).toBeCloseTo(
    10 * (10 / 13),
  );
  const domestic = result.domesticAllocations.C1.rail!;
  expect(domestic.units_after_lp_ratio).toBeCloseTo(domestic.units_planned * (10 / 13));
  const intl = result.internationalAllocations.port!;
  expect(intl.units_after_lp_ratio).toBeCloseTo(intl.units_planned * (10 / 13));
});

// 8. Essentials First prioritization
test('Essentials First prioritizes sectors before others', () => {
  const state = createState();
  // supply 30 from 3 logistics slots
  state.cantons.C1.sectors.logistics = { capacity: 3, funded: 3, idle: 0 };
  // agriculture demand 5, manufacturing demand 40
  state.cantons.C1.sectors.agriculture = { capacity: 10, funded: 10, idle: 0 };
  state.cantons.C1.sectors.manufacturing = { capacity: 20, funded: 20, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: {},
    domesticPlans: {},
    internationalPlans: {},
    essentialsFirst: true,
  });
  expect(result.operatingAllocations.agriculture.after_lp).toBeCloseTo(5);
  expect(result.operatingAllocations.manufacturing.after_lp).toBeCloseTo(25);
});

// 9. Shipments beyond same-turn threshold queue for next turn
test('shipments exceeding same-turn threshold are queued', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 2, funded: 2, idle: 0 };
  const result = LogisticsManager.run(state, {
    networks: { C1: { rail: makeNetwork(true, 5, 5) } },
    domesticPlans: { C1: { imports_by_good: { food: 5 }, exports_by_good: {} } },
    internationalPlans: {},
  });
  const alloc = result.domesticAllocations.C1.rail!;
  expect(alloc.same_turn).toBeFalse();
  expect(alloc.queued_next_turn).toBe(5);
});

// 10. LP state distinguishes demand components
test('LP demand components tracked separately', () => {
  const state = createState();
  state.cantons.C1.sectors.logistics = { capacity: 2, funded: 2, idle: 0 };
  state.cantons.C1.sectors.agriculture = { capacity: 2, funded: 2, idle: 0 }; // demand 1
  const result = LogisticsManager.run(state, {
    networks: { C1: { rail: makeNetwork(true, 1, 3) } },
    domesticPlans: { C1: { imports_by_good: { food: 3 }, exports_by_good: {} } },
    internationalPlans: {
      port: { imports_by_good: { materials: 2 }, exports_by_good: {} },
    },
    gatewayCapacities: { port: 5 },
  });
  expect(result.lp.demand_operating).toBeCloseTo(1); // 2 *0.5
  expect(result.lp.demand_domestic).toBeCloseTo(3 * DOMESTIC_MODE_PARAMS.rail.costPerHop * 1);
  expect(result.lp.demand_international).toBeCloseTo(2 * GATEWAY_PARAMS.port.costPerHop);
});

