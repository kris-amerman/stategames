import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { BudgetManager, OM_COST_PER_SLOT } from './manager';
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
