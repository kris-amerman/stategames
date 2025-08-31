import { test, expect } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { InfrastructureManager } from '../infrastructure/manager';
import { LaborManager } from '../labor/manager';
import { SuitabilityManager } from '../suitability/manager';
import { DevelopmentManager } from '../development/manager';
import type { EconomyState } from '../types';

function setupEconomy(): EconomyState {
  const state = EconomyManager.createInitialState();
  // Capital / national canton
  EconomyManager.addCanton(state, 'N');
  // Additional cantons
  EconomyManager.addCanton(state, 'Coast');
  EconomyManager.addCanton(state, 'Inland');
  EconomyManager.addCanton(state, 'Mountain');
  state.resources.gold = 10_000;
  state.resources.production = 10_000;
  state.cantons['N'].geography = { plains: 0.6, coast: 0.4 };
  state.cantons['Coast'].geography = { plains: 0.5, coast: 0.5 };
  state.cantons['Inland'].geography = { plains: 1 };
  state.cantons['Mountain'].geography = { plains: 0.3, mountains: 0.7 };
  return state;
}

// 1. Initialization Check
// Create players/nations/cantons with geography mixes and verify defaults.
test('initialization populates cantons with UL, labor and geography', () => {
  const state = setupEconomy();
  LaborManager.generate(state);
  expect(state.cantons['Coast'].urbanizationLevel).toBe(1);
  expect(state.cantons['Coast'].labor.general).toBe(5); // UL1 supply
  expect(state.cantons['Coast'].geography.coast).toBeCloseTo(0.5);
  InfrastructureManager.build(state, 'airport', 'N', { national: true });
  InfrastructureManager.build(state, 'airport', 'Coast');
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state);
  expect(state.infrastructure.airports['N'].status).toBe('active');
  expect(state.infrastructure.airports['Coast'].status).toBe('active');
});

// 2. Canton Differentiation: coastal vs inland port
// Coastal canton gains port network, inland canton has none.
test('coastal canton connects to port network while inland does not', () => {
  const state = setupEconomy();
  InfrastructureManager.build(state, 'port', 'N', { national: true });
  InfrastructureManager.build(state, 'port', 'Coast');
  const ctx = { portDistances: { N: { Coast: 5 }, Coast: { N: 5 } } };
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state, ctx);
  const result = InfrastructureManager.computeNetworks(state, ctx);
  expect(result.networks['Coast']!.sea!.connected).toBe(true);
  expect(result.networks['Inland']?.sea).toBeUndefined();
});

// 3. Rail Connectivity across terrain
// Adjacent hubs connect only through allowed terrain.
test('rail connectivity requires hubs and passable terrain', () => {
  const state = setupEconomy();
  InfrastructureManager.build(state, 'rail', 'N', { national: true });
  InfrastructureManager.build(state, 'rail', 'Coast');
  InfrastructureManager.build(state, 'rail', 'Inland');
  InfrastructureManager.build(state, 'rail', 'Mountain');
  const ctx = {
    railAdjacency: {
      N: { Coast: 'plains', Inland: 'plains' },
      Coast: { N: 'plains', Inland: 'plains' },
      Inland: { N: 'plains', Coast: 'plains', Mountain: 'mountains' },
      Mountain: { Inland: 'mountains' },
    },
  };
  for (let i = 0; i < 3; i++) InfrastructureManager.progressTurn(state, ctx);
  const nets = InfrastructureManager.computeNetworks(state, ctx);
  expect(nets.networks['Inland']!.rail!.connected).toBe(true);
  expect(nets.networks['Mountain']!.rail!.connected).toBe(false);
});

// 4. Port & Airport Links
// Airports link to national airport in 1 hop, ports link within 15 cells.
test('ports and airports link to national gateways with hop counts', () => {
  const state = setupEconomy();
  InfrastructureManager.build(state, 'airport', 'N', { national: true });
  InfrastructureManager.build(state, 'airport', 'Inland');
  InfrastructureManager.build(state, 'port', 'N', { national: true });
  InfrastructureManager.build(state, 'port', 'Coast');
  const ctx = { portDistances: { N: { Coast: 5 }, Coast: { N: 5 } } };
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state, ctx);
  const nets = InfrastructureManager.computeNetworks(state, ctx);
  expect(nets.networks['Inland']!.air!.hops).toBe(1);
  expect(nets.networks['Coast']!.sea!.hops).toBe(1);
});

// 5. Suitability Application
// Geography mix affects sector suitability.
test('suitability reflects geography and UL modifiers', () => {
  const state = setupEconomy();
  SuitabilityManager.setGeographyModifiers({
    agriculture: { plains: 20, mountains: -20 },
  });
  SuitabilityManager.run(state);
  const plainsScore = state.cantons['Inland'].suitability.agriculture!;
  const mountainScore = state.cantons['Mountain'].suitability.agriculture!;
  expect(plainsScore).toBeGreaterThan(mountainScore);
});

// 6. Urbanization Progression
// Development increases UL and affects labor and suitability next turn.
test('development rolls raise UL and update dependent systems', () => {
  const state = setupEconomy();
  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: 0 } });
  SuitabilityManager.setUrbanizationModifiers({ agriculture: { 1: 0, 2: 10 } });
  LaborManager.generate(state);
  SuitabilityManager.run(state);
  const beforeLabor = state.cantons['Inland'].labor.general;
  const beforeSuit = state.cantons['Inland'].suitability.agriculture!;
  DevelopmentManager.run(state, { Inland: { baseRoll: 4 } });
  DevelopmentManager.applyPending(state);
  LaborManager.generate(state);
  SuitabilityManager.run(state);
  expect(state.cantons['Inland'].urbanizationLevel).toBe(2);
  const afterLabor = state.cantons['Inland'].labor.general;
  const afterSuit = state.cantons['Inland'].suitability.agriculture!;
  expect(afterLabor).toBeGreaterThan(beforeLabor);
  expect(afterSuit).toBeGreaterThan(beforeSuit);
});

// 7. Nation Aggregation
// Canton contributions sum to national totals (labor, LP bonus).
test('national totals aggregate canton contributions', () => {
  const state = setupEconomy();
  InfrastructureManager.build(state, 'port', 'N', { national: true });
  InfrastructureManager.build(state, 'port', 'Coast');
  const ctx = { portDistances: { N: { Coast: 5 }, Coast: { N: 5 } } };
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state, ctx);
  const nets = InfrastructureManager.computeNetworks(state, ctx);
  expect(nets.lpBonus).toBe(20); // two active ports
  LaborManager.generate(state);
  const totalLabor = Object.values(state.cantons).reduce(
    (sum, c) => sum + c.labor.general + c.labor.skilled + c.labor.specialist,
    0,
  );
  expect(totalLabor).toBe(4 * (5 + 1 + 0)); // UL1 labor mix
});
