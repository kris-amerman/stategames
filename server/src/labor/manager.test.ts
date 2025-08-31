import { test, expect } from 'bun:test';
import { EconomyManager } from '../economy';
import { LaborManager } from './manager';
import type { EconomyState, TurnPlan } from '../types';

// Helper to create economy with one canton
function setupEconomy(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'c1');
  return state;
}

function runLabor(state: EconomyState, plan?: TurnPlan) {
  LaborManager.run(state, plan);
}

// 1. Labor pools exist and distinct

test('labor pools are distinct resources', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 1;
  runLabor(state);
  const labor = state.cantons.c1.labor;
  expect(labor).toHaveProperty('general');
  expect(labor).toHaveProperty('skilled');
  expect(labor).toHaveProperty('specialist');
});

// 2. Labor mix based on urbanization level

test('labor generation varies by urbanization level', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'low');
  EconomyManager.addCanton(state, 'high');
  state.cantons.low.urbanizationLevel = 1;
  state.cantons.high.urbanizationLevel = 3;
  runLabor(state);
  expect(state.cantons.high.labor.general).toBeGreaterThan(state.cantons.low.labor.general);
});

// 3. Labor assigned only to funded slots

test('labor only assigned to funded slots', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 3;
  state.cantons.c1.sectors.manufacturing = { capacity: 5, funded: 3, idle: 2 };
  state.cantons.c1.sectors.agriculture = { capacity: 5, funded: 0, idle: 5 };
  runLabor(state);
  expect(state.cantons.c1.laborDemand.manufacturing?.skilled).toBe(3);
  expect(state.cantons.c1.laborDemand.agriculture).toBeUndefined();
});

// 4. Labor cannot be transferred between cantons

test('labor does not transfer between cantons', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');
  state.cantons.A.urbanizationLevel = 3; // plenty of labor
  state.cantons.B.urbanizationLevel = 0; // none
  state.cantons.A.sectors.agriculture = { capacity: 5, funded: 5, idle: 0 };
  state.cantons.B.sectors.agriculture = { capacity: 5, funded: 5, idle: 0 };
  runLabor(state);
  expect(state.cantons.B.laborAssigned.agriculture?.general ?? 0).toBe(0);
});

// 5. LAI scales labor availability

test('labor access index limits assignment', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 2; // generates 10 general labor
  state.cantons.c1.lai = 0.5; // effective labor = 5
  state.cantons.c1.sectors.agriculture = { capacity: 10, funded: 10, idle: 0 };
  runLabor(state);
  expect(state.cantons.c1.laborAssigned.agriculture?.general).toBe(5);
});

// 6a. Plan order priority

test('assignment respects plan order', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 1; // 5 general labor available
  state.cantons.c1.sectors.agriculture = { capacity: 4, funded: 4, idle: 0 };
  state.cantons.c1.sectors.logistics = { capacity: 4, funded: 4, idle: 0 };
  state.cantons.c1.suitability = { agriculture: 0.5, logistics: 0.9 };
  const plan: TurnPlan = {
    budgets: {},
    policies: {},
    slotPriorities: { agriculture: 1, logistics: 2 },
    tradeOrders: {},
    projects: {},
  };
  runLabor(state, plan);
  expect(state.cantons.c1.laborAssigned.agriculture?.general).toBe(4);
  expect(state.cantons.c1.laborAssigned.logistics?.general).toBe(1);
});

// 6b. Suitability ordering when priority equal

test('assignment uses suitability when priorities equal', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 1; // 5 general labor available
  state.cantons.c1.sectors.agriculture = { capacity: 4, funded: 4, idle: 0 };
  state.cantons.c1.sectors.logistics = { capacity: 4, funded: 4, idle: 0 };
  state.cantons.c1.suitability = { agriculture: 0.5, logistics: 0.9 };
  const plan: TurnPlan = {
    budgets: {},
    policies: {},
    slotPriorities: { agriculture: 1, logistics: 1 },
    tradeOrders: {},
    projects: {},
  };
  runLabor(state, plan);
  expect(state.cantons.c1.laborAssigned.logistics?.general).toBe(4);
  expect(state.cantons.c1.laborAssigned.agriculture?.general).toBe(1);
});

// 7. Consumption recorded

test('consumption recorded per labor unit', () => {
  const state = setupEconomy();
  state.resources.food = 10;
  state.resources.luxury = 10;
  state.cantons.c1.urbanizationLevel = 2;
  state.cantons.c1.sectors.agriculture = { capacity: 3, funded: 3, idle: 0 };
  runLabor(state);
  expect(state.cantons.c1.consumption.foodRequired).toBe(3);
  expect(state.cantons.c1.consumption.foodProvided).toBe(3);
});

// 8. Shortage flags when lacking resources

test('shortages flagged when food or luxury missing', () => {
  const state = setupEconomy();
  state.resources.food = 1;
  state.resources.luxury = 0;
  state.cantons.c1.urbanizationLevel = 2;
  state.cantons.c1.sectors.agriculture = { capacity: 3, funded: 3, idle: 0 };
  runLabor(state);
  expect(state.cantons.c1.shortages.food).toBeTrue();
  expect(state.cantons.c1.shortages.luxury).toBeTrue();
});

// 9. Idle slots do not consume labor

test('idle slots consume no labor', () => {
  const state = setupEconomy();
  state.cantons.c1.urbanizationLevel = 2;
  state.cantons.c1.sectors.agriculture = { capacity: 2, funded: 0, idle: 2 };
  runLabor(state);
  expect(state.cantons.c1.consumption.foodRequired).toBe(0);
});
