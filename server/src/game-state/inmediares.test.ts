import { expect, test } from 'bun:test';
import { GameStateManager } from './manager';
import { InMediaResInitializer, __test as InMediaResTestHooks } from './inmediares';
import { buildNationInputs } from '../test-utils/nations';
import { OM_COST_PER_SLOT } from '../budget/manager';
import { OPERATING_LP_COST } from '../logistics/manager';
import { ENERGY_PER_SLOT, PLANT_ATTRIBUTES } from '../energy/manager';
import type { NationPreset, SectorType } from '../types';

const NEIGHBORS = new Int32Array([
  1, 2,
  0, 3,
  0, 3,
  1, 2,
]);

const OFFSETS = new Uint32Array([0, 2, 4, 6, 8]);

const BIOMES = new Uint8Array([1, 7, 1, 1]);

function setupGame(presets: NationPreset[], seed = 'test-seed') {
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

  const metas = InMediaResInitializer.initialize(
    game,
    nationInputs,
    biomes,
    NEIGHBORS,
    OFFSETS,
    seed,
  );

  return { game, metas, nationInputs, players };
}

test('in-media-res initialization satisfies balance, finance, and stockpile targets', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Finance and Services Hub',
    'Defense-Manufacturing Complex',
  ];
  const { game } = setupGame(presets, 'balance');
  const nations = Object.values(game.state.nations);

  expect(nations.length).toBe(presets.length);

  for (const nation of nations) {
    expect(nation.energy.ratio).toBeGreaterThanOrEqual(0.95);
    expect(nation.energy.ratio).toBeLessThanOrEqual(1.05);
    expect(nation.logistics.ratio).toBeGreaterThanOrEqual(0.95);
    expect(nation.logistics.ratio).toBeLessThanOrEqual(1.05);

    const assignedLabor = nation.labor.assigned;
    const totalLabor = assignedLabor.general + assignedLabor.skilled + assignedLabor.specialist;
    expect(totalLabor).toBeGreaterThan(0);

    const foodTurns = nation.stockpiles.food / totalLabor;
    expect(foodTurns).toBeGreaterThanOrEqual(2);
    expect(foodTurns).toBeLessThanOrEqual(5);

    const plants = nation.energy.plants;
    expect(plants.length).toBeGreaterThan(0);
    const fuelDemand = plants.reduce((sum, plant) => {
      const attrs = PLANT_ATTRIBUTES[plant.type];
      return attrs.fuelType ? sum + attrs.baseOutput : sum;
    }, 0);
    if (fuelDemand > 0) {
      const fuelTurns = nation.stockpiles.fuel / fuelDemand;
      expect(Math.floor(fuelTurns)).toBeGreaterThanOrEqual(2);
      expect(Math.ceil(fuelTurns)).toBeLessThanOrEqual(3);
    } else {
      expect(nation.stockpiles.fuel).toBeGreaterThanOrEqual(0);
    }

    const funded = (sector: SectorType) => nation.sectors[sector]?.funded ?? 0;
    const materialsPerTurn = Math.max(
      2,
      Math.round(
        funded('manufacturing') * 1.3 +
          funded('defense') * 1.2 +
          funded('extraction') * 0.6 +
          funded('logistics') * 0.3,
      ),
    );
    const materialTurns = nation.stockpiles.materials / materialsPerTurn;
    expect(Math.floor(materialTurns)).toBeGreaterThanOrEqual(2);
    expect(Math.ceil(materialTurns)).toBeLessThanOrEqual(4);

    const fxMin = Math.floor(nation.finance.stableRevenue * 2);
    const fxMax = Math.ceil(nation.finance.stableRevenue * 4);
    expect(nation.stockpiles.fx).toBeGreaterThanOrEqual(fxMin);
    expect(nation.stockpiles.fx).toBeLessThanOrEqual(fxMax);

    expect(nation.stockpiles.luxury).toBeGreaterThan(0);
    expect(nation.stockpiles.ordnance).toBeGreaterThan(0);
    expect(nation.stockpiles.production).toBeGreaterThan(0);

    expect(nation.military.funded).toBeGreaterThanOrEqual(nation.military.upkeep);
    expect(nation.finance.debt).toBeLessThanOrEqual(nation.finance.creditLimit);

    const waterfall = nation.finance.waterfall;
    const obligations =
      waterfall.interest +
      waterfall.operations +
      waterfall.welfare +
      waterfall.military +
      waterfall.projects;
    expect(obligations).toBeLessThanOrEqual(waterfall.initial + 0.01);
    expect(Math.abs(waterfall.initial - (obligations + waterfall.surplus))).toBeLessThanOrEqual(0.5);
    expect(waterfall.surplus).toBeCloseTo(nation.finance.treasury, 5);

    const availableLabor = nation.labor.available;
    expect(availableLabor.general).toBeGreaterThanOrEqual(assignedLabor.general);
    expect(availableLabor.skilled).toBeGreaterThanOrEqual(assignedLabor.skilled);
    expect(availableLabor.specialist).toBeGreaterThanOrEqual(assignedLabor.specialist);

    expect(nation.projects.length).toBeGreaterThan(0);
    expect(nation.projects[0].turnsRemaining).toBeGreaterThan(0);

    const expectedIdle = (Object.keys(nation.sectors) as SectorType[]).reduce((sum, key) => {
      const sector = nation.sectors[key];
      if (!sector) return sum;
      const rate = OM_COST_PER_SLOT[key] ?? 0;
      return sum + sector.idle * rate * 0.25;
    }, 0);
    expect(Math.abs(expectedIdle - nation.idleCost)).toBeLessThanOrEqual(2);
    expect(nation.idleCost).toBeLessThanOrEqual(nation.omCost * 0.5);

    const logisticsDemand = (Object.keys(nation.sectors) as SectorType[]).reduce((sum, key) => {
      if (key === 'logistics') return sum;
      const rate = OPERATING_LP_COST[key] ?? 0;
      return sum + (nation.sectors[key]?.funded ?? 0) * rate;
    }, 0);
    expect(logisticsDemand).toBeGreaterThan(0);
    expect(nation.logistics.demand).toBeCloseTo(logisticsDemand, 1);

    const energyDemand = (Object.keys(nation.sectors) as SectorType[]).reduce((sum, key) => {
      if (key === 'energy') return sum;
      const rate = ENERGY_PER_SLOT[key] ?? 0;
      return sum + (nation.sectors[key]?.funded ?? 0) * rate;
    }, 0);
    expect(nation.energy.demand).toBeCloseTo(energyDemand, 1);

    expect(nation.welfare.cost).toBeLessThanOrEqual(nation.finance.stableRevenue * 0.6 + 1);
    expect(nation.labor.consumption.foodRequired).toBe(totalLabor);
    expect(nation.labor.consumption.luxuryRequired).toBe(totalLabor);
  }

  const economy = game.state.economy;
  expect(economy.energy.state.ratio).toBeGreaterThanOrEqual(0.95);
  expect(economy.energy.state.ratio).toBeLessThanOrEqual(1.05);
});

test('initialization is deterministic for identical seeds', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Finance and Services Hub',
  ];
  const first = setupGame(presets, 'repeat');
  const second = setupGame(presets, 'repeat');

  expect(first.game.state.nations).toEqual(second.game.state.nations);
  expect(first.metas).toEqual(second.metas);
  expect(first.game.state.economy.energy).toEqual(second.game.state.economy.energy);
});

test('different presets yield divergent nation signatures and coastal infrastructure', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Agrarian Surplus',
    'Research State',
  ];
  const { game } = setupGame(presets, 'divergence');
  const nations = Object.values(game.state.nations);

  const signatures = new Set(nations.map(nation => nation.signature));
  expect(signatures.size).toBe(nations.length);

  for (const nation of nations) {
    const hasPort = Boolean(game.state.economy.infrastructure.ports[nation.canton]);
    if (nation.coastal) {
      expect(hasPort).toBe(true);
    } else {
      expect(hasPort).toBe(false);
    }
  }
});

test('welfare auto-downshifts when allocations exceed available budget', () => {
  const resolveWelfare = InMediaResTestHooks.resolveWelfare;
  if (!resolveWelfare) {
    throw new Error('resolveWelfare helper not exposed');
  }
  const labor = 100;
  const desired = { education: 3, healthcare: 3, socialSupport: 3 };
  const available = 10; // deliberately insufficient
  const result = resolveWelfare(desired, labor, available);
  expect(result.downshifted).toBe(true);
  expect(result.cost).toBeLessThanOrEqual(available);
});
