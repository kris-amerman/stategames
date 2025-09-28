import {
  type Game,
  type PlayerId,
  type SectorType,
  type NationCreationInput,
  type NationState,
  type NationPreset,
  type NationMeta,
  type PlantRegistryEntry,
  type ResourceType,
  type TileType,
  type LaborPool,
  type CantonEconomy,
  type GeographyModifiers,
  type UrbanizationModifiers,
} from '../types';
import { EconomyManager } from '../economy';
import { OM_COST_PER_SLOT } from '../budget/manager';
import { LP_PER_SLOT, OPERATING_LP_COST } from '../logistics/manager';
import {
  ENERGY_PER_SLOT,
  PLANT_ATTRIBUTES,
  type PlantType,
} from '../energy/manager';
import {
  EDUCATION_TIERS,
  HEALTHCARE_TIERS,
  SOCIAL_SUPPORT_COST,
} from '../welfare/manager';
import { SECTOR_LABOR_TYPES } from '../labor/manager';
import { LABOR_BY_UL, SECTOR_SLOTS_BY_UL } from '../development/manager';
import { DEBT_STRESS_TIERS } from '../finance/manager';
import { SeededRandom } from '../utils/random';
import { createEmptyStatusSummary, updateNationStatus } from '../status';
import { SuitabilityManager } from '../suitability';

interface StockpileBands {
  food: [number, number];
  fuel: [number, number];
  materials: [number, number];
  fx: [number, number];
  luxury: [number, number];
  ordnance: [number, number];
  production: [number, number];
}

interface NationProfile {
  baseMix: Partial<Record<SectorType, number>>;
  welfare: { education: number; healthcare: number; socialSupport: number };
  projectSectors: SectorType[];
  plantOptions: PlantType[];
  fuelResource: ResourceType;
  stockpiles: StockpileBands;
  stableRevenueMultiplier: number;
  creditLimitMultiplier: number;
  militaryFocus: number;
  nonUniformityTag: string;
}

const IDLE_TAX_RATE = 0.25;
const MIN_LOGISTICS_SLOTS = 2;
const REVENUE_WEIGHTS: Partial<Record<SectorType, number>> = {
  agriculture: 2.5,
  extraction: 3.2,
  manufacturing: 5.0,
  defense: 4.6,
  luxury: 3.4,
  finance: 6.0,
  research: 4.2,
  logistics: 2.1,
};

type CantonRange = [number, number];

interface LayoutConfig {
  cantonRange: CantonRange;
  capitalUL: CantonRange;
  satelliteUL: CantonRange;
}

const PRESET_LAYOUT: Record<NationPreset, LayoutConfig> = {
  'Industrializing Exporter': {
    cantonRange: [6, 9],
    capitalUL: [6, 7],
    satelliteUL: [3, 5],
  },
  'Agrarian Surplus': {
    cantonRange: [6, 8],
    capitalUL: [5, 6],
    satelliteUL: [2, 4],
  },
  'Finance and Services Hub': {
    cantonRange: [3, 4],
    capitalUL: [7, 8],
    satelliteUL: [4, 6],
  },
  'Research State': {
    cantonRange: [4, 6],
    capitalUL: [6, 7],
    satelliteUL: [3, 5],
  },
  'Defense-Manufacturing Complex': {
    cantonRange: [6, 8],
    capitalUL: [6, 7],
    satelliteUL: [3, 5],
  },
  'Balanced Mixed Economy': {
    cantonRange: [4, 6],
    capitalUL: [6, 7],
    satelliteUL: [3, 5],
  },
};

const BIOME_TO_TILE: Record<number, TileType> = {
  0: 'plains',
  1: 'woods',
  2: 'rainforest',
  3: 'wetlands',
  4: 'hills',
  5: 'mountains',
  6: 'shallows',
  7: 'shallows',
  8: 'tundra',
  9: 'tundra',
  10: 'tundra',
  11: 'tundra',
  12: 'desert',
  13: 'desert',
  14: 'desert',
};

const DEFAULT_GEOGRAPHY_MODIFIERS: GeographyModifiers = {
  agriculture: {
    plains: 30,
    woods: 12,
    wetlands: 18,
    rainforest: 8,
    hills: -12,
    mountains: -30,
    desert: -26,
    tundra: -22,
  },
  extraction: {
    mountains: 35,
    hills: 20,
    desert: 10,
    plains: -6,
    wetlands: -18,
    woods: -8,
  },
  manufacturing: {
    plains: 20,
    hills: 12,
    woods: -5,
    mountains: -24,
    desert: -18,
    tundra: -10,
  },
  defense: {
    mountains: 28,
    hills: 14,
    tundra: 10,
    plains: 2,
    wetlands: -16,
    desert: -8,
  },
  luxury: {
    rainforest: 25,
    woods: 12,
    wetlands: 14,
    plains: 4,
    hills: -4,
    desert: -12,
    tundra: -6,
  },
  finance: {
    plains: 22,
    hills: 8,
    woods: 6,
    mountains: -18,
    desert: -20,
    tundra: -12,
  },
  research: {
    mountains: 22,
    hills: 16,
    plains: 12,
    woods: 4,
    tundra: 6,
    desert: -10,
  },
  logistics: {
    plains: 22,
    hills: 6,
    shallows: 12,
    wetlands: -14,
    mountains: -28,
    desert: -8,
    tundra: -12,
  },
};

const UL_LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);

const DEFAULT_UL_MODIFIERS: UrbanizationModifiers = {
  agriculture: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, 14 - ul * 2]),
  ),
  manufacturing: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -12 + ul * 4]),
  ),
  extraction: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -6 + ul * 2]),
  ),
  defense: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -8 + ul * 3]),
  ),
  luxury: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -4 + ul * 3]),
  ),
  finance: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -10 + ul * 4]),
  ),
  research: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -8 + ul * 4]),
  ),
  logistics: Object.fromEntries(
    UL_LEVELS.map((ul) => [ul, -6 + ul * 3]),
  ),
};

let suitabilityDefaultsApplied = false;

function ensureSuitabilityDefaults(): void {
  if (suitabilityDefaultsApplied) return;
  SuitabilityManager.setGeographyModifiers(DEFAULT_GEOGRAPHY_MODIFIERS);
  SuitabilityManager.setUrbanizationModifiers(DEFAULT_UL_MODIFIERS);
  suitabilityDefaultsApplied = true;
}

interface CantonLayout {
  id: string;
  capital: boolean;
  cells: number[];
  coastal: boolean;
  urbanizationLevel: number;
  geography: Record<TileType, number>;
}

interface NationLayout {
  playerId: PlayerId;
  preset: NationPreset;
  cantons: CantonLayout[];
}

function pickInRange(range: CantonRange, rng: SeededRandom): number {
  const [min, max] = range;
  if (max <= min) return min;
  const span = max - min + 1;
  return min + rng.nextInt(span);
}

function chooseCantonCount(
  preset: NationPreset,
  cellCount: number,
  rng: SeededRandom,
): number {
  const layout = PRESET_LAYOUT[preset];
  const [min, max] = layout.cantonRange;
  if (cellCount <= 1) return 1;
  const upper = Math.min(max, cellCount);
  let desired = pickInRange([min, upper], rng);
  if (desired > cellCount) desired = cellCount;
  if (cellCount >= 3) {
    desired = Math.max(desired, 3);
  }
  desired = Math.max(1, Math.min(desired, upper));
  if (desired < min && cellCount >= min) desired = min;
  return desired;
}

function buildCellAdjacency(
  cells: number[],
  neighbors: Int32Array,
  offsets: Uint32Array,
): Map<number, number[]> {
  const owned = new Set(cells);
  const map = new Map<number, number[]>();
  for (const cell of cells) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    const list: number[] = [];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      if (nb < 0) continue;
      if (owned.has(nb)) list.push(nb);
    }
    map.set(cell, list);
  }
  return map;
}

function computeDistancesFromSeeds(
  adjacency: Map<number, number[]>,
  seeds: number[],
): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const seed of seeds) {
    if (dist.has(seed)) continue;
    dist.set(seed, 0);
    queue.push(seed);
  }
  while (queue.length) {
    const cell = queue.shift()!;
    const neighbors = adjacency.get(cell) ?? [];
    for (const nb of neighbors) {
      if (dist.has(nb)) continue;
      dist.set(nb, (dist.get(cell) ?? 0) + 1);
      queue.push(nb);
    }
  }
  return dist;
}

function assignCantons(
  cells: number[],
  count: number,
  capital: number,
  adjacency: Map<number, number[]>,
  rng: SeededRandom,
): Map<number, number> {
  const seeds: number[] = [capital];
  const remaining = cells.filter((c) => c !== capital);
  for (let i = 1; i < count; i++) {
    const dist = computeDistancesFromSeeds(adjacency, seeds);
    let bestCell: number | null = null;
    let bestDist = -1;
    for (const cell of remaining) {
      if (seeds.includes(cell)) continue;
      const d = dist.get(cell);
      if (d === undefined) continue;
      if (d > bestDist) {
        bestDist = d;
        bestCell = cell;
      } else if (d === bestDist && bestCell !== null && cell < bestCell) {
        bestCell = cell;
      }
    }
    if (bestCell === null) {
      const candidates = remaining.filter((c) => !seeds.includes(c));
      if (candidates.length === 0) break;
      bestCell = candidates.sort((a, b) => a - b)[0];
    }
    seeds.push(bestCell);
  }

  const assignment = new Map<number, number>();
  const queue: number[] = [];
  seeds.forEach((cell, index) => {
    assignment.set(cell, index);
    queue.push(cell);
  });

  while (queue.length) {
    const cell = queue.shift()!;
    const owner = assignment.get(cell)!;
    for (const nb of adjacency.get(cell) ?? []) {
      if (assignment.has(nb)) continue;
      assignment.set(nb, owner);
      queue.push(nb);
    }
  }

  // Assign any remaining cells to the capital canton deterministically
  for (const cell of cells) {
    if (!assignment.has(cell)) {
      assignment.set(cell, 0);
    }
  }
  return assignment;
}

function computeCantonGeography(cells: number[], biomes: Uint8Array): Record<TileType, number> {
  const counts = new Map<TileType, number>();
  for (const cell of cells) {
    const biome = biomes[cell];
    const tile = BIOME_TO_TILE[biome] ?? 'plains';
    counts.set(tile, (counts.get(tile) ?? 0) + 1);
  }
  const total = cells.length || 1;
  const geography: Record<TileType, number> = {} as any;
  for (const [tile, count] of counts.entries()) {
    geography[tile] = Math.round((count / total) * 1000) / 1000;
  }
  return geography;
}

function detectCoastal(
  cells: number[],
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
): boolean {
  for (const cell of cells) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      if (nb < 0) continue;
      const biome = biomes[nb];
      if (biome === 6 || biome === 7) return true;
    }
  }
  return false;
}

function buildNationLayout(
  game: Game,
  playerId: PlayerId,
  preset: NationPreset,
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
  rng: SeededRandom,
): NationLayout {
  const cells = [...(game.state.playerCells[playerId] ?? [])];
  cells.sort((a, b) => a - b);
  const economy = game.state.economy;
  const capital = cells[0];
  if (capital === undefined) {
    return { playerId, preset, cantons: [] };
  }
  const layout = PRESET_LAYOUT[preset];
  const cantonCount = chooseCantonCount(preset, cells.length, rng);
  const adjacency = buildCellAdjacency(cells, neighbors, offsets);
  const assignment = assignCantons(cells, cantonCount, capital, adjacency, rng);
  const cantonCells: Map<number, number[]> = new Map();
  for (const cell of cells) {
    const idx = assignment.get(cell) ?? 0;
    const list = cantonCells.get(idx) ?? [];
    list.push(cell);
    cantonCells.set(idx, list);
  }
  const cantonLayouts: CantonLayout[] = [];
  const adjacencyById: Record<string, Set<string>> = {};

  const capitalRange = layout.capitalUL;
  const satelliteRange = layout.satelliteUL;
  let capitalUL = pickInRange(capitalRange, rng);
  const satelliteULs: number[] = [];

  for (const [index, cellsList] of cantonCells.entries()) {
    cellsList.sort((a, b) => a - b);
    const isCapital = assignment.get(capital) === index;
    const cantonId = isCapital
      ? String(capital)
      : `${capital}-S${index}`;
    if (!economy.cantons[cantonId]) {
      EconomyManager.addCanton(economy, cantonId, playerId);
    }
    const canton = economy.cantons[cantonId];
    economy.cantonOwners[cantonId] = playerId;
    const geo = computeCantonGeography(cellsList, biomes);
    const coastal = detectCoastal(cellsList, biomes, neighbors, offsets);
    let ul = isCapital ? capitalUL : pickInRange(satelliteRange, rng);
    if (!isCapital) satelliteULs.push(ul);

    canton.urbanizationLevel = ul;
    canton.nextUrbanizationLevel = ul;
    canton.development = Math.min(3, rng.nextInt(4));
    canton.geography = geo;
    canton.territory = [...cellsList];
    economy.cantonTerritories[cantonId] = [...cellsList];
    const neighborSet = new Set<string>();
    for (const cell of cellsList) {
      for (const nb of adjacency.get(cell) ?? []) {
        const otherIdx = assignment.get(nb);
        if (otherIdx === undefined || otherIdx === index) continue;
        const otherId = otherIdx === assignment.get(capital)
          ? String(capital)
          : `${capital}-S${otherIdx}`;
        neighborSet.add(otherId);
      }
    }
    canton.neighbors = [...neighborSet].sort();
    economy.cantonAdjacency[cantonId] = [...canton.neighbors];
    cantonLayouts.push({
      id: cantonId,
      capital: isCapital,
      cells: cellsList,
      coastal,
      urbanizationLevel: ul,
      geography: geo,
    });
    adjacencyById[cantonId] = neighborSet;
  }

  // Ensure capital exceeds at least one satellite UL
  if (satelliteULs.length > 0) {
    const minSatellite = Math.min(...satelliteULs);
    if (capitalUL <= minSatellite) {
      if (capitalUL < capitalRange[1]) {
        capitalUL += 1;
      } else {
        const idx = satelliteULs.indexOf(minSatellite);
        if (idx >= 0) {
          satelliteULs[idx] = Math.max(1, satelliteULs[idx] - 1);
        }
      }
      for (const layout of cantonLayouts) {
        if (layout.capital) {
          layout.urbanizationLevel = capitalUL;
          const canton = economy.cantons[layout.id];
          canton.urbanizationLevel = capitalUL;
          canton.nextUrbanizationLevel = capitalUL;
        }
      }
    }
  }

  // Update satellites with any UL adjustments
  let satIndex = 0;
  for (const layout of cantonLayouts) {
    if (layout.capital) continue;
    const ul = satelliteULs[satIndex] ?? layout.urbanizationLevel;
    layout.urbanizationLevel = ul;
    const canton = economy.cantons[layout.id];
    canton.urbanizationLevel = ul;
    canton.nextUrbanizationLevel = ul;
    satIndex += 1;
  }

  // Normalize adjacency arrays after adjustments
  for (const layout of cantonLayouts) {
    const set = adjacencyById[layout.id] ?? new Set();
    const arr = [...set].sort();
    economy.cantonAdjacency[layout.id] = arr;
    economy.cantons[layout.id].neighbors = arr;
  }

  return { playerId, preset, cantons: cantonLayouts };
}

function computeSectorWeight(
  layout: CantonLayout,
  canton: CantonEconomy,
  sector: SectorType,
): number {
  const suitability = canton.suitability[sector] ?? 0;
  let weight = Math.max(0.15, 1 + suitability / 100);
  weight *= 1 + canton.urbanizationLevel / 14;
  if (sector === 'logistics') {
    if (layout.coastal) weight *= 1.2;
    if (canton.neighbors.length >= 2) weight *= 1.05;
  }
  if (sector === 'finance' || sector === 'research' || sector === 'luxury') {
    weight *= 1 + Math.max(0, canton.urbanizationLevel - 5) * 0.05;
  }
  if (sector === 'agriculture') {
    weight *= 1 + (layout.geography.plains ?? 0) * 0.3;
  }
  if (sector === 'extraction') {
    const rugged = (layout.geography.mountains ?? 0) + (layout.geography.hills ?? 0);
    weight *= 1 + rugged * 0.4;
  }
  if (sector === 'logistics' && layout.coastal) {
    weight *= 1.05 + (layout.geography.shallows ?? 0) * 0.1;
  }
  return weight;
}

function allocateSlots(
  target: number,
  layouts: CantonLayout[],
  economy: EconomyState,
  sector: SectorType,
): number[] {
  const weights = layouts.map((layout) =>
    computeSectorWeight(layout, economy.cantons[layout.id], sector),
  );
  const allocations = new Array(layouts.length).fill(0);
  if (target <= 0) return allocations;
  let totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    totalWeight = layouts.length;
    for (let i = 0; i < layouts.length; i++) weights[i] = 1;
  }
  const fractional: Array<{ index: number; frac: number; id: string }> = [];
  let remaining = target;
  for (let i = 0; i < layouts.length; i++) {
    const raw = (weights[i] / totalWeight) * target;
    const base = Math.floor(raw);
    allocations[i] = base;
    remaining -= base;
    fractional.push({ index: i, frac: raw - base, id: layouts[i].id });
  }
  fractional.sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return a.id.localeCompare(b.id);
  });
  let cursor = 0;
  while (remaining > 0 && fractional.length > 0) {
    const entry = fractional[cursor % fractional.length];
    allocations[entry.index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  return allocations;
}

function assignLaborToCanton(
  canton: CantonEconomy,
  sectorStates: Partial<
    Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>
  >,
  localMix: Record<string, number>,
  available: LaborPool,
): LaborPool {
  const remaining: LaborPool = { ...available };
  const assigned: LaborPool = { general: 0, skilled: 0, specialist: 0 };
  canton.laborDemand = {};
  canton.laborAssigned = {};
  const laborSectors = Object.entries(localMix)
    .filter(([, funded]) => (funded ?? 0) > 0)
    .map(([sectorKey, funded]) => [sectorKey as SectorType, funded ?? 0] as [SectorType, number])
    .sort((a, b) => {
      const sa = canton.suitability[a[0]] ?? 0;
      const sb = canton.suitability[b[0]] ?? 0;
      if (sa !== sb) return sb - sa;
      return a[0].localeCompare(b[0]);
    });

  for (const [sector, funded] of laborSectors) {
    const laborType = SECTOR_LABOR_TYPES[sector];
    if (!laborType) continue;
    const demandPool: LaborPool = { general: 0, skilled: 0, specialist: 0 };
    demandPool[laborType] = funded;
    canton.laborDemand[sector] = { ...demandPool };
    const give = Math.min(remaining[laborType], demandPool[laborType]);
    const assignedPool: LaborPool = { general: 0, skilled: 0, specialist: 0 };
    assignedPool[laborType] = give;
    canton.laborAssigned[sector] = assignedPool;
    remaining[laborType] -= give;
    assigned[laborType] += give;
    if (give < demandPool[laborType]) {
      const shortage = demandPool[laborType] - give;
      const state = sectorStates[sector];
      if (state) {
        state.idle += shortage;
        state.funded = give;
      }
    }
  }

  return assigned;
}

const PROFILES: Record<NationPreset, NationProfile> = {
  'Industrializing Exporter': {
    baseMix: {
      agriculture: 4,
      extraction: 7,
      manufacturing: 8,
      defense: 2,
      finance: 2,
      logistics: 3,
      luxury: 2,
    },
    welfare: { education: 2, healthcare: 2, socialSupport: 1 },
    projectSectors: ['manufacturing', 'logistics', 'energy'],
    plantOptions: ['coal', 'gas'],
    fuelResource: 'coal',
    stockpiles: {
      food: [2.5, 3.5],
      fuel: [2.5, 3.0],
      materials: [2.6, 3.2],
      fx: [2.8, 3.4],
      luxury: [1.2, 1.5],
      ordnance: [2.0, 2.6],
      production: [2.6, 3.2],
    },
    stableRevenueMultiplier: 1.18,
    creditLimitMultiplier: 4.3,
    militaryFocus: 1.15,
    nonUniformityTag: 'exporter',
  },
  'Agrarian Surplus': {
    baseMix: {
      agriculture: 8,
      extraction: 3,
      manufacturing: 4,
      finance: 2,
      logistics: 3,
      luxury: 2,
      research: 2,
    },
    welfare: { education: 1, healthcare: 1, socialSupport: 1 },
    projectSectors: ['agriculture', 'logistics'],
    plantOptions: ['hydro', 'wind', 'gas'],
    fuelResource: 'oil',
    stockpiles: {
      food: [4.0, 5.0],
      fuel: [2.0, 2.4],
      materials: [2.0, 2.6],
      fx: [2.2, 3.0],
      luxury: [1.1, 1.3],
      ordnance: [1.8, 2.2],
      production: [2.0, 2.4],
    },
    stableRevenueMultiplier: 0.95,
    creditLimitMultiplier: 3.6,
    militaryFocus: 0.85,
    nonUniformityTag: 'agrarian',
  },
  'Finance and Services Hub': {
    baseMix: {
      agriculture: 3,
      manufacturing: 3,
      finance: 8,
      logistics: 3,
      luxury: 3,
      research: 3,
      extraction: 2,
    },
    welfare: { education: 3, healthcare: 2, socialSupport: 1 },
    projectSectors: ['finance', 'logistics', 'research'],
    plantOptions: ['gas', 'wind', 'solar'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.4, 3.2],
      fuel: [2.0, 2.4],
      materials: [2.0, 2.6],
      fx: [3.5, 4.0],
      luxury: [1.3, 1.6],
      ordnance: [1.5, 2.0],
      production: [2.0, 2.4],
    },
    stableRevenueMultiplier: 1.45,
    creditLimitMultiplier: 4.6,
    militaryFocus: 0.8,
    nonUniformityTag: 'finance',
  },
  'Research State': {
    baseMix: {
      agriculture: 4,
      manufacturing: 4,
      finance: 3,
      logistics: 3,
      luxury: 3,
      research: 8,
      extraction: 3,
    },
    welfare: { education: 3, healthcare: 3, socialSupport: 1 },
    projectSectors: ['research', 'energy'],
    plantOptions: ['nuclear', 'wind', 'solar'],
    fuelResource: 'uranium',
    stockpiles: {
      food: [3.0, 4.0],
      fuel: [2.0, 2.4],
      materials: [2.3, 3.0],
      fx: [2.6, 3.4],
      luxury: [1.2, 1.5],
      ordnance: [1.6, 2.0],
      production: [2.0, 2.6],
    },
    stableRevenueMultiplier: 1.32,
    creditLimitMultiplier: 4.2,
    militaryFocus: 0.9,
    nonUniformityTag: 'research',
  },
  'Defense-Manufacturing Complex': {
    baseMix: {
      agriculture: 4,
      extraction: 6,
      manufacturing: 7,
      defense: 6,
      finance: 2,
      logistics: 4,
      luxury: 1,
    },
    welfare: { education: 1, healthcare: 1, socialSupport: 0 },
    projectSectors: ['defense', 'manufacturing', 'energy'],
    plantOptions: ['coal', 'gas', 'oilPeaker'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.2, 3.0],
      fuel: [2.4, 3.0],
      materials: [2.5, 3.1],
      fx: [2.0, 2.8],
      luxury: [1.0, 1.2],
      ordnance: [2.6, 3.4],
      production: [2.6, 3.2],
    },
    stableRevenueMultiplier: 1.15,
    creditLimitMultiplier: 4.1,
    militaryFocus: 1.5,
    nonUniformityTag: 'defense',
  },
  'Balanced Mixed Economy': {
    baseMix: {
      agriculture: 5,
      extraction: 5,
      manufacturing: 5,
      defense: 3,
      finance: 3,
      research: 3,
      logistics: 3,
      luxury: 3,
    },
    welfare: { education: 2, healthcare: 2, socialSupport: 1 },
    projectSectors: ['manufacturing', 'research', 'logistics'],
    plantOptions: ['gas', 'wind', 'hydro'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.6, 3.4],
      fuel: [2.2, 2.8],
      materials: [2.3, 2.9],
      fx: [2.4, 3.2],
      luxury: [1.2, 1.4],
      ordnance: [2.0, 2.6],
      production: [2.3, 2.9],
    },
    stableRevenueMultiplier: 1.24,
    creditLimitMultiplier: 4.3,
    militaryFocus: 1.05,
    nonUniformityTag: 'balanced',
  },
};

function computeLogisticsDemand(mix: Record<string, number>): number {
  let demand = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'logistics') continue;
    const cost = OPERATING_LP_COST[sector as SectorType] ?? 0;
    demand += (funded || 0) * cost;
  }
  return demand;
}

function scaleMixToLogistics(
  mix: Record<string, number>,
  logisticSlots: number,
): { demand: number; supply: number; slots: number } {
  let demand = computeLogisticsDemand(mix);
  let slots = Math.max(logisticSlots, MIN_LOGISTICS_SLOTS);
  if (demand <= 0) {
    demand = slots * LP_PER_SLOT;
  }
  const targetSupply = slots * LP_PER_SLOT;
  const scale = targetSupply / demand;
  if (scale > 1.05 || scale < 0.95) {
    for (const key of Object.keys(mix)) {
      if (key === 'logistics') continue;
      const current = mix[key];
      const adjusted = Math.max(1, Math.round(current * scale));
      mix[key] = adjusted;
    }
    demand = computeLogisticsDemand(mix);
  }
  let supply = slots * LP_PER_SLOT;
  if (demand > supply * 0.95) {
    while (demand > supply * 1.05) {
      slots += 1;
      supply = slots * LP_PER_SLOT;
      if (slots > 20) break;
    }
  } else {
    while (supply / demand > 1.5 && slots > MIN_LOGISTICS_SLOTS) {
      slots -= 1;
      supply = slots * LP_PER_SLOT;
      if (supply / demand <= 1.5) break;
    }
  }
  return { demand, supply, slots };
}
function computeEnergyDemand(mix: Record<string, number>): number {
  let demand = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'energy') continue;
    const cost = ENERGY_PER_SLOT[sector as SectorType] ?? 0;
    demand += (funded || 0) * cost;
  }
  return demand;
}

function choosePlants(
  profile: NationProfile,
  canton: string,
  demand: number,
  rng: SeededRandom,
): { plants: PlantRegistryEntry[]; supply: number; fuel: Partial<Record<ResourceType, number>> } {
  const entries: PlantRegistryEntry[] = [];
  const fuel: Partial<Record<ResourceType, number>> = {};
  if (demand <= 0) {
    return { plants: entries, supply: 0, fuel };
  }
  const types = [...profile.plantOptions];
  types.sort((a, b) => PLANT_ATTRIBUTES[b].baseOutput - PLANT_ATTRIBUTES[a].baseOutput);
  let remaining = demand;
  while (remaining > 0) {
    const type = rng.pick(types);
    const attrs = PLANT_ATTRIBUTES[type];
    entries.push({ canton, type, status: 'active' });
    if (attrs.fuelType) {
      fuel[attrs.fuelType] = (fuel[attrs.fuelType] ?? 0) + attrs.baseOutput;
    }
    remaining -= attrs.baseOutput;
    if (entries.length > 12) break;
  }
  let supply = entries.reduce((sum, plant) => sum + PLANT_ATTRIBUTES[plant.type].baseOutput, 0);
  if (supply < demand * 0.95) {
    const type = types[0];
    const attrs = PLANT_ATTRIBUTES[type];
    entries.push({ canton, type, status: 'active' });
    if (attrs.fuelType) {
      fuel[attrs.fuelType] = (fuel[attrs.fuelType] ?? 0) + attrs.baseOutput;
    }
    supply += attrs.baseOutput;
  }
  return { plants: entries, supply, fuel };
}

function computeStableRevenue(
  mix: Record<string, number>,
  multiplier: number,
  rng: SeededRandom,
): number {
  let base = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'logistics') continue;
    const weight = REVENUE_WEIGHTS[sector as SectorType] ?? 1.8;
    base += funded * weight;
  }
  const variation = 0.9 + rng.nextRange(0, 0.2);
  return Math.round(base * multiplier * variation);
}

function computeLaborMix(
  mix: Record<string, number>,
): { demand: Record<string, number>; total: number } {
  const demand: Record<string, number> = { general: 0, skilled: 0, specialist: 0 };
  for (const [sector, funded] of Object.entries(mix)) {
    const type = SECTOR_LABOR_TYPES[sector as SectorType];
    if (!type) continue;
    demand[type] += funded;
  }
  const total = demand.general + demand.skilled + demand.specialist;
  return { demand, total };
}

function computeWelfareCost(
  tiers: { education: number; healthcare: number; socialSupport: number },
  labor: number,
): number {
  const edu = EDUCATION_TIERS[tiers.education].cost * labor;
  const health = HEALTHCARE_TIERS[tiers.healthcare].cost * labor;
  const social = SOCIAL_SUPPORT_COST[tiers.socialSupport] * labor;
  return edu + health + social;
}

function resolveWelfare(
  desired: { education: number; healthcare: number; socialSupport: number },
  labor: number,
  available: number,
): { tiers: { education: number; healthcare: number; socialSupport: number }; cost: number; downshifted: boolean } {
  const tiers = { ...desired };
  let cost = computeWelfareCost(tiers, labor);
  let downshifted = false;
  const order: (keyof typeof tiers)[] = ['socialSupport', 'healthcare', 'education'];
  while (cost > available && (tiers.education > 0 || tiers.healthcare > 0 || tiers.socialSupport > 0)) {
    let adjusted = false;
    for (const key of order) {
      if (tiers[key] > 0) {
        tiers[key] -= 1;
        adjusted = true;
        break;
      }
    }
    if (!adjusted) break;
    cost = computeWelfareCost(tiers, labor);
    downshifted = true;
  }
  if (cost > available) {
    return { tiers: { education: 0, healthcare: 0, socialSupport: 0 }, cost: 0, downshifted: true };
  }
  return { tiers, cost, downshifted };
}
function cloneSectorStates(
  sectors: Partial<Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>>,
): Partial<Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>> {
  const clone: typeof sectors = {};
  for (const [key, value] of Object.entries(sectors)) {
    clone[key as SectorType] = value ? { ...value } : undefined;
  }
  return clone;
}

export class InMediaResInitializer {
  static initialize(
    game: Game,
    inputs: NationCreationInput[],
    biomes: Uint8Array,
    neighbors: Int32Array,
    offsets: Uint32Array,
    seed?: string | number,
  ): NationMeta[] {
    const players = Object.keys(game.state.playerCells);
    if (inputs.length !== players.length) {
      throw new Error('Nation configuration does not match player count');
    }

    const rng = new SeededRandom(seed ?? game.meta.seed ?? null);
    const economy = game.state.economy;

    // Reset aggregate economy pools before seeding nations.
    economy.resources = {
      gold: 0,
      fx: 0,
      food: 0,
      materials: 0,
      production: 0,
      ordnance: 0,
      luxury: 0,
      energy: 0,
      uranium: 0,
      coal: 0,
      oil: 0,
      rareEarths: 0,
      research: 0,
      logistics: 0,
      labor: 0,
    };
    economy.energy.plants = [];
    economy.energy.state = { supply: 0, demand: 0, ratio: 1 };
    economy.energy.demandBySector = {};
    economy.energy.brownouts = [];
    economy.energy.fuelUsed = {};
    economy.energy.oAndMSpent = 0;
    economy.projects.projects = [];
    economy.projects.nextId = 1;
    economy.finance.debt = 0;
    economy.finance.creditLimit = 0;
    economy.finance.defaulted = false;
    economy.finance.debtStress = [];
    economy.finance.summary = {
      revenues: 0,
      expenditures: 0,
      netBorrowing: 0,
      interest: 0,
      defaulted: false,
    };

    const aggregate = {
      gold: 0,
      food: 0,
      materials: 0,
      fx: 0,
      luxury: 0,
      ordnance: 0,
      production: 0,
      uranium: 0,
      coal: 0,
      oil: 0,
      energySupply: 0,
      energyDemand: 0,
      logisticsSupply: 0,
      logisticsDemand: 0,
      revenues: 0,
      expenditures: 0,
      interest: 0,
      debt: 0,
      creditLimit: 0,
      plants: [] as PlantRegistryEntry[],
      fuelUsed: {} as Partial<Record<ResourceType, number>>,
      oAndM: 0,
      demandBySector: {} as Partial<Record<SectorType, number>>,
      projectId: 1,
    };

    ensureSuitabilityDefaults();
    const layoutsByPlayer: Record<PlayerId, NationLayout> = {};
    players.forEach((playerId, index) => {
      const input = inputs[index];
      layoutsByPlayer[playerId] = buildNationLayout(
        game,
        playerId,
        input.preset,
        biomes,
        neighbors,
        offsets,
        rng,
      );
    });

    SuitabilityManager.run(economy);

    const nationStates: Record<PlayerId, NationState> = {};
    const metas: NationMeta[] = [];

    players.forEach((playerId, index) => {
      const input = inputs[index];
      const profile = PROFILES[input.preset];
      if (!profile) {
        throw new Error(`Unknown preset for nation ${input.name}`);
      }

      const layout = layoutsByPlayer[playerId];
      if (!layout || layout.cantons.length === 0) {
        return;
      }

      const capitalLayout = layout.cantons.find((c) => c.capital) ?? layout.cantons[0];
      const capitalId = capitalLayout.id;
      const nationCoastal = layout.cantons.some((c) => c.coastal);

      const coastalCantons = layout.cantons.filter((c) => c.coastal);
      if (coastalCantons.length > 0) {
        const portHostLayout = coastalCantons.find((c) => c.capital) ?? coastalCantons[0];
        economy.infrastructure.ports[portHostLayout.id] = {
          owner: 'national',
          status: 'active',
          national: true,
          hp: 100,
        };
        economy.infrastructure.national.port = portHostLayout.id;
      }

      const sectorTargets: Record<SectorType, number> = {} as any;
      for (const [sectorKey, baseValue] of Object.entries(profile.baseMix)) {
        const sector = sectorKey as SectorType;
        const variation = 0.9 + rng.nextRange(0, 0.2);
        sectorTargets[sector] = Math.max(1, Math.round(baseValue * variation));
      }
      if (sectorTargets.logistics === undefined) {
        sectorTargets.logistics = layout.cantons.length * MIN_LOGISTICS_SLOTS;
      } else {
        sectorTargets.logistics = Math.max(
          sectorTargets.logistics,
          layout.cantons.length * MIN_LOGISTICS_SLOTS,
        );
      }

      const perCantonMix: Record<string, Record<SectorType, number>> = {};
      for (const cantonLayout of layout.cantons) {
        perCantonMix[cantonLayout.id] = {} as Record<SectorType, number>;
      }

      for (const [sectorKey, target] of Object.entries(sectorTargets)) {
        if (sectorKey === 'logistics') continue;
        const sector = sectorKey as SectorType;
        const allocations = allocateSlots(target, layout.cantons, economy, sector);
        layout.cantons.forEach((c, idx) => {
          perCantonMix[c.id][sector] = allocations[idx] ?? 0;
        });
      }

      const logisticDemandByCanton: Record<string, number> = {};
      for (const cantonLayout of layout.cantons) {
        let demand = 0;
        for (const [sectorKey, funded] of Object.entries(perCantonMix[cantonLayout.id])) {
          if (sectorKey === 'logistics') continue;
          const cost = OPERATING_LP_COST[sectorKey as SectorType] ?? 0;
          demand += funded * cost;
        }
        logisticDemandByCanton[cantonLayout.id] = demand;
      }

      const logisticTarget =
        sectorTargets.logistics ?? layout.cantons.length * MIN_LOGISTICS_SLOTS;
      const logisticAllocations = allocateSlots(logisticTarget, layout.cantons, economy, 'logistics');
      layout.cantons.forEach((c, idx) => {
        const required = Math.max(
          1,
          Math.ceil((logisticDemandByCanton[c.id] ?? 0) / LP_PER_SLOT),
        );
        const assigned = Math.max(required, logisticAllocations[idx] ?? 0, MIN_LOGISTICS_SLOTS);
        perCantonMix[c.id].logistics = assigned;
      });

      const mixTotals: Record<string, number> = {};
      for (const cantonLayout of layout.cantons) {
        for (const [sectorKey, funded] of Object.entries(perCantonMix[cantonLayout.id])) {
          mixTotals[sectorKey] = (mixTotals[sectorKey] ?? 0) + funded;
        }
      }

      const plantsForNation: PlantRegistryEntry[] = [];
      const fuelUsedForNation: Partial<Record<ResourceType, number>> = {};
      let fuelPerTurnTotal = 0;
      let energyDemandTotal = 0;
      let energySupplyTotal = 0;
      let logisticsDemandTotal = 0;
      let logisticsSupplyTotal = 0;
      let omCostTotal = 0;
      let idleCostTotal = 0;
      const laborAvailableTotal: LaborPool = { general: 0, skilled: 0, specialist: 0 };
      const laborAssignedTotal: LaborPool = { general: 0, skilled: 0, specialist: 0 };
      let laborConsumptionFood = 0;
      let laborConsumptionLuxury = 0;
      let happinessAccumulator = 0;
      let laiAccumulator = 0;
      const sectorStatesByCanton: Record<
        string,
        Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>
      > = {};

      for (const cantonLayout of layout.cantons) {
        const econCanton = economy.cantons[cantonLayout.id];
        const localMix = perCantonMix[cantonLayout.id];
        const sectorStates: Record<
          SectorType,
          { capacity: number; funded: number; idle: number; utilization?: number }
        > = {} as any;
        let localOmCost = 0;
        let localIdleCost = 0;

        for (const [sectorKey, fundedValue] of Object.entries(localMix)) {
          const sector = sectorKey as SectorType;
          const funded = fundedValue ?? 0;
          const idle = sector === 'logistics' ? 0 : funded > 0 && rng.nextBoolean() ? 1 : 0;
          const capacity = funded + idle;
          sectorStates[sector] = { capacity, funded, idle, utilization: funded };
          const costPer = OM_COST_PER_SLOT[sector] ?? 1;
          localOmCost += funded * costPer;
          localIdleCost += idle * costPer * IDLE_TAX_RATE;
          if (sector !== 'logistics' && (ENERGY_PER_SLOT[sector] ?? 0)) {
            aggregate.demandBySector[sector] =
              (aggregate.demandBySector[sector] ?? 0) + funded * (ENERGY_PER_SLOT[sector] ?? 0);
          }
        }

        const logisticDemand = logisticDemandByCanton[cantonLayout.id] ?? 0;
        const logisticSupply = (localMix.logistics ?? 0) * LP_PER_SLOT;
        econCanton.logisticsDelivery = logisticSupply;
        logisticsDemandTotal += logisticDemand;
        logisticsSupplyTotal += logisticSupply;

        let localEnergyDemand = 0;
        for (const [sectorKey, funded] of Object.entries(localMix)) {
          if (sectorKey === 'logistics') continue;
          const cost = ENERGY_PER_SLOT[sectorKey as SectorType] ?? 0;
          localEnergyDemand += funded * cost;
        }
        const plantPlan = choosePlants(profile, cantonLayout.id, localEnergyDemand, rng);
        const energyOM = plantPlan.plants.reduce(
          (sum, plant) => sum + (PLANT_ATTRIBUTES[plant.type].oAndMCost ?? 0),
          0,
        );
        localOmCost += energyOM;
        aggregate.oAndM += energyOM;
        const fuelPerTurn = Object.values(plantPlan.fuel).reduce(
          (sum, value) => sum + (value ?? 0),
          0,
        );
        fuelPerTurnTotal += fuelPerTurn;
        for (const [resource, amount] of Object.entries(plantPlan.fuel)) {
          fuelUsedForNation[resource as ResourceType] =
            (fuelUsedForNation[resource as ResourceType] ?? 0) + (amount ?? 0);
        }
        plantsForNation.push(...plantPlan.plants.map((plant) => ({ ...plant })));
        energyDemandTotal += localEnergyDemand;
        energySupplyTotal += plantPlan.supply;
        econCanton.energyDelivery = plantPlan.supply;

        const baseLabor = LABOR_BY_UL[econCanton.urbanizationLevel] ?? {
          general: 0,
          skilled: 0,
          specialist: 0,
        };
        econCanton.labor = { ...baseLabor };
        const assignedLabor = assignLaborToCanton(
          econCanton,
          sectorStates,
          localMix,
          baseLabor,
        );

        const totalAssigned =
          assignedLabor.general + assignedLabor.skilled + assignedLabor.specialist;
        laborAvailableTotal.general += baseLabor.general;
        laborAvailableTotal.skilled += baseLabor.skilled;
        laborAvailableTotal.specialist += baseLabor.specialist;
        laborAssignedTotal.general += assignedLabor.general;
        laborAssignedTotal.skilled += assignedLabor.skilled;
        laborAssignedTotal.specialist += assignedLabor.specialist;
        laborConsumptionFood += totalAssigned;
        laborConsumptionLuxury += totalAssigned;

        econCanton.lai = 0.95 + rng.nextRange(0, 0.08);
        laiAccumulator += econCanton.lai;

        econCanton.consumption = {
          foodRequired: totalAssigned,
          foodProvided: totalAssigned,
          luxuryRequired: totalAssigned,
          luxuryProvided: totalAssigned,
        };
        econCanton.shortages = { food: false, luxury: false };

        const energyRatioLocal =
          localEnergyDemand > 0 ? Math.min(plantPlan.supply / localEnergyDemand, 1) : 1;
        const logisticsRatioLocal =
          logisticDemand > 0 ? Math.min(logisticSupply / logisticDemand, 1) : 1;
        const happinessBase = 0.55 + rng.nextRange(-0.05, 0.05);
        const energyBonus = energyRatioLocal >= 0.98 ? 0.12 : -0.08;
        const logisticsBonus = logisticsRatioLocal >= 0.98 ? 0.08 : -0.06;
        econCanton.happiness = Math.max(
          0.3,
          Math.min(1.2, happinessBase + energyBonus + logisticsBonus + 0.2),
        );
        happinessAccumulator += econCanton.happiness;

        econCanton.sectors = sectorStates;
        sectorStatesByCanton[cantonLayout.id] = sectorStates;

        omCostTotal += localOmCost;
        idleCostTotal += localIdleCost;
      }

      const aggregatedSectorStates: Record<
        SectorType,
        { capacity: number; funded: number; idle: number; utilization?: number }
      > = {} as any;
      for (const states of Object.values(sectorStatesByCanton)) {
        for (const [sectorKey, state] of Object.entries(states)) {
          const sector = sectorKey as SectorType;
          const entry =
            aggregatedSectorStates[sector] ??
            (aggregatedSectorStates[sector] = {
              capacity: 0,
              funded: 0,
              idle: 0,
              utilization: 0,
            });
          entry.capacity += state.capacity;
          entry.funded += state.funded;
          entry.idle += state.idle;
          entry.utilization = (entry.utilization ?? 0) + (state.utilization ?? state.funded);
        }
      }

      const stableRevenue = Math.max(
        20,
        computeStableRevenue(mixTotals, profile.stableRevenueMultiplier, rng),
      );
      const laborDemandTotals = computeLaborMix(mixTotals);
      const laborTotal = laborDemandTotals.total;
      const foodTurns = rng.nextRange(profile.stockpiles.food[0], profile.stockpiles.food[1]);
      const foodStock = Math.max(laborTotal, Math.round(foodTurns * laborTotal));
      const fuelTurns =
        profile.stockpiles.fuel[0] +
        rng.nextRange(0, profile.stockpiles.fuel[1] - profile.stockpiles.fuel[0]);
      const fuelStock = Math.round(fuelPerTurnTotal * fuelTurns);
      const materialsPerTurn = Math.max(
        2,
        Math.round(
          (mixTotals.manufacturing ?? 0) * 1.3 +
            (mixTotals.defense ?? 0) * 1.2 +
            (mixTotals.extraction ?? 0) * 0.6 +
            (mixTotals.logistics ?? 0) * 0.3,
        ),
      );
      const materialTurns = rng.nextRange(profile.stockpiles.materials[0], profile.stockpiles.materials[1]);
      const materialsStock = Math.round(materialsPerTurn * materialTurns);
      const fxReserves = Math.round(
        stableRevenue * rng.nextRange(profile.stockpiles.fx[0], profile.stockpiles.fx[1]),
      );
      const luxuryStock = Math.max(
        laborTotal,
        Math.round(laborTotal * rng.nextRange(profile.stockpiles.luxury[0], profile.stockpiles.luxury[1])),
      );
      const ordnanceStock = Math.max(
        1,
        Math.round(
          (mixTotals.defense ?? 0) *
            rng.nextRange(profile.stockpiles.ordnance[0], profile.stockpiles.ordnance[1]),
        ),
      );
      const productionStock = Math.max(
        1,
        Math.round(
          (mixTotals.manufacturing ?? 0) *
            rng.nextRange(profile.stockpiles.production[0], profile.stockpiles.production[1]),
        ),
      );

      const desiredWelfare = { ...profile.welfare };
      const availableForWelfare = Math.max(0, stableRevenue * 0.6);
      const welfarePlan = resolveWelfare(desiredWelfare, laborTotal, availableForWelfare);
      const projectSector = rng.pick(profile.projectSectors);
      const projectTier = rng.pick(['small', 'medium', 'large'] as const);
      const tierWeight = projectTier === 'large' ? 3 : projectTier === 'medium' ? 2 : 1;
      const projectGoldCost = 12 * tierWeight;
      const projectProductionCost = 6 * tierWeight;
      let projectTurns = rng.nextInt(3) + 2;
      const projectSpendPerTurn = Math.max(2, Math.round(projectGoldCost / projectTurns));

      const militaryUpkeep = Math.max(
        3,
        Math.round(
          ((mixTotals.defense ?? 0) * 2.5 + (mixTotals.manufacturing ?? 0) * 0.5 + 4) *
            profile.militaryFocus,
        ),
      );
      const discretionaryMilitary = Math.max(0, Math.round(militaryUpkeep * 0.15));
      const militarySpend = militaryUpkeep + discretionaryMilitary;

      const interestRate = economy.finance.interestRate ?? 0.05;
      const debtSample = Math.round(stableRevenue * rng.nextRange(0.4, 0.7));
      const startInDebt = rng.nextBoolean();
      const debt = startInDebt ? debtSample : 0;
      const interest = Math.round(debt * interestRate * 100) / 100;
      const creditLimit = Math.max(debtSample + 20, Math.round(stableRevenue * profile.creditLimitMultiplier));
      const totalOps = omCostTotal + idleCostTotal;
      const totalObligations =
        interest + totalOps + welfarePlan.cost + militarySpend + projectSpendPerTurn;
      const buffer = Math.max(8, Math.round(stableRevenue * 0.25));
      let treasury = startInDebt ? 0 : buffer;
      const initialTreasury = totalObligations + treasury;
      const energyRatio =
        energyDemandTotal > 0
          ? Math.min(Math.max(energySupplyTotal / energyDemandTotal, 0.95), 1.05)
          : 1;
      const logisticsRatio =
        logisticsDemandTotal > 0
          ? Math.min(Math.max(logisticsSupplyTotal / logisticsDemandTotal, 0.95), 1.05)
          : 1;
      const energyShort = energyRatio < 0.98;
      const logisticsShort = logisticsRatio < 0.98;
      const debtStress = creditLimit > 0 ? debt / creditLimit > 0.85 : false;
      const projectDelayed = energyShort || logisticsShort || debtStress;
      if (projectDelayed) {
        projectTurns += 1;
      }

      const averageHappiness =
        layout.cantons.length > 0 ? happinessAccumulator / layout.cantons.length : 0.6;
      const averageLai = layout.cantons.length > 0 ? laiAccumulator / layout.cantons.length : 1;

      const projectHost = layout.cantons.reduce((best, current) => {
        const bestSuit = economy.cantons[best].suitability[projectSector] ?? -Infinity;
        const currentSuit = economy.cantons[current.id].suitability[projectSector] ?? -Infinity;
        if (currentSuit > bestSuit) {
          return current.id;
        }
        return best;
      }, capitalId);

      const project = {
        id: aggregate.projectId++,
        canton: projectHost,
        sector: projectSector,
        tier: projectTier,
        slots: tierWeight,
        status: 'building' as const,
        owner: playerId,
        turns_remaining: projectTurns,
        cost: { gold: projectGoldCost, production: projectProductionCost },
      };
      economy.projects.projects.push(project);
      economy.projects.nextId = aggregate.projectId;

      const nationState: NationState = {
        id: playerId,
        name: input.name,
        preset: input.preset,
        capitalCanton: capitalId,
        cantonIds: layout.cantons.map((c) => c.id),
        coastal: nationCoastal,
        signature: `${profile.nonUniformityTag}-${layout.cantons.length}-${mixTotals.finance ?? 0}-${mixTotals.research ?? 0}`,
        energy: {
          supply: Math.round(energySupplyTotal * 100) / 100,
          demand: Math.round(energyDemandTotal * 100) / 100,
          ratio: Math.round(energyRatio * 1000) / 1000,
          plants: plantsForNation,
          throttledSectors: {},
        },
        logistics: {
          supply: Math.round(logisticsSupplyTotal * 100) / 100,
          demand: Math.round(logisticsDemandTotal * 100) / 100,
          ratio: Math.round(logisticsRatio * 1000) / 1000,
          slots: mixTotals.logistics ?? 0,
          throttledSectors: {},
        },
        welfare: {
          education: welfarePlan.tiers.education,
          healthcare: welfarePlan.tiers.healthcare,
          socialSupport: welfarePlan.tiers.socialSupport,
          cost: Math.round(welfarePlan.cost * 100) / 100,
          autoDownshifted: welfarePlan.downshifted,
        },
        finance: {
          treasury,
          stableRevenue,
          creditLimit,
          debt,
          interest,
          waterfall: {
            initial: initialTreasury,
            interest,
            operations: Math.round(totalOps * 100) / 100,
            welfare: Math.round(welfarePlan.cost * 100) / 100,
            military: militarySpend,
            projects: projectSpendPerTurn,
            surplus: treasury,
          },
        },
        labor: {
          available: laborAvailableTotal,
          assigned: laborAssignedTotal,
          lai: averageLai,
          happiness: averageHappiness,
          consumption: {
            foodRequired: laborConsumptionFood,
            foodProvided: laborConsumptionFood,
            luxuryRequired: laborConsumptionLuxury,
            luxuryProvided: laborConsumptionLuxury,
          },
        },
        stockpiles: {
          food: foodStock,
          fuel: fuelStock,
          materials: materialsStock,
          fx: fxReserves,
          luxury: luxuryStock,
          ordnance: ordnanceStock,
          production: productionStock,
        },
        military: {
          upkeep: militaryUpkeep,
          funded: militarySpend,
          discretionary: discretionaryMilitary,
        },
        sectors: cloneSectorStates(aggregatedSectorStates),
        projects: [
          {
            id: project.id,
            sector: project.sector,
            tier: project.tier,
            turnsRemaining: project.turns_remaining,
            delayed: projectDelayed,
          },
        ],
        idleCost: Math.round(idleCostTotal * 100) / 100,
        omCost: Math.round(totalOps * 100) / 100,
        status: createEmptyStatusSummary(),
      };

      updateNationStatus(nationState);

      nationStates[playerId] = nationState;
      metas.push({ id: playerId, name: input.name, preset: input.preset });

      aggregate.gold += treasury;
      aggregate.food += foodStock;
      aggregate.materials += materialsStock;
      aggregate.fx += fxReserves;
      aggregate.luxury += luxuryStock;
      aggregate.ordnance += ordnanceStock;
      aggregate.production += productionStock;
      aggregate.energySupply += energySupplyTotal;
      aggregate.energyDemand += energyDemandTotal;
      aggregate.logisticsSupply += logisticsSupplyTotal;
      aggregate.logisticsDemand += logisticsDemandTotal;
      aggregate.revenues += stableRevenue;
      aggregate.expenditures += totalObligations;
      aggregate.interest += interest;
      aggregate.debt += debt;
      aggregate.creditLimit += creditLimit;

      aggregate.plants.push(...plantsForNation);
      for (const [resource, amount] of Object.entries(fuelUsedForNation)) {
        aggregate.fuelUsed[resource as ResourceType] =
          (aggregate.fuelUsed[resource as ResourceType] ?? 0) + (amount ?? 0);
      }
      if (fuelUsedForNation.coal) {
        aggregate.coal += Math.round(
          fuelStock * ((fuelUsedForNation.coal ?? 0) / (fuelPerTurnTotal || 1)),
        );
      }
      if (fuelUsedForNation.oil) {
        aggregate.oil += Math.round(
          fuelStock * ((fuelUsedForNation.oil ?? 0) / (fuelPerTurnTotal || 1)),
        );
      }
      if (fuelUsedForNation.uranium) {
        aggregate.uranium += Math.round(
          fuelStock * ((fuelUsedForNation.uranium ?? 0) / (fuelPerTurnTotal || 1)),
        );
      }
    });

    economy.resources.gold = aggregate.gold;
    economy.resources.food = aggregate.food;
    economy.resources.materials = aggregate.materials;
    economy.resources.fx = aggregate.fx;
    economy.resources.luxury = aggregate.luxury;
    economy.resources.ordnance = aggregate.ordnance;
    economy.resources.production = aggregate.production;
    economy.resources.coal = aggregate.coal;
    economy.resources.oil = aggregate.oil;
    economy.resources.uranium = aggregate.uranium;
    economy.resources.energy = 0;
    economy.resources.research = 0;
    economy.resources.logistics = 0;
    economy.resources.labor = 0;

    economy.energy.plants = aggregate.plants;
    const overallRatio = aggregate.energyDemand > 0 ? aggregate.energySupply / aggregate.energyDemand : 1;
    economy.energy.state = {
      supply: Math.round(aggregate.energySupply * 100) / 100,
      demand: Math.round(aggregate.energyDemand * 100) / 100,
      ratio: Math.round(Math.min(Math.max(overallRatio, 0.95), 1.05) * 1000) / 1000,
    };
    economy.energy.demandBySector = aggregate.demandBySector;
    economy.energy.fuelUsed = aggregate.fuelUsed;
    economy.energy.oAndMSpent = Math.round(aggregate.oAndM * 100) / 100;
    economy.energy.brownouts = [];

    economy.finance.debt = aggregate.debt;
    economy.finance.creditLimit = aggregate.creditLimit;
    economy.finance.debtStress = DEBT_STRESS_TIERS.map((tier) => aggregate.debt >= tier);
    economy.finance.summary = {
      revenues: Math.round(aggregate.revenues * 100) / 100,
      expenditures: Math.round(aggregate.expenditures * 100) / 100,
      netBorrowing: 0,
      interest: Math.round(aggregate.interest * 100) / 100,
      defaulted: false,
    };

    const firstNation = nationStates[players[0]];
    if (firstNation) {
      economy.welfare.current = {
        education: firstNation.welfare.education,
        healthcare: firstNation.welfare.healthcare,
        socialSupport: firstNation.welfare.socialSupport,
      };
      economy.welfare.next = { ...economy.welfare.current };
    }

    game.state.nations = nationStates;
    return metas;
  }
}

export const __test = {
  resolveWelfare,
  computeCantonGeography,
  detectCoastal,
  buildNationLayout,
  allocateSlots,
  computeSectorWeight,
  chooseCantonCount,
  ensureSuitabilityDefaults,
  DEFAULT_GEOGRAPHY_MODIFIERS,
  DEFAULT_UL_MODIFIERS,
  assignLaborToCanton,
};
