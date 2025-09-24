import { test, expect } from 'bun:test';
import { GameStateManager } from './manager';
import type { GameState } from '../types';

function createInitializedState(): GameState {
  const players = ['player1', 'player2'];
  const state = GameStateManager.createInitialGameState(players);
  const biomes = new Uint8Array([1, 1, 6, 1]);
  const cellNeighbors = new Int32Array([
    1, 2,
    0, 3,
    0, 3,
    1, 2,
  ]);
  const cellOffsets = new Uint32Array([0, 2, 4, 6, 8]);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    GameStateManager.assignStartingTerritories(
      state,
      cellNeighbors,
      cellOffsets,
      biomes.length,
      biomes,
    );
    GameStateManager.initializeNationInfrastructure(
      state,
      players,
      biomes,
      cellNeighbors,
      cellOffsets,
    );
  } finally {
    Math.random = originalRandom;
  }
  return state;
}

test('nations begin with mid-game infrastructure and economy', () => {
  const state = createInitializedState();
  const economy = state.economy;

  // Infrastructure
  expect(Object.keys(economy.infrastructure.airports).length).toBeGreaterThan(0);
  expect(Object.keys(economy.infrastructure.railHubs).length).toBeGreaterThan(0);
  expect(economy.infrastructure.national.airport).toBeDefined();
  expect(economy.infrastructure.national.rail).toBeDefined();

  // Ports set when geography allows
  const hasCoastal = Object.values(economy.infrastructure.ports).length > 0;
  if (hasCoastal) {
    expect(economy.infrastructure.national.port).toBeDefined();
  }

  // Cantons and labor
  const cantonIds = Object.keys(economy.cantons);
  expect(cantonIds.length).toBeGreaterThan(0);
  for (const cantonId of cantonIds) {
    const canton = economy.cantons[cantonId];
    expect(canton.urbanizationLevel).toBeGreaterThanOrEqual(2);
    expect(canton.development).toBeGreaterThan(0);
    expect(canton.development).toBeLessThanOrEqual(3);
    expect(canton.labor.general + canton.labor.skilled + canton.labor.specialist).toBeGreaterThan(0);
  }

  // Finance and welfare
  expect(economy.resources.gold).toBeGreaterThan(0);
  expect(economy.finance.debt).toBeGreaterThan(0);
  expect(economy.finance.creditLimit).toBeGreaterThan(economy.finance.debt);
  expect(economy.welfare.current.education).toBeGreaterThan(0);
  expect(economy.welfare.current.healthcare).toBeGreaterThan(0);

  // Energy state seeded
  expect(economy.energy.plants.length).toBeGreaterThan(0);
  expect(economy.energy.state.supply).toBeGreaterThan(0);
  expect(economy.energy.state.demand).toBeGreaterThan(0);

  // Sector readiness includes funded and idle slots
  const sectors: Set<string> = new Set();
  for (const canton of Object.values(economy.cantons)) {
    for (const [sector, data] of Object.entries(canton.sectors)) {
      if (!data) continue;
      if (data.funded > 0 && data.idle > 0) {
        sectors.add(sector);
      }
    }
  }
  expect(sectors.has('agriculture')).toBe(true);
  expect(sectors.has('manufacturing')).toBe(true);
  expect(sectors.has('energy')).toBe(true);
  expect(sectors.has('defense')).toBe(true);
  expect(sectors.has('finance')).toBe(true);
  expect(sectors.has('research')).toBe(true);
  expect(sectors.has('logistics')).toBe(true);
  expect(sectors.has('extraction')).toBe(true);
  expect(sectors.has('luxury')).toBe(true);

  // Military units with upkeep obligations
  const unitIds = state.entitiesByType.unit;
  expect(unitIds.length).toBeGreaterThan(0);
  for (const id of unitIds) {
    const unit = state.entities[id];
    expect(unit).toBeDefined();
    expect(unit?.data.upkeep).toBeGreaterThan(0);
  }

  // Planning state carries existing obligations
  expect(state.currentPlan?.budgets?.military).toBeGreaterThan(0);
  expect(state.nextPlan?.budgets?.welfare).toBeGreaterThan(0);
});
