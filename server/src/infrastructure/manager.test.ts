import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import {
  InfrastructureManager,
  getInfraDefinition,
} from './manager';
import type { EconomyState } from '../types';

function setupState(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  EconomyManager.addCanton(state, 'B');
  EconomyManager.addCanton(state, 'C');
  EconomyManager.addCanton(state, 'N'); // national locations
  state.resources.gold = 10000;
  state.resources.production = 10000;
  return state;
}

// === Airport ===

test('airport costs and provides 1-hop air link via national airport', () => {
  expect(getInfraDefinition('airport')).toEqual({
    build: { gold: 120, production: 80, time: 3 },
    oAndM: { gold: 4, energy: 2 },
  });
  const state = setupState();
  InfrastructureManager.build(state, 'airport', 'N', { national: true });
  InfrastructureManager.build(state, 'airport', 'A');
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state);
  const result = InfrastructureManager.computeNetworks(state);
  expect(result.networks['A']!.air!.hops).toBe(1);
  expect(result.gatewayCapacities.air).toBeDefined();
});

// === Port ===

test('port auto-connects, adds LP and handles capture/repair', () => {
  const def = getInfraDefinition('port');
  expect(def).toEqual({
    build: { gold: 140, production: 100, time: 3 },
    oAndM: { gold: 3, energy: 2 },
  });
  const state = setupState();
  InfrastructureManager.build(state, 'port', 'N', { national: true });
  InfrastructureManager.build(state, 'port', 'A');
  InfrastructureManager.build(state, 'port', 'B');
  InfrastructureManager.build(state, 'port', 'C');
  const ctx = {
    portDistances: {
      N: { A: 5, B: 12, C: 30 },
      A: { N: 5, B: 8, C: 40 },
      B: { N: 12, A: 8, C: 10 },
      C: { B: 10, N: 30 },
    },
  };
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state, ctx);
  const result = InfrastructureManager.computeNetworks(state, ctx);
  expect(result.networks['C']!.sea!.hops).toBe(2); // via B -> N
  expect(result.lpBonus).toBe(40); // 4 ports * 10 LP
  expect(result.gatewayCapacities.port).toBeDefined();
  const unit = { stockpile: 5, maxStockpile: 10 };
  InfrastructureManager.navalResupply(unit);
  expect(unit.stockpile).toBe(10);
  // capture and repair
  state.infrastructure.ports['A'].hp = 50;
  InfrastructureManager.capture(state, 'port', 'A', 'Enemy');
  expect(state.infrastructure.ports['A'].owner).toBe('Enemy');
  InfrastructureManager.pillage(state, 'port', 'A');
  state.resources.production = 10;
  InfrastructureManager.repair(state, 'port', 'A');
  expect(state.resources.production).toBe(5);
  expect(state.infrastructure.ports['A'].hp).toBe(100);
});

// === Rail Hub ===

test('rail hubs link only via valid adjacency and provide min speed 4', () => {
  const def = getInfraDefinition('rail');
  expect(def).toEqual({
    build: { gold: 60, production: 45, time: 2 },
    oAndM: { gold: 2, energy: 1 },
  });
  const state = setupState();
  InfrastructureManager.build(state, 'rail', 'N', { national: true });
  InfrastructureManager.build(state, 'rail', 'A');
  InfrastructureManager.build(state, 'rail', 'B');
  InfrastructureManager.build(state, 'rail', 'C');
  const ctx = {
    railAdjacency: {
      N: { A: 'plains', B: 'mountains' },
      A: { N: 'plains', C: 'plains' },
      B: { N: 'mountains' },
      C: { A: 'plains', B: 'shallows' },
    },
  };
  for (let i = 0; i < 3; i++) InfrastructureManager.progressTurn(state, ctx);
  const result = InfrastructureManager.computeNetworks(state, ctx);
  expect(result.networks['B']!.rail!.connected).toBe(false);
  expect(result.networks['C']!.rail!.hops).toBe(2); // C->A->N
  const speed = InfrastructureManager.railMovementSpeed(2, ['C', 'A', 'N'], state, ctx);
  expect(speed).toBe(4);
  InfrastructureManager.pillage(state, 'rail', 'A');
  InfrastructureManager.progressTurn(state, ctx);
  const result2 = InfrastructureManager.computeNetworks(state, ctx);
  expect(result2.networks['C']!.rail!.connected).toBe(false);
  state.resources.production = 10;
  InfrastructureManager.repair(state, 'rail', 'A');
  InfrastructureManager.progressTurn(state, ctx);
  const result3 = InfrastructureManager.computeNetworks(state, ctx);
  expect(result3.networks['C']).toBeDefined();
});

// === National Variants ===

test('national variants enforce uniqueness and multipliers', () => {
  const base = getInfraDefinition('airport');
  const nat = getInfraDefinition('airport', true);
  expect(nat.build.gold).toBeCloseTo(base.build.gold * 1.5);
  expect(nat.oAndM.gold).toBe(base.oAndM.gold * 2);
  const state = setupState();
  InfrastructureManager.build(state, 'airport', 'N', { national: true });
  expect(() =>
    InfrastructureManager.build(state, 'airport', 'B', { national: true }),
  ).toThrow();
});

// === On/Off timing ===

test('turning infrastructure on/off takes a full turn', () => {
  const state = setupState();
  InfrastructureManager.build(state, 'port', 'N', { national: true });
  for (let i = 0; i < 4; i++) InfrastructureManager.progressTurn(state);
  expect(state.infrastructure.ports['N'].status).toBe('active');
  InfrastructureManager.toggle(state, 'port', 'N', 'inactive');
  expect(state.infrastructure.ports['N'].status).toBe('active');
  InfrastructureManager.progressTurn(state);
  expect(state.infrastructure.ports['N'].status).toBe('inactive');
});
