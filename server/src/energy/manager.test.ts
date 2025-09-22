import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { EnergyManager, PLANT_ATTRIBUTES, RENEWABLE_CAPACITY_FACTOR, ENERGY_PER_SLOT } from './manager';
import type { EconomyState } from '../types';

function basicState(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  // Provide ample resources so plants can run unless tests override.
  state.resources.gold = 100;
  state.resources.coal = 100;
  state.resources.oil = 100;
  state.resources.uranium = 100;
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
  expect(state.energy.oAndMSpent).toBe(PLANT_ATTRIBUTES.wind.oAndMCost);
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
  const startingGold = state.resources.gold;
  const startingCoal = state.resources.coal;
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'idle' });
  state.energy.plants.push({
    canton: 'A',
    type: 'solar',
    status: 'building',
    turns_remaining: 2,
  });
  EnergyManager.run(state);
  expect(state.energy.state.supply).toBe(0);
  expect(state.resources.gold).toBe(startingGold);
  expect(state.resources.coal).toBe(startingCoal);
});

test('idle slots do not consume energy', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 3, funded: 1, idle: 2 };
  EnergyManager.run(state);
  expect(state.energy.state.demand).toBe(1 * ENERGY_PER_SLOT.agriculture);
});

test('plant consumes fuel and O&M when running', () => {
  const state = basicState();
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(state);
  expect(state.energy.state.supply).toBe(PLANT_ATTRIBUTES.coal.baseOutput);
  expect(state.resources.coal).toBe(100 - PLANT_ATTRIBUTES.coal.baseOutput);
  expect(state.resources.gold).toBe(100 - PLANT_ATTRIBUTES.coal.oAndMCost);
  expect(state.energy.fuelUsed.coal).toBe(PLANT_ATTRIBUTES.coal.baseOutput);
  expect(state.energy.oAndMSpent).toBe(PLANT_ATTRIBUTES.coal.oAndMCost);
});

test('plant fails without fuel or O&M', () => {
  const stateFuel = basicState();
  stateFuel.resources.coal = 0; // no fuel
  stateFuel.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(stateFuel);
  expect(stateFuel.energy.state.supply).toBe(0);
  expect(stateFuel.energy.fuelUsed.coal).toBeUndefined();
  expect(stateFuel.resources.gold).toBe(100); // no O&M spent

  const stateOM = basicState();
  stateOM.resources.gold = 0; // no O&M
  stateOM.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(stateOM);
  expect(stateOM.energy.state.supply).toBe(0);
});

test('exact balance of supply and demand avoids brownouts', () => {
  const state = basicState();
  state.cantons['A'].sectors.agriculture = { capacity: 10, funded: 10, idle: 0 };
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(state);
  expect(state.energy.state.ratio).toBe(1);
  expect(state.energy.brownouts.length).toBe(0);
  expect(state.cantons['A'].sectors.agriculture.funded).toBe(10);
});

test('zero demand keeps ratio at 1 and does not stockpile energy', () => {
  const state = basicState();
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  EnergyManager.run(state);
  expect(state.energy.state.demand).toBe(0);
  expect(state.energy.state.ratio).toBe(1);
  expect(state.resources.energy).toBe(0);
  const supply1 = state.energy.state.supply;
  EnergyManager.run(state);
  expect(state.energy.state.supply).toBe(supply1);
});

test('mixed plant stack sums output', () => {
  const state = basicState();
  state.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  state.energy.plants.push({ canton: 'A', type: 'solar', status: 'active' });
  EnergyManager.run(state);
  const expected =
    PLANT_ATTRIBUTES.coal.baseOutput +
    PLANT_ATTRIBUTES.solar.baseOutput * RENEWABLE_CAPACITY_FACTOR;
  expect(state.energy.state.supply).toBeCloseTo(expected);
});

test('deterministic outputs for identical inputs', () => {
  const base = basicState();
  base.cantons['A'].sectors.agriculture = { capacity: 4, funded: 4, idle: 0 };
  base.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  const copy = JSON.parse(JSON.stringify(base));
  EnergyManager.run(base);
  EnergyManager.run(copy);
  expect(copy.energy).toEqual(base.energy);
});

