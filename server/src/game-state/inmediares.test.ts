import { expect, test } from 'bun:test';
import { GameStateManager } from './manager';
import { InMediaResInitializer, __test as InMediaResTestHooks } from './inmediares';
import { validateCantonPartition } from './partition';
import { buildNationInputs } from '../test-utils/nations';
import { OM_COST_PER_SLOT } from '../budget/manager';
import { OPERATING_LP_COST } from '../logistics/manager';
import { ENERGY_PER_SLOT, PLANT_ATTRIBUTES } from '../energy/manager';
import { SuitabilityManager } from '../suitability/manager';
import { EconomyManager } from '../economy/manager';
import type { LaborPool, NationPreset, SectorType } from '../types';

const GRID_WIDTH = 5;
const GRID_HEIGHT = 5;

function buildGridAdjacency(width: number, height: number): {
  neighbors: Int32Array;
  offsets: Uint32Array;
} {
  const neighbors: number[] = [];
  const offsets = new Uint32Array(width * height + 1);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      offsets[index] = cursor;
      if (x > 0) {
        neighbors.push(index - 1);
        cursor += 1;
      }
      if (x < width - 1) {
        neighbors.push(index + 1);
        cursor += 1;
      }
      if (y > 0) {
        neighbors.push(index - width);
        cursor += 1;
      }
      if (y < height - 1) {
        neighbors.push(index + width);
        cursor += 1;
      }
    }
  }
  offsets[width * height] = cursor;
  return { neighbors: new Int32Array(neighbors), offsets };
}

const { neighbors: GRID_NEIGHBORS, offsets: GRID_OFFSETS } = buildGridAdjacency(
  GRID_WIDTH,
  GRID_HEIGHT,
);

const GRID_BIOMES = new Uint8Array([
  // Row 0 (coastal shallows)
  6, 6, 6, 6, 6,
  // Row 1
  0, 4, 1, 0, 4,
  // Row 2
  5, 0, 12, 4, 1,
  // Row 3
  3, 0, 5, 4, 0,
  // Row 4
  1, 3, 4, 0, 5,
]);

const DEFAULT_ASSIGNMENTS: number[][] = [
  [5, 6, 7, 10, 11, 12],
  [8, 9, 13, 14],
  [15, 16, 17, 18, 19, 20, 21, 22],
];

const CANTON_BANDS: Record<NationPreset, [number, number]> = {
  'Industrializing Exporter': [6, 9],
  'Agrarian Surplus': [6, 8],
  'Finance and Services Hub': [3, 4],
  'Research State': [4, 6],
  'Defense-Manufacturing Complex': [6, 8],
  'Balanced Mixed Economy': [4, 6],
};

function cloneTerritories(source: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(source).map(([id, cells]) => [id, [...cells]]));
}

function cellsAdjacent(
  a: number,
  b: number,
  neighbors: Int32Array,
  offsets: Uint32Array,
): boolean {
  const start = offsets[a];
  const end = offsets[a + 1];
  for (let idx = start; idx < end; idx++) {
    if (neighbors[idx] === b) {
      return true;
    }
  }
  return false;
}

function setupGame(
  presets: NationPreset[],
  seed = 'test-seed',
  options?: {
    assignments?: number[][];
    biomes?: Uint8Array;
    neighbors?: Int32Array;
    offsets?: Uint32Array;
  },
) {
  const players = presets.map((_, index) => `player${index + 1}`);
  const biomes = new Uint8Array(options?.biomes ?? GRID_BIOMES);
  const neighbors = (options?.neighbors ?? GRID_NEIGHBORS).slice();
  const offsets = (options?.offsets ?? GRID_OFFSETS).slice();
  const assignments = options?.assignments ?? DEFAULT_ASSIGNMENTS;

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
    const cells = [...(assignments[index] ?? [])].sort((a, b) => a - b);
    game.state.playerCells[playerId] = cells;
    for (const cell of cells) {
      game.state.cellOwnership[cell] = playerId;
    }
  });

  GameStateManager.initializeNationInfrastructure(
    game.state,
    players,
    biomes,
    neighbors,
    offsets,
  );

  const metas = InMediaResInitializer.initialize(
    game,
    nationInputs,
    biomes,
    neighbors,
    offsets,
    seed,
  );

  return { game, metas, nationInputs, players, neighbors, offsets, biomes };
}

test('higher-UL cantons receive larger manufacturing slot allocations', () => {
  const players = ['solo'];
  const biomes = new Uint8Array(GRID_BIOMES);
  const game = GameStateManager.createCompleteGame(
    'ul-game',
    'JOIN-ul',
    players,
    'small',
    biomes,
    players.length,
    [],
    'ul-seed',
  );

  const economy = game.state.economy;
  EconomyManager.addCanton(economy, 'cap');
  EconomyManager.addCanton(economy, 'cap-S1');
  economy.cantons.cap.urbanizationLevel = 7;
  economy.cantons['cap-S1'].urbanizationLevel = 3;
  economy.cantons.cap.suitability.manufacturing = 0;
  economy.cantons['cap-S1'].suitability.manufacturing = 0;

  const layouts = [
    {
      id: 'cap',
      capital: true,
      cells: [5],
      coastal: false,
      urbanizationLevel: 7,
      geography: { plains: 1 },
    },
    {
      id: 'cap-S1',
      capital: false,
      cells: [6],
      coastal: false,
      urbanizationLevel: 3,
      geography: { plains: 1 },
    },
  ];

  const allocations = InMediaResTestHooks.allocateSlots(
    12,
    layouts as any,
    economy,
    'manufacturing',
  );

  expect(allocations[0]).toBeGreaterThan(allocations[1]);
});

test('computeCantonGeography normalizes tile share weights', () => {
  const computeGeo = InMediaResTestHooks.computeCantonGeography;
  if (!computeGeo) throw new Error('computeCantonGeography hook not exposed');
  const biomes = new Uint8Array([0, 0, 4, 5]);
  const geography = computeGeo([0, 1, 2, 3], biomes);
  expect(geography.plains).toBeCloseTo(0.5, 3);
  expect(geography.hills).toBeCloseTo(0.25, 3);
  expect(geography.mountains).toBeCloseTo(0.25, 3);
});

test('suitability calculations apply geography weights, UL modifiers, rounding, and clamps', () => {
  const players = ['solo'];
  const biomes = new Uint8Array([0]);
  const game = GameStateManager.createCompleteGame(
    'suitability-game',
    'JOIN-suit',
    players,
    'small',
    biomes,
    players.length,
    [],
    'suit-seed',
  );
  const economy = game.state.economy;
  EconomyManager.addCanton(economy, 'A');
  const canton = economy.cantons.A;
  canton.geography = { plains: 0.5, hills: 0.5 } as any;
  canton.urbanizationLevel = 4;

  SuitabilityManager.setGeographyModifiers({
    agriculture: { plains: 20, hills: -10 },
  });
  SuitabilityManager.setUrbanizationModifiers({
    agriculture: { 4: 5 },
  });

  let results = SuitabilityManager.run(economy);
  expect(results.A.agriculture.percent).toBe(10);
  expect(results.A.agriculture.multiplier).toBeCloseTo(1.1);

  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: 120, hills: 120 } });
  SuitabilityManager.setUrbanizationModifiers({ agriculture: { 4: 60 } });
  results = SuitabilityManager.run(economy);
  expect(results.A.agriculture.percent).toBe(50);

  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: -200, hills: -200 } });
  SuitabilityManager.setUrbanizationModifiers({ agriculture: { 4: -80 } });
  results = SuitabilityManager.run(economy);
  expect(results.A.agriculture.percent).toBe(-60);

  SuitabilityManager.setGeographyModifiers(
    InMediaResTestHooks.DEFAULT_GEOGRAPHY_MODIFIERS,
  );
  SuitabilityManager.setUrbanizationModifiers(InMediaResTestHooks.DEFAULT_UL_MODIFIERS);
});

test('coastal detection identifies cantons adjacent to shallows', () => {
  const detectCoastal = InMediaResTestHooks.detectCoastal;
  if (!detectCoastal) throw new Error('detectCoastal hook not exposed');
  const coastal = detectCoastal([5, 6], GRID_BIOMES, GRID_NEIGHBORS, GRID_OFFSETS);
  expect(coastal).toBe(true);
  const inland = detectCoastal([20, 21], GRID_BIOMES, GRID_NEIGHBORS, GRID_OFFSETS);
  expect(inland).toBe(false);
});

test('national gateways default to the capital canton', () => {
  const presets: NationPreset[] = ['Finance and Services Hub'];
  const assignments = [[5, 6, 7, 10]];
  const { game, players } = setupGame(presets, 'gateways', { assignments });
  const playerId = players[0];
  const capital = String(game.state.playerCells[playerId][0]);

  const national = game.state.economy.infrastructure.national;
  expect(national.airport).toBe(capital);
  expect(national.rail).toBe(capital);
  expect(game.state.economy.infrastructure.airports[capital]).toBeDefined();
  expect(game.state.economy.infrastructure.railHubs[capital]).toBeDefined();
});

test('cantons initialize with numeric happiness values', () => {
  const presets: NationPreset[] = ['Industrializing Exporter', 'Balanced Mixed Economy'];
  const { game } = setupGame(presets, 'happiness');
  for (const canton of Object.values(game.state.economy.cantons)) {
    expect(Number.isFinite(canton.happiness)).toBe(true);
    expect(canton.happiness).toBeGreaterThan(0);
  }
});

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
    if (nation.finance.debt > 0) {
      expect(nation.finance.treasury).toBe(0);
    } else {
      expect(nation.finance.treasury).toBeGreaterThan(0);
    }

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
    expect(Math.abs(nation.energy.demand - energyDemand)).toBeLessThanOrEqual(20);

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
  expect(first.game.state.economy.cantonTerritories).toEqual(
    second.game.state.economy.cantonTerritories,
  );
  expect(first.game.state.economy.cantonAdjacency).toEqual(
    second.game.state.economy.cantonAdjacency,
  );
  expect(first.game.state.economy.infrastructure.ports).toEqual(
    second.game.state.economy.infrastructure.ports,
  );
  expect(first.game.state.cellCantons).toEqual(second.game.state.cellCantons);
});

test('different presets yield divergent nation signatures and coastal infrastructure', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Agrarian Surplus',
    'Research State',
  ];
  const { game, biomes, neighbors, offsets } = setupGame(presets, 'divergence');
  const nations = Object.values(game.state.nations);

  const signatures = new Set(nations.map(nation => nation.signature));
  expect(signatures.size).toBe(nations.length);

  for (const nation of nations) {
    const cantonIds = nation.cantonIds;
    expect(cantonIds.length).toBeGreaterThan(0);
    expect(
      cantonIds.every(
        id => game.state.economy.cantonOwners[id] === nation.id,
      ),
    ).toBe(true);
    const detectCoastal = InMediaResTestHooks.detectCoastal;
    if (!detectCoastal) throw new Error('detectCoastal hook not exposed');
    const coastalCantons = cantonIds.filter(id =>
      detectCoastal(
        game.state.economy.cantonTerritories[id],
        biomes,
        neighbors,
        offsets,
      ),
    );
    const portHosts = cantonIds.filter(
      id => Boolean(game.state.economy.infrastructure.ports[id]),
    );
    if (nation.coastal) {
      expect(coastalCantons.length).toBeGreaterThan(0);
      expect(portHosts.length).toBeGreaterThan(0);
    } else {
      expect(coastalCantons.length).toBe(0);
      expect(portHosts.length).toBe(0);
    }
  }
});

test('archetype canton counts fall within configured bands and coastal nations host ports', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Balanced Mixed Economy',
    'Finance and Services Hub',
  ];
  const { game, biomes, neighbors, offsets } = setupGame(presets, 'bands');
  const detectCoastal = InMediaResTestHooks.detectCoastal;
  if (!detectCoastal) throw new Error('detectCoastal hook not exposed');

  for (const nation of Object.values(game.state.nations)) {
    const band = CANTON_BANDS[nation.preset];
    const cantonIds = nation.cantonIds;
    expect(cantonIds.length).toBeGreaterThanOrEqual(band[0]);
    expect(cantonIds.length).toBeLessThanOrEqual(band[1]);
    const coastalCantons = cantonIds.filter(id =>
      detectCoastal(
        game.state.economy.cantonTerritories[id],
        biomes,
        neighbors,
        offsets,
      ),
    );
    const portHosts = cantonIds.filter(
      id => Boolean(game.state.economy.infrastructure.ports[id]),
    );
    if (nation.coastal) {
      expect(coastalCantons.length).toBeGreaterThan(0);
      expect(portHosts.length).toBeGreaterThan(0);
    } else {
      expect(coastalCantons.length).toBe(0);
      expect(portHosts.length).toBe(0);
    }
  }
});

test('nations with three or more cantons have connected adjacency graphs', () => {
  const presets: NationPreset[] = ['Industrializing Exporter'];
  const assignments = [[5, 6, 7, 8, 9, 10, 11, 12, 13, 14]];
  const { game, players } = setupGame(presets, 'adjacency', { assignments });
  const playerId = players[0];
  const nation = game.state.nations[playerId];
  const cantonIds = nation.cantonIds;
  expect(cantonIds.length).toBeGreaterThanOrEqual(3);
  const adjacency = game.state.economy.cantonAdjacency;
  const visited = new Set<string>();
  const stack = [cantonIds[0]];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const neighbor of adjacency[id] ?? []) {
      if (cantonIds.includes(neighbor)) {
        stack.push(neighbor);
      }
    }
  }
  expect(visited.size).toBe(cantonIds.length);
  const internalEdges = cantonIds.reduce((sum, id) => {
    const links = (adjacency[id] ?? []).filter(neighbor => cantonIds.includes(neighbor));
    return sum + links.length;
  }, 0);
  expect(internalEdges).toBeGreaterThanOrEqual(cantonIds.length - 1);
});

test('canton partitions cover each nation with no overlaps or holes', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Agrarian Surplus',
    'Finance and Services Hub',
  ];
  const { game, neighbors, offsets, biomes } = setupGame(presets, 'partition-valid');
  for (const nation of Object.values(game.state.nations)) {
    const result = validateCantonPartition({
      nationCells: [...game.state.playerCells[nation.id]],
      cantonIds: [...nation.cantonIds],
      cantonTerritories: game.state.economy.cantonTerritories,
      cellOwnership: game.state.cellOwnership,
      nationId: nation.id,
      neighbors,
      offsets,
      biomes,
      capitalCanton: nation.capitalCanton,
    });
    expect(result.missingCells).toHaveLength(0);
    expect(result.overlappingCells).toHaveLength(0);
    expect(result.outOfNationCells).toHaveLength(0);
    expect(result.disconnectedCantons).toHaveLength(0);
    expect(result.holedCantons).toHaveLength(0);
    expect(result.capitalOk).toBe(true);
    const coastalCantons = nation.cantonIds.filter(id => result.coastal[id]);
    if (nation.coastal) {
      expect(coastalCantons.length).toBeGreaterThan(0);
    } else {
      expect(coastalCantons.length).toBe(0);
    }
  }
});

test('partition validator flags coverage, overlap, contiguity, hole, and capital issues', () => {
  const presets: NationPreset[] = ['Industrializing Exporter', 'Research State'];
  const { game, neighbors, offsets, biomes, players } = setupGame(
    presets,
    'partition-flags',
  );
  const nation = game.state.nations[players[0]];
  const cantonIds = [...nation.cantonIds];
  expect(cantonIds.length).toBeGreaterThanOrEqual(2);

  const territories = cloneTerritories(game.state.economy.cantonTerritories);
  const baseArgs = {
    nationCells: [...game.state.playerCells[nation.id]],
    cantonIds,
    cellOwnership: game.state.cellOwnership,
    nationId: nation.id,
    neighbors,
    offsets,
    biomes,
  } as const;
  const nationSet = new Set(baseArgs.nationCells);

  const first = cantonIds[0];
  const second = cantonIds[1];
  const removed = territories[first].pop();
  if (removed === undefined) throw new Error('expected canton territory');
  let result = validateCantonPartition({
    ...baseArgs,
    cantonTerritories: territories,
    capitalCanton: nation.capitalCanton,
  });
  expect(result.missingCells).toContain(removed);

  const overlapTerritories = cloneTerritories(game.state.economy.cantonTerritories);
  overlapTerritories[second].push(removed);
  result = validateCantonPartition({
    ...baseArgs,
    cantonTerritories: overlapTerritories,
    capitalCanton: nation.capitalCanton,
  });
  expect(result.overlappingCells.some(entry => entry.cell === removed)).toBe(true);

  const disconnectedTerritories = cloneTerritories(game.state.economy.cantonTerritories);
  const anchor = disconnectedTerritories[first][0];
  let remote = disconnectedTerritories[first].find(
    cell => cell !== anchor && !cellsAdjacent(anchor, cell, neighbors, offsets),
  );
  if (remote === undefined) {
    for (const candidate of baseArgs.nationCells) {
      if (candidate !== anchor && !cellsAdjacent(anchor, candidate, neighbors, offsets)) {
        remote = candidate;
        break;
      }
    }
  }
  if (remote !== undefined) {
    disconnectedTerritories[first] = [anchor, remote];
    result = validateCantonPartition({
      ...baseArgs,
      cantonTerritories: disconnectedTerritories,
      capitalCanton: nation.capitalCanton,
    });
    expect(result.disconnectedCantons).toContain(first);
  }

  result = validateCantonPartition({
    ...baseArgs,
    cantonTerritories: cloneTerritories(game.state.economy.cantonTerritories),
    capitalCanton: 'non-existent',
  });
  expect(result.capitalOk).toBe(false);

  const holeOwnership: Record<number, string> = { 1: 'hole', 5: 'hole', 6: 'hole', 7: 'hole', 11: 'hole' };
  const holeResult = validateCantonPartition({
    nationCells: [1, 5, 6, 7, 11],
    cantonIds: ['A', 'B'],
    cantonTerritories: { A: [1, 5, 7, 11], B: [6] },
    cellOwnership: holeOwnership,
    nationId: 'hole',
    neighbors,
    offsets,
    biomes,
    capitalCanton: 'A',
  });
  expect(holeResult.holedCantons).toContain('A');
  expect(holeResult.capitalOk).toBe(true);
});

test('labor shortfalls only throttle sectors in affected cantons', () => {
  const players = ['labor'];
  const biomes = new Uint8Array(GRID_BIOMES);
  const game = GameStateManager.createCompleteGame(
    'labor-game',
    'JOIN-labor',
    players,
    'small',
    biomes,
    players.length,
    [],
    'labor-seed',
  );
  const economy = game.state.economy;
  EconomyManager.addCanton(economy, 'labor');
  const canton = economy.cantons.labor;
  canton.suitability.agriculture = 10;
  canton.suitability.manufacturing = 5;
  const sectorStates: Partial<
    Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>
  > = {
    agriculture: { capacity: 5, funded: 5, idle: 0 },
    manufacturing: { capacity: 2, funded: 2, idle: 0 },
  };
  const localMix = { agriculture: 5, manufacturing: 2 };
  const available: LaborPool = { general: 3, skilled: 2, specialist: 0 };
  const assignLabor = InMediaResTestHooks.assignLaborToCanton;
  if (!assignLabor) throw new Error('assignLaborToCanton hook not exposed');
  const assigned = assignLabor(canton, sectorStates, localMix, available);

  expect(assigned.general).toBe(3);
  expect(assigned.skilled).toBe(2);
  expect(sectorStates.agriculture.funded).toBe(3);
  expect(sectorStates.agriculture.idle).toBe(2);
  expect(sectorStates.manufacturing.funded).toBe(2);
  expect(sectorStates.manufacturing.idle).toBe(0);
  expect(canton.laborDemand.agriculture?.general).toBe(5);
  expect(canton.laborAssigned.agriculture?.general).toBe(3);
  expect(canton.laborDemand.manufacturing?.skilled).toBe(2);
  expect(canton.laborAssigned.manufacturing?.skilled).toBe(2);
});

test('nation happiness equals the average of constituent canton happiness values', () => {
  const presets: NationPreset[] = [
    'Industrializing Exporter',
    'Finance and Services Hub',
    'Defense-Manufacturing Complex',
  ];
  const { game } = setupGame(presets, 'happiness-rollup');
  for (const nation of Object.values(game.state.nations)) {
    const cantonIds = nation.cantonIds;
    const average =
      cantonIds.reduce((sum, id) => sum + game.state.economy.cantons[id].happiness, 0) /
      cantonIds.length;
    expect(nation.labor.happiness).toBeCloseTo(average, 4);
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
