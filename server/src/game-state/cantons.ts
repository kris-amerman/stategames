import type {
  CantonDefinition,
  CantonPartitionsState,
  CantonValidationSnapshot,
  CellId,
  NationCreationInput,
  PlayerId,
  TileType,
} from '../types';
import { SeededRandom } from '../utils/random';

interface MeshTopology {
  neighbors: Int32Array;
  offsets: Uint32Array;
  cellCenters: Float64Array;
}

interface PartitionInput {
  nationId: PlayerId;
  preset: NationCreationInput['preset'];
  cells: CellId[];
  capital: CellId;
}

interface PartitionOptions {
  mesh: MeshTopology;
  biomes: Uint8Array;
  deepOceanBiome: number;
  minArea: number;
  seed: string | null;
}

const PRESET_CANTON_RANGES: Record<NationCreationInput['preset'], [number, number]> = {
  'Finance and Services Hub': [3, 4],
  'Research State': [4, 6],
  'Balanced Mixed Economy': [4, 6],
  'Industrializing Exporter': [6, 10],
  'Defense-Manufacturing Complex': [6, 10],
  'Agrarian Surplus': [6, 10],
};

const BASE_PLAYER_COLORS = [
  '#ff5f56',
  '#4f9eff',
  '#5acf67',
  '#ffb347',
  '#ae73ff',
  '#2fd4d4',
  '#f968a1',
  '#8bc34a',
];

const TILE_FROM_BIOME: Record<number, TileType | null> = {
  0: 'plains',
  1: 'woods',
  2: 'rainforest',
  3: 'wetlands',
  4: 'hills',
  5: 'mountains',
  6: 'shallows',
  7: null,
  8: 'tundra',
  9: 'tundra',
  10: 'tundra',
  11: 'tundra',
  12: 'desert',
  13: 'desert',
  14: 'desert',
};

const FOUR_PI = Math.PI * 4;

function chooseCount(area: number, preset: NationCreationInput['preset'], rng: SeededRandom, minArea: number): number {
  const [minRange, maxRange] = PRESET_CANTON_RANGES[preset] ?? [3, 5];
  const feasibleMax = Math.max(1, Math.min(maxRange, Math.floor(area / Math.max(1, minArea))));
  const feasibleMin = Math.min(feasibleMax, Math.max(1, minRange));
  const options: number[] = [];
  for (let n = feasibleMin; n <= feasibleMax; n++) {
    const target = area / n;
    if (target >= minArea * 0.9) {
      options.push(n);
    }
  }
  if (options.length === 0) {
    return Math.max(1, feasibleMax);
  }
  const index = options.length === 1 ? 0 : rng.nextInt(options.length);
  return options[index];
}

function pickInitialSeeds(cells: CellId[], capital: CellId, count: number, topology: MeshTopology, rng: SeededRandom): CellId[] {
  const owned = new Set(cells);
  const seeds: CellId[] = [capital];
  while (seeds.length < count) {
    const distance = new Map<CellId, number>();
    const queue: CellId[] = [];
    const visited = new Set<CellId>();
    for (const seed of seeds) {
      queue.push(seed);
      distance.set(seed, 0);
      visited.add(seed);
    }
    while (queue.length) {
      const cell = queue.shift()!;
      const start = topology.offsets[cell];
      const end = topology.offsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = topology.neighbors[i];
        if (nb < 0 || !owned.has(nb)) continue;
        if (!visited.has(nb)) {
          visited.add(nb);
          distance.set(nb, (distance.get(cell) ?? 0) + 1);
          queue.push(nb);
        }
      }
    }
    let farthest: CellId | null = null;
    let farDist = -1;
    for (const cell of cells) {
      const dist = distance.get(cell) ?? Infinity;
      if (dist > farDist && dist !== Infinity) {
        farDist = dist;
        farthest = cell;
      }
    }
    if (farthest === null) {
      const remaining = cells.filter(c => !seeds.includes(c));
      if (remaining.length === 0) break;
      farthest = remaining[rng.nextInt(remaining.length)];
    }
    seeds.push(farthest);
  }
  return seeds;
}

function assignCantons(
  cells: CellId[],
  seeds: CellId[],
  topology: MeshTopology,
): Map<CellId, number> {
  const owned = new Set(cells);
  const assignment = new Map<CellId, number>();
  const queues: CellId[][] = seeds.map(seed => [seed]);
  const target = cells.length / seeds.length;
  const counts = new Array(seeds.length).fill(0);

  seeds.forEach((seed, index) => {
    assignment.set(seed, index);
    counts[index] = 1;
  });

  const unassigned = new Set<CellId>(cells.filter(cell => !assignment.has(cell)));

  const nextCandidate = (index: number): CellId | null => {
    const queue = queues[index];
    while (queue.length) {
      const cell = queue.shift()!;
      if (assignment.has(cell)) continue;
      return cell;
    }
    return null;
  };

  const pushFrontier = (index: number, cell: CellId) => {
    const start = topology.offsets[cell];
    const end = topology.offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = topology.neighbors[i];
      if (nb < 0 || !owned.has(nb)) continue;
      if (!assignment.has(nb)) {
        queues[index].push(nb);
      }
    }
  };

  for (const seed of seeds) {
    const idx = assignment.get(seed)!;
    pushFrontier(idx, seed);
  }

  while (unassigned.size > 0) {
    let bestIndex = -1;
    let bestScore = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const queueHasCells = queues[i].some(cell => !assignment.has(cell));
      if (!queueHasCells) continue;
      const score = counts[i] / target;
      if (score < bestScore - 1e-6) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      const remaining = Array.from(unassigned);
      const cell = remaining[0];
      let smallest = 0;
      let minCount = counts[0];
      for (let i = 1; i < counts.length; i++) {
        if (counts[i] < minCount) {
          minCount = counts[i];
          smallest = i;
        }
      }
      assignment.set(cell, smallest);
      counts[smallest] += 1;
      unassigned.delete(cell);
      pushFrontier(smallest, cell);
      continue;
    }

    const candidate = nextCandidate(bestIndex);
    if (candidate === null) {
      queues[bestIndex] = [];
      continue;
    }
    assignment.set(candidate, bestIndex);
    counts[bestIndex] += 1;
    unassigned.delete(candidate);
    pushFrontier(bestIndex, candidate);
  }

  return assignment;
}

function computePerimeter(
  cantonCells: Set<CellId>,
  topology: MeshTopology,
  deepOceanBiome: number,
  biomes: Uint8Array,
): number {
  let perimeter = 0;
  for (const cell of cantonCells) {
    const start = topology.offsets[cell];
    const end = topology.offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = topology.neighbors[i];
      if (nb < 0) {
        perimeter += 1;
        continue;
      }
      if (!cantonCells.has(nb)) {
        if (biomes[nb] === deepOceanBiome) {
          perimeter += 1;
        } else {
          perimeter += 1;
        }
      }
    }
  }
  return perimeter;
}

function computeGeography(
  cells: CellId[],
  topology: MeshTopology,
  biomes: Uint8Array,
  deepOceanBiome: number,
): { mix: Record<TileType, number>; coastal: boolean } {
  const counts: Record<TileType, number> = {} as any;
  let coastal = false;
  for (const cell of cells) {
    const biome = biomes[cell];
    const tile = TILE_FROM_BIOME[biome] ?? 'plains';
    if (tile) {
      counts[tile] = (counts[tile] ?? 0) + 1;
    }
    const start = topology.offsets[cell];
    const end = topology.offsets[cell + 1];
    let touchesCoast = false;
    for (let i = start; i < end; i++) {
      const nb = topology.neighbors[i];
      if (nb < 0) continue;
      const nbBiome = biomes[nb];
      if (nbBiome === deepOceanBiome || nbBiome === 6) {
        touchesCoast = true;
        coastal = true;
      }
    }
    if (touchesCoast) {
      counts.coast = (counts.coast ?? 0) + 1;
    }
  }
  const mix: Record<TileType, number> = {} as any;
  const total = cells.length;
  if (total > 0) {
    for (const [tile, count] of Object.entries(counts)) {
      mix[tile as TileType] = count / total;
    }
  }
  return { mix, coastal };
}

function computeCentroid(cells: CellId[], topology: MeshTopology): { x: number; y: number } {
  if (cells.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    sumX += topology.cellCenters[cell * 2];
    sumY += topology.cellCenters[cell * 2 + 1];
  }
  return { x: sumX / cells.length, y: sumY / cells.length };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToHex({ h, s, l }: { h: number; s: number; l: number }): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => {
    const v = Math.round(x * 255);
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generatePalette(baseHex: string, count: number): string[] {
  const base = hexToHsl(baseHex);
  const shades: string[] = [];
  const step = count > 1 ? 0.6 / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    const offset = -0.3 + step * i;
    const l = Math.min(0.82, Math.max(0.25, base.l + offset));
    const s = Math.min(0.9, Math.max(0.35, base.s * (0.9 + i * 0.05)));
    shades.push(hslToHex({ h: base.h, s, l }));
  }
  return shades;
}

function collectNeighbors(
  cantonCells: Set<CellId>,
  topology: MeshTopology,
  assignments: Map<CellId, string>,
): string[] {
  const neighbors = new Set<string>();
  for (const cell of cantonCells) {
    const start = topology.offsets[cell];
    const end = topology.offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = topology.neighbors[i];
      if (nb < 0) continue;
      const owner = assignments.get(nb);
      if (owner && !cantonCells.has(nb)) {
        neighbors.add(owner);
      }
    }
  }
  return Array.from(neighbors.values()).sort();
}

function validateCantons(partitions: CantonDefinition[], cellAssignments: Map<CellId, string>, topology: MeshTopology): CantonValidationSnapshot {
  const issues: string[] = [];
  const byId = new Map<string, Set<CellId>>();
  for (const canton of partitions) {
    byId.set(canton.id, new Set(canton.cells));
  }
  const seen = new Map<CellId, string>();
  for (const [cell, cantonId] of cellAssignments) {
    const existing = seen.get(cell);
    if (existing && existing !== cantonId) {
      issues.push(`Cell ${cell} assigned to ${cantonId} and ${existing}`);
    } else {
      seen.set(cell, cantonId);
    }
  }
  // Contiguity check per canton
  for (const canton of partitions) {
    const cells = byId.get(canton.id)!;
    if (cells.size === 0) continue;
    const visited = new Set<CellId>();
    const queue: CellId[] = [canton.cells[0]];
    visited.add(canton.cells[0]);
    while (queue.length) {
      const cell = queue.shift()!;
      const start = topology.offsets[cell];
      const end = topology.offsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = topology.neighbors[i];
        if (nb < 0) continue;
        if (!cells.has(nb)) continue;
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (visited.size !== cells.size) {
      issues.push(`Canton ${canton.id} is not contiguous`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export interface CantonInitializationResult {
  partitions: CantonDefinition[];
  shades: Record<PlayerId, string[]>;
  cellToCanton: Map<CellId, string>;
  validation: CantonValidationSnapshot;
}

export function initializeCantons(
  inputs: PartitionInput[],
  options: PartitionOptions,
): CantonInitializationResult {
  const rng = new SeededRandom(options.seed ?? null);
  const assignments = new Map<CellId, string>();
  const partitions: CantonDefinition[] = [];
  const shades: Record<PlayerId, string[]> = {};

  for (const nation of inputs) {
    if (nation.cells.length === 0) continue;
    const count = chooseCount(nation.cells.length, nation.preset, rng, options.minArea);
    const seeds = pickInitialSeeds(nation.cells, nation.capital, count, options.mesh, rng);
    const idxAssignment = assignCantons(nation.cells, seeds, options.mesh);
    const baseColor = BASE_PLAYER_COLORS[Math.abs(hashString(nation.nationId)) % BASE_PLAYER_COLORS.length];
    const palette = generatePalette(baseColor, count);
    shades[nation.nationId] = palette;

    const local: CantonDefinition[] = [];
    for (let i = 0; i < count; i++) {
      const cantonCells = nation.cells.filter(cell => idxAssignment.get(cell) === i);
      const cellSet = new Set<CellId>(cantonCells);
      const perimeter = computePerimeter(cellSet, options.mesh, options.deepOceanBiome, options.biomes);
      const { mix, coastal } = computeGeography(cantonCells, options.mesh, options.biomes, options.deepOceanBiome);
      const centroid = computeCentroid(cantonCells, options.mesh);
      const compactness = cantonCells.length > 0 ? (perimeter * perimeter) / (FOUR_PI * cantonCells.length) : 0;
      const cantonId = `${nation.nationId}:${i + 1}`;
      for (const cell of cantonCells) {
        assignments.set(cell, cantonId);
      }
      local.push({
        id: cantonId,
        nationId: nation.nationId,
        index: i + 1,
        capital: cantonCells.includes(nation.capital),
        coastal,
        cells: cantonCells,
        area: cantonCells.length,
        perimeter,
        compactness,
        geography: mix,
        neighbors: [],
        centroid,
        shadeIndex: i,
      });
    }
    partitions.push(...local);
  }

  const idLookup = new Map<string, CantonDefinition>();
  for (const canton of partitions) {
    idLookup.set(canton.id, canton);
  }
  for (const canton of partitions) {
    const cellSet = new Set<CellId>(canton.cells);
    const neighborIds = collectNeighbors(cellSet, options.mesh, assignments);
    canton.neighbors = neighborIds;
  }

  const validation = validateCantons(partitions, assignments, options.mesh);

  return {
    partitions,
    shades,
    cellToCanton: assignments,
    validation,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function buildPartitionsState(
  result: CantonInitializationResult,
  cellCount: number,
): CantonPartitionsState {
  const cellToCantonArray = new Int32Array(cellCount).fill(-1);
  const orderedIds = result.partitions.map(partition => partition.id);
  const idToIndex = new Map<string, number>();
  orderedIds.forEach((id, index) => idToIndex.set(id, index));
  for (const [cell, cantonId] of result.cellToCanton.entries()) {
    const index = idToIndex.get(cantonId);
    if (index !== undefined) {
      cellToCantonArray[cell] = index;
    }
  }
  const byId: Record<string, CantonDefinition> = {};
  const byNation: Record<PlayerId, string[]> = {};
  for (const canton of result.partitions) {
    byId[canton.id] = canton;
    if (!byNation[canton.nationId]) {
      byNation[canton.nationId] = [];
    }
    byNation[canton.nationId].push(canton.id);
    byNation[canton.nationId].sort((a, b) => {
      const ia = byId[a].index;
      const ib = byId[b].index;
      return ia - ib;
    });
  }
  return {
    byId,
    byNation,
    cellToCanton: cellToCantonArray,
    shades: result.shades,
    validation: result.validation,
    orderedIds,
  };
}
