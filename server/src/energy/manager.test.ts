import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { EnergyManager, PLANT_ATTRIBUTES, RENEWABLE_CAPACITY_FACTOR, ENERGY_PER_SLOT } from './manager';
import type { EconomyState } from '../types';

function basicState(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  return state;
}

test('all plant types have attributes', () => {
  expect(Object.keys(PLANT_ATTRIBUTES).sort()).toEqual([
    'coal',
    'gas',
    'hydro',
    'nuclear',
    'oilPeaker',
    'solar',
    'wind',
  ]);
});

test('renewables use capacity factor', () => {
  const state = basicState();
  state.energy.plants.push({ canton: 'A', type: 'wind', status: 'active' });
  EnergyManager.run(state);
  expect(state.energy.state.supply).toBeCloseTo(
    PLANT_ATTRIBUTES.wind.baseOutput * RENEWABLE_CAPACITY_FACTOR,
  );
});

test('per-sector energy demand tracked and summed', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 2, idle: 0 };
  state.cantons['A'].sectors.finance = { capacity: 2, funded: 0, idle: 2 };
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(state);
  expect(state.energy.demandBySector.agriculture).toBe(
    2 * ENERGY_PER_SLOT.agriculture,
  );
  expect(state.energy.state.demand).toBe(state.energy.demandBySector.agriculture);
});

test('energy ratio scales utilization and records brownouts', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 2, idle: 0 };
  // no plants => supply 0
  EnergyManager.run(state);
  expect(state.energy.state.ratio).toBe(0);
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(0);
  expect(state.energy.brownouts.length).toBeGreaterThan(0);
});

test('essentials first prioritizes specified sectors', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 6, funded: 6, idle: 0 };
  state.cantons['A'].sectors.manufacturing = { capacity: 6, funded: 6, idle: 0 };
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  // uniform scaling
  EnergyManager.run(state);
  const uniformAg = state.cantons['A'].sectors.agriculture.funded;
  const uniformMan = state.cantons['A'].sectors.manufacturing.funded;
  // reset
  const state2 = basicState();
  state2.cantons['A'].sectors.agriculture = { capacity: 6, funded: 6, idle: 0 };
  state2.cantons['A'].sectors.manufacturing = { capacity: 6, funded: 6, idle: 0 };
  state2.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(state2, { essentialsFirst: true });
  expect(state2.cantons['A'].sectors.agriculture.funded).toBeGreaterThan(
    state2.cantons['A'].sectors.manufacturing.funded,
  );
  expect(uniformAg).toBe(uniformMan);
});

test('idle plants and building plants produce no energy', () => {
  const state = basicState();
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'idle' });
  state.energy.plants.push({
    canton: 'A',
    type: 'solar',
    status: 'building',
    turns_remaining: 2,
  });
  EnergyManager.run(state);
  expect(state.energy.state.supply).toBe(0);
});

test('idle slots do not consume energy', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 3, funded: 1, idle: 2 };
  EnergyManager.run(state);
  expect(state.energy.state.demand).toBe(1 * ENERGY_PER_SLOT.agriculture);
});

