import { expect, test, describe } from 'bun:test';
import { GameStateManager } from '../game-state/manager';
import { InMediaResInitializer } from '../game-state/inmediares';
import { buildNationInputs } from '../test-utils/nations';
import { computeNationStatusSummary, updateNationStatus } from './summary';
import type { NationPreset, NationState } from '../types';

const NEIGHBORS = new Int32Array([
  1, 2,
  0, 3,
  0, 3,
  1, 2,
]);

const OFFSETS = new Uint32Array([0, 2, 4, 6, 8]);

const BIOMES = new Uint8Array([1, 7, 1, 1]);

function initializeGame(presets: NationPreset[], seed = 'status-test') {
  const players = presets.map((_, index) => `player${index + 1}`);
  const biomes = new Uint8Array(BIOMES);
  const game = GameStateManager.createCompleteGame(
    `game-${seed}`,
    `JOIN-${seed}`,
    players,
    'small',
    biomes,
    players.length,
    [],
    seed,
  );

  const nationInputs = buildNationInputs(presets);

  players.forEach((playerId, index) => {
    const cell = index === 0 ? 0 : index === 1 ? 2 : 3;
    game.state.playerCells[playerId] = [cell];
    game.state.cellOwnership[cell] = playerId;
  });

  GameStateManager.initializeNationInfrastructure(
    game.state,
    players,
    biomes,
    NEIGHBORS,
    OFFSETS,
  );

  InMediaResInitializer.initialize(
    game,
    nationInputs,
    biomes,
    NEIGHBORS,
    OFFSETS,
    seed,
  );

  return { game, players };
}

function firstNation(game: { state: { nations: Record<string, NationState> } }, players: string[]) {
  const playerId = players[0];
  return { nation: game.state.nations[playerId], playerId };
}

describe('nation status summary', () => {
  test('stockpiled resource deltas reflect production and consumption changes', () => {
    const { game, players } = initializeGame(['Balanced Mixed Economy']);
    const { nation } = firstNation(game, players);

    const initial = computeNationStatusSummary(nation);
    expect(initial.stockpiles.food.current).toBe(nation.stockpiles.food);

    const originalFoodDelta = initial.stockpiles.food.delta;

    if (nation.sectors.agriculture) {
      nation.sectors.agriculture.utilization = Math.max(0, (nation.sectors.agriculture.utilization ?? 0) - 2);
    }

    const afterReduction = computeNationStatusSummary(nation);
    expect(afterReduction.stockpiles.food.delta).toBeLessThanOrEqual(originalFoodDelta);

    if (nation.sectors.agriculture) {
      nation.sectors.agriculture.utilization = (nation.sectors.agriculture.utilization ?? 0) + 4;
    }

    const boosted = computeNationStatusSummary(nation);
    expect(boosted.stockpiles.food.delta).toBeGreaterThan(afterReduction.stockpiles.food.delta);

    if (nation.sectors.manufacturing) {
      nation.sectors.manufacturing.utilization = (nation.sectors.manufacturing.utilization ?? 0) + 3;
    }

    const withManufacturing = computeNationStatusSummary(nation);
    expect(withManufacturing.stockpiles.materials.delta).toBeLessThanOrEqual(boosted.stockpiles.materials.delta);
  });

  test('flows, labor availability, and happiness indicators update together', () => {
    const { game, players } = initializeGame(['Research State']);
    const { nation } = firstNation(game, players);

    const status = computeNationStatusSummary(nation);
    expect(status.flows.energy).toBeCloseTo(nation.energy.supply, 2);
    expect(status.flows.logistics).toBeCloseTo(nation.logistics.supply, 2);

    const researchSlots = nation.sectors.research?.utilization ?? 0;
    expect(status.flows.research).toBeCloseTo(researchSlots, 2);

    expect(status.labor.general).toBe(nation.labor.available.general);
    expect(status.labor.skilled).toBe(nation.labor.available.skilled);
    expect(status.labor.specialist).toBe(nation.labor.available.specialist);

    nation.labor.happiness = 0.82;
    const happy = computeNationStatusSummary(nation);
    expect(happy.happiness.emoji).toBe('🙂');
    expect(happy.happiness.value).toBe(Math.round(0.82 * 100));

    nation.labor.happiness = 0.25;
    const unhappy = computeNationStatusSummary(nation);
    expect(unhappy.happiness.emoji).toBe('☹️');
  });

  test('gold indicator encodes debt as negative and respects mutual exclusivity', () => {
    const { game, players } = initializeGame(['Finance and Services Hub']);
    const { nation } = firstNation(game, players);

    nation.finance.treasury = 75;
    nation.finance.debt = 0;
    let status = computeNationStatusSummary(nation);
    expect(status.gold.isDebt).toBe(false);
    expect(status.gold.value).toBeCloseTo(75, 2);

    nation.finance.debt = 40;
    nation.finance.treasury = 120;
    status = computeNationStatusSummary(nation);
    expect(status.gold.isDebt).toBe(true);
    expect(status.gold.value).toBe(-40);

    nation.finance.debt = 0;
    nation.finance.treasury = 0;
    status = computeNationStatusSummary(nation);
    expect(status.gold.isDebt).toBe(false);
    expect(status.gold.value).toBe(0);
  });

  test('status summaries are deterministic with identical seeds', () => {
    const first = initializeGame(['Balanced Mixed Economy', 'Defense-Manufacturing Complex'], 'seed-a');
    const second = initializeGame(['Balanced Mixed Economy', 'Defense-Manufacturing Complex'], 'seed-a');

    first.players.forEach((playerId, index) => {
      const nationA = first.game.state.nations[playerId];
      const nationB = second.game.state.nations[second.players[index]];
      expect(nationA.status).toEqual(nationB.status);
    });
  });

  test('different presets produce distinct status emphases', () => {
    const { game, players } = initializeGame([
      'Industrializing Exporter',
      'Agrarian Surplus',
      'Finance and Services Hub',
    ], 'variance');

    const statuses = players.map((playerId) => game.state.nations[playerId].status);
    const materialDeltas = statuses.map((status) => status.stockpiles.materials.delta);
    const uniqueMaterialDeltas = new Set(materialDeltas.map((value) => Math.round(value * 100))); // quantize
    expect(uniqueMaterialDeltas.size).toBeGreaterThan(1);
  });

  test('updateNationStatus mutates the nation and stays in sync', () => {
    const { game, players } = initializeGame(['Balanced Mixed Economy']);
    const { nation } = firstNation(game, players);

    nation.finance.debt = 10;
    const updated = updateNationStatus(nation);
    expect(nation.status).toEqual(updated);
    expect(updated.gold.value).toBe(-10);
  });
});
