import { EconomyManager } from '../economy';
import type {
  CantonTerritoryMeta,
  CellId,
  GameState,
  NationPreset,
  PlayerId,
  TileType,
} from '../types';

interface BandConfig {
  min: number;
  max: number;
  targetArea: number;
}

const MIN_CANTON_AREA = 30;

const BIOME_TILE_MAP: Record<number, TileType> = {
  0: 'plains',
  1: 'woods',
  2: 'rainforest',
  3: 'wetlands',
  4: 'hills',
  5: 'mountains',
  6: 'shallows',
  7: 'coast',
  8: 'tundra',
  9: 'tundra',
  10: 'tundra',
  11: 'tundra',
  12: 'desert',
  13: 'desert',
  14: 'desert',
};

function bandForPreset(preset: NationPreset): BandConfig {
  switch (preset) {
    case 'Finance and Services Hub':
      return { min: 3, max: 4, targetArea: 85 };
    case 'Research State':
    case 'Balanced Mixed Economy':
      return { min: 4, max: 6, targetArea: 75 };
    case 'Industrializing Exporter':
    case 'Defense-Manufacturing Complex':
    case 'Agrarian Surplus':
    default:
      return { min: 6, max: 10, targetArea: 65 };
  }
}

function determineCantonCount(total: number, preset: NationPreset): number {
  const band = bandForPreset(preset);
  if (total <= MIN_CANTON_AREA) {
    return 1;
  }
  const maxByArea = Math.max(1, Math.floor(total / MIN_CANTON_AREA));
  let desired = Math.round(total / band.targetArea);
  desired = Math.max(band.min, Math.min(band.max, desired));
  desired = Math.min(desired, maxByArea);
  desired = Math.max(1, Math.min(desired, total));
  if (desired < band.min && maxByArea >= band.min) {
    desired = band.min;
  }
  if (desired === 1 && total >= MIN_CANTON_AREA * 2) {
    desired = Math.min(Math.max(2, band.min), Math.min(band.max, maxByArea));
  }
  return desired;
}

function distanceSq(aX: number, aY: number, bX: number, bY: number): number {
  const dx = aX - bX;
  const dy = aY - bY;
  return dx * dx + dy * dy;
}

function selectSeeds(
  cells: CellId[],
  coords: Float64Array,
  k: number,
  capital: CellId,
  coastalCells: CellId[],
): CellId[] {
  if (k <= 1) return [capital];
  const seeds: CellId[] = [capital];
  const used = new Set<CellId>(seeds);
  const cellCoords = (id: CellId) => [coords[2 * id], coords[2 * id + 1]] as const;

  const chooseFarthest = (candidates: CellId[]): CellId | null => {
    let best: CellId | null = null;
    let bestDist = -1;
    for (const cell of candidates) {
      if (used.has(cell)) continue;
      const [cx, cy] = cellCoords(cell);
      let minDist = Infinity;
      for (const seed of seeds) {
        const [sx, sy] = cellCoords(seed);
        const dist = distanceSq(cx, cy, sx, sy);
        if (dist < minDist) {
          minDist = dist;
        }
      }
      if (minDist > bestDist + 1e-6 || (Math.abs(minDist - bestDist) <= 1e-6 && (best === null || cell < best))) {
        bestDist = minDist;
        best = cell;
      }
    }
    return best;
  };

  if (coastalCells.length) {
    const coastSeed = chooseFarthest(coastalCells);
    if (coastSeed !== null) {
      seeds.push(coastSeed);
      used.add(coastSeed);
    }
  }

  while (seeds.length < k) {
    const next = chooseFarthest(cells);
    if (next === null) break;
    seeds.push(next);
    used.add(next);
  }

  while (seeds.length < k) {
    for (const cell of cells) {
      if (!used.has(cell)) {
        seeds.push(cell);
        used.add(cell);
      }
      if (seeds.length === k) break;
    }
  }

  return seeds.slice(0, k);
}

function buildAdjacency(
  owned: Set<CellId>,
  neighbors: Int32Array,
  offsets: Uint32Array,
): Map<CellId, CellId[]> {
  const map = new Map<CellId, CellId[]>();
  for (const cell of owned) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    const list: CellId[] = [];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      if (nb >= 0 && owned.has(nb)) {
        list.push(nb);
      }
    }
    map.set(cell, list);
  }
  return map;
}

function computeTargetSizes(total: number, k: number): number[] {
  const base = Math.floor(total / k);
  const remainder = total % k;
  const targets = new Array(k).fill(base);
  for (let i = 0; i < remainder; i++) {
    targets[i] += 1;
  }
  return targets;
}

function partitionWithBalancedGrowth(
  seeds: CellId[],
  adjacency: Map<CellId, CellId[]>,
  targets: number[],
): Map<CellId, number> {
  const assignment = new Map<CellId, number>();
  const k = seeds.length;
  const queues: CellId[][] = Array.from({ length: k }, () => []);
  const queueSets: Array<Set<CellId>> = Array.from({ length: k }, () => new Set());
  const sizes = new Array(k).fill(0);

  const pushNeighbor = (idx: number, cell: CellId) => {
    if (assignment.has(cell)) return;
    const set = queueSets[idx];
    if (set.has(cell)) return;
    set.add(cell);
    queues[idx].push(cell);
  };

  const popNeighbor = (idx: number): CellId | undefined => {
    const queue = queues[idx];
    const set = queueSets[idx];
    while (queue.length) {
      const cell = queue.shift()!;
      if (assignment.has(cell)) {
        set.delete(cell);
        continue;
      }
      set.delete(cell);
      return cell;
    }
    return undefined;
  };

  seeds.forEach((seed, idx) => {
    assignment.set(seed, idx);
    sizes[idx] = 1;
    const neighbors = adjacency.get(seed) || [];
    for (const nb of neighbors) {
      pushNeighbor(idx, nb);
    }
  });

  let assigned = assignment.size;
  const total = adjacency.size;

  const selectCanton = (allowOver: boolean): { idx: number; cell: CellId } | null => {
    let bestIdx = -1;
    let bestRatio = Infinity;
    for (let idx = 0; idx < k; idx++) {
      if (!allowOver && sizes[idx] >= targets[idx]) continue;
      if (queues[idx].length === 0) continue;
      const ratio = sizes[idx] / targets[idx];
      if (ratio < bestRatio - 1e-9 || (Math.abs(ratio - bestRatio) <= 1e-9 && idx < bestIdx)) {
        bestIdx = idx;
        bestRatio = ratio;
      }
    }
    if (bestIdx === -1) {
      if (allowOver) return null;
      return selectCanton(true);
    }
    let cell = popNeighbor(bestIdx);
    while (cell === undefined) {
      if (queues[bestIdx].length === 0) {
        if (allowOver) return selectCanton(true);
        return selectCanton(allowOver);
      }
      cell = popNeighbor(bestIdx);
    }
    return { idx: bestIdx, cell };
  };

  while (assigned < total) {
    const selection = selectCanton(false) ?? selectCanton(true);
    if (!selection) break;
    const { idx, cell } = selection;
    if (assignment.has(cell)) continue;
    assignment.set(cell, idx);
    sizes[idx] += 1;
    assigned += 1;
    const neighbors = adjacency.get(cell) || [];
    for (const nb of neighbors) {
      pushNeighbor(idx, nb);
    }
  }

  return assignment;
}

function computeTileShares(
  cells: CellId[],
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
): { shares: Record<TileType, number>; coastal: boolean; perimeter: number } {
  const counts = new Map<TileType, number>();
  let coastal = false;
  let perimeter = 0;
  const owned = new Set(cells);
  for (const cell of cells) {
    const biome = biomes[cell];
    const tile = BIOME_TILE_MAP[biome] ?? 'plains';
    counts.set(tile, (counts.get(tile) ?? 0) + 1);
    const start = offsets[cell];
    const end = offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      if (nb < 0 || !owned.has(nb)) {
        perimeter += 1;
      }
      if (nb >= 0) {
        const nbBiome = biomes[nb];
        if (nbBiome === 6 || nbBiome === 7) {
          coastal = true;
        }
      }
    }
  }
  const total = cells.length || 1;
  const shares: Record<TileType, number> = {} as any;
  for (const [tile, count] of counts.entries()) {
    shares[tile] = count / total;
  }
  return { shares, coastal, perimeter };
}

function computeCentroid(cells: CellId[], centers: Float64Array): { x: number; y: number } {
  if (cells.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    sumX += centers[2 * cell];
    sumY += centers[2 * cell + 1];
  }
  const inv = 1 / cells.length;
  return { x: sumX * inv, y: sumY * inv };
}

export function initializeCantons(
  gameState: GameState,
  presetMap: Record<PlayerId, NationPreset>,
  neighbors: Int32Array,
  offsets: Uint32Array,
  centers: Float64Array,
  biomes: Uint8Array,
  _seed: string | number | null,
): void {
  for (const [playerId, cells] of Object.entries(gameState.playerCells)) {
    if (!cells || cells.length === 0) {
      gameState.nationCantons[playerId] = [];
      continue;
    }
    const capital = cells[0];
    gameState.playerCapitals[playerId] = capital;
    const preset = presetMap[playerId] ?? 'Balanced Mixed Economy';
    const totalCells = cells.length;
    let cantonCount = determineCantonCount(totalCells, preset);
    cantonCount = Math.min(cantonCount, totalCells);
    if (cantonCount <= 0) cantonCount = 1;

    const owned = new Set<CellId>(cells);
    const adjacency = buildAdjacency(owned, neighbors, offsets);
    const coastalCells: CellId[] = [];
    for (const cell of cells) {
      const start = offsets[cell];
      const end = offsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = neighbors[i];
        if (nb >= 0) {
          const biome = biomes[nb];
          if (biome === 6 || biome === 7) {
            coastalCells.push(cell);
            break;
          }
        }
      }
    }

    const seeds = selectSeeds(cells.slice(), centers, cantonCount, capital, coastalCells);
    const targets = computeTargetSizes(totalCells, cantonCount);
    const assignment = partitionWithBalancedGrowth(seeds, adjacency, targets);

    const cantonCells: CellId[][] = Array.from({ length: cantonCount }, () => []);
    for (const [cell, idx] of assignment.entries()) {
      cantonCells[idx].push(cell);
    }

    const cantonIds: string[] = [];
    gameState.nationCantons[playerId] = cantonIds;

    for (let idx = 0; idx < cantonCount; idx++) {
      const cellsForCanton = cantonCells[idx];
      if (cellsForCanton.length === 0) continue;
      const cantonId = idx === 0 ? String(capital) : `${capital}-${idx}`;
      cantonIds.push(cantonId);
      if (!gameState.economy.cantons[cantonId]) {
        EconomyManager.addCanton(gameState.economy, cantonId);
      }
      gameState.cantonCells[cantonId] = cellsForCanton.slice().sort((a, b) => a - b);
      for (const cell of cellsForCanton) {
        gameState.cellCantons[cell] = cantonId;
      }
      const { shares, coastal, perimeter } = computeTileShares(cellsForCanton, biomes, neighbors, offsets);
      const centroid = computeCentroid(cellsForCanton, centers);
      const meta: CantonTerritoryMeta = {
        owner: playerId,
        capital: cellsForCanton.includes(capital),
        coastal,
        area: cellsForCanton.length,
        centroid,
        perimeter,
        tileShares: shares,
      };
      gameState.cantonMeta[cantonId] = meta;
      const canton = gameState.economy.cantons[cantonId];
      canton.geography = shares;
    }

    // Ensure capital canton exists even if partition collapsed.
    if (!gameState.cellCantons[capital]) {
      const cantonId = String(capital);
      if (!gameState.economy.cantons[cantonId]) {
        EconomyManager.addCanton(gameState.economy, cantonId);
      }
      gameState.cellCantons[capital] = cantonId;
      gameState.cantonCells[cantonId] = [capital];
      gameState.nationCantons[playerId] = [cantonId];
      gameState.cantonMeta[cantonId] = {
        owner: playerId,
        capital: true,
        coastal: coastalCells.includes(capital),
        area: 1,
        centroid: { x: centers[2 * capital], y: centers[2 * capital + 1] },
        perimeter: 0,
        tileShares: { plains: 1 },
      };
    }
  }
}
