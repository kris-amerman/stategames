import { expect, test, spyOn } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { BudgetManager, OM_COST_PER_SLOT, RETOOL_COST_PER_SLOT } from './manager';
import type { BudgetPools } from '../types';

test('allocates funded slots by suitability with largest remainder', () => {
  const state = EconomyManager.createInitialState();
  // create two cantons
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');

  // set capacities and suitability for manufacturing sector
  state.cantons['A'].sectors.manufacturing = { capacity: 3, funded: 0, idle: 0 };
  state.cantons['A'].suitability.manufacturing = 0.8;
  state.cantons['B'].sectors.manufacturing = { capacity: 2, funded: 0, idle: 0 };
  state.cantons['B'].suitability.manufacturing = 0.5;

  state.resources.gold = 100; // sufficient gold
  const budget: BudgetPools = {
    military: 0,
    welfare: 0,
    sectorOM: {
      manufacturing: OM_COST_PER_SLOT.manufacturing * 3,
    },
  };

  BudgetManager.applyBudgets(state, budget);

  expect(state.cantons['A'].sectors.manufacturing.funded).toBe(2);
  expect(state.cantons['B'].sectors.manufacturing.funded).toBe(1);
});

test('deducts all three budget pools and computes idle costs', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.resources.gold = 100;
  const budget: BudgetPools = {
    military: 10,
    welfare: 5,
    sectorOM: { agriculture: OM_COST_PER_SLOT.agriculture },
  };
  BudgetManager.applyBudgets(state, budget);
  // Military + welfare spent
  expect(state.resources.gold).toBeCloseTo(100 - 10 - 5 - 1 - 0.25);
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(1);
  expect(state.cantons['A'].sectors.agriculture.idle).toBe(1);
});

test('deterministic tie-breaking for equal suitability and remainder', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');
  state.cantons['A'].sectors.agriculture = { capacity: 1, funded: 0, idle: 0 };
  state.cantons['B'].sectors.agriculture = { capacity: 1, funded: 0, idle: 0 };
  state.cantons['A'].suitability.agriculture = 0.5;
  state.cantons['B'].suitability.agriculture = 0.5;
  state.resources.gold = 100;
  const budget: BudgetPools = {
    military: 0,
    welfare: 0,
    sectorOM: { agriculture: OM_COST_PER_SLOT.agriculture },
  };
  BudgetManager.applyBudgets(state, budget);
  expect(
    state.cantons['A'].sectors.agriculture.funded +
      state.cantons['B'].sectors.agriculture.funded,
  ).toBe(1);
  // Canton A should be funded due to deterministic ordering
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(1);
});

test('retools record cost and downtime, slots unavailable during retool', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.resources.gold = 100;
  BudgetManager.scheduleRetool(state, {
    canton: 'A',
    sector_from: 'agriculture',
    sector_to: 'manufacturing',
    slots: 1,
  });
  expect(state.resources.gold).toBe(92);
  expect(state.cantons['A'].sectors.agriculture.capacity).toBe(1);
  expect(state.retoolQueue[0].turns_remaining).toBe(2);
  BudgetManager.advanceRetools(state);
  expect(state.retoolQueue[0].turns_remaining).toBe(1);
});

test('budget stage emits hooks for inputs, labor, and modifiers', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 1, funded: 0, idle: 0 };
  state.resources.gold = 10;
  (BudgetManager as any).hooks = {
    inputs: () => {},
    labor: () => {},
    modifiers: () => {},
  };
  const inputsSpy = spyOn((BudgetManager as any).hooks, 'inputs');
  const laborSpy = spyOn((BudgetManager as any).hooks, 'labor');
  const modSpy = spyOn((BudgetManager as any).hooks, 'modifiers');
  const budget: BudgetPools = {
    military: 0,
    welfare: 0,
    sectorOM: { agriculture: OM_COST_PER_SLOT.agriculture },
  };
  BudgetManager.applyBudgets(state, budget);
  expect(inputsSpy).toHaveBeenCalled();
  expect(laborSpy.mock.invocationCallOrder[0]).toBeGreaterThan(inputsSpy.mock.invocationCallOrder[0]);
  expect(modSpy.mock.invocationCallOrder[0]).toBeGreaterThan(laborSpy.mock.invocationCallOrder[0]);
  inputsSpy.mockRestore();
  laborSpy.mockRestore();
  modSpy.mockRestore();
});

test('zero budget incurs idle tax but funds no slots', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.resources.gold = 10;
  const budget: BudgetPools = { military: 0, welfare: 0, sectorOM: {} };
  BudgetManager.applyBudgets(state, budget);
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(0);
  expect(state.cantons['A'].sectors.agriculture.idle).toBe(2);
  expect(state.resources.gold).toBeCloseTo(10 - 0.5);
});

test('full funding pays only active costs with no idle tax', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.cantons['B'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.resources.gold = 100;
  const budget: BudgetPools = {
    military: 0,
    welfare: 0,
    sectorOM: { agriculture: OM_COST_PER_SLOT.agriculture * 4 },
  };
  BudgetManager.applyBudgets(state, budget);
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(2);
  expect(state.cantons['B'].sectors.agriculture.funded).toBe(2);
  expect(state.cantons['A'].sectors.agriculture.idle).toBe(0);
  expect(state.cantons['B'].sectors.agriculture.idle).toBe(0);
  expect(state.resources.gold).toBeCloseTo(100 - 4);
});

test('fractional allocation with equal remainders favors higher suitability', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');
  state.cantons['A'].sectors.manufacturing = { capacity: 2, funded: 0, idle: 0 };
  state.cantons['B'].sectors.manufacturing = { capacity: 2, funded: 0, idle: 0 };
  state.cantons['A'].suitability.manufacturing = 0.6;
  state.cantons['B'].suitability.manufacturing = 0.4;
  state.resources.gold = 100;
  const budget: BudgetPools = {
    military: 0,
    welfare: 0,
    sectorOM: { manufacturing: OM_COST_PER_SLOT.manufacturing * 3 },
  };
  BudgetManager.applyBudgets(state, budget);
  expect(state.cantons['A'].sectors.manufacturing.funded).toBe(2);
  expect(state.cantons['B'].sectors.manufacturing.funded).toBe(1);
});

test('multiple retool orders charge cost and complete after two turns', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 0, idle: 0 };
  state.resources.gold = 100;
  BudgetManager.scheduleRetool(state, {
    canton: 'A',
    sector_from: 'agriculture',
    sector_to: 'manufacturing',
    slots: 1,
  });
  BudgetManager.scheduleRetool(state, {
    canton: 'A',
    sector_from: 'agriculture',
    sector_to: 'research',
    slots: 1,
  });
  expect(state.cantons['A'].sectors.agriculture.capacity).toBe(0);
  expect(state.resources.gold).toBe(100 - RETOOL_COST_PER_SLOT * 2);
  expect(state.retoolQueue.length).toBe(2);
  BudgetManager.advanceRetools(state);
  expect(state.retoolQueue[0].turns_remaining).toBe(1);
  expect(state.retoolQueue[1].turns_remaining).toBe(1);
  BudgetManager.advanceRetools(state);
  expect(state.retoolQueue.length).toBe(0);
  expect(state.cantons['A'].sectors.manufacturing?.capacity).toBe(1);
  expect(state.cantons['A'].sectors.research?.capacity).toBe(1);
});
