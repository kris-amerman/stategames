import type { CellId, PlayerId } from '../types';

export interface PartitionValidationResult {
  missingCells: CellId[];
  overlappingCells: Array<{ cell: CellId; cantons: string[] }>;
  outOfNationCells: Array<{ cell: CellId; canton: string }>;
  disconnectedCantons: string[];
  holedCantons: string[];
  coastal: Record<string, boolean>;
  areas: Record<string, number>;
  perimeters: Record<string, number>;
  compactness: Record<string, number>;
  capitalOk: boolean;
}

interface PartitionValidatorInput {
  nationCells: CellId[];
  cantonIds: string[];
  cantonTerritories: Record<string, CellId[]>;
  cellOwnership: Record<CellId, PlayerId>;
  nationId: PlayerId;
  neighbors: Int32Array;
  offsets: Uint32Array;
  biomes: Uint8Array;
  capitalCanton: string;
}

export interface PartitionRepairReport {
  gapsFilled: number;
  overlapsResolved: number;
  componentsResolved: number;
  fragmentsAbsorbed: number;
  finalCount: number;
}

export interface PartitionRepairInput {
  nationId: PlayerId;
  nationCells: CellId[];
  territories: Record<string, CellId[]>;
  adjacency: Map<CellId, CellId[]>;
  neighbors: Int32Array;
  offsets: Uint32Array;
  capitalCanton: string;
  capitalCell: CellId;
  minArea: number;
  compactnessThreshold: number;
}

export interface PartitionRepairResult {
  territories: Record<string, CellId[]>;
  assignment: Map<CellId, string>;
  report: PartitionRepairReport;
}

const MIN_AREA_FLOOR = 3;
const AREA_DIVISOR = 2;
export const MAX_COMPACTNESS_SCORE = 7;

export function computeMinimumCantonArea(totalCells: number, cantonCount: number): number {
  if (cantonCount <= 0 || totalCells <= 0) {
    return MIN_AREA_FLOOR;
  }
  const baseline = Math.floor(totalCells / Math.max(1, cantonCount * AREA_DIVISOR));
  const maxFeasible = Math.max(1, Math.floor(totalCells / Math.max(1, cantonCount)));
  let target = Math.max(MIN_AREA_FLOOR, baseline);
  if (target > maxFeasible) {
    target = maxFeasible;
  }
  return Math.max(1, target);
}

export function validateCantonPartition({
  nationCells,
  cantonIds,
  cantonTerritories,
  cellOwnership,
  nationId,
  neighbors,
  offsets,
  biomes,
  capitalCanton,
}: PartitionValidatorInput): PartitionValidationResult {
  const nationCellSet = new Set<CellId>(nationCells);
  const assignments = new Map<CellId, string[]>();
  const missingCells: CellId[] = [];
  const overlappingCells: Array<{ cell: CellId; cantons: string[] }> = [];
  const outOfNationCells: Array<{ cell: CellId; canton: string }> = [];
  const disconnectedCantons: string[] = [];
  const holedCantons: string[] = [];
  const coastal: Record<string, boolean> = {};
  const areas: Record<string, number> = {};
  const perimeters: Record<string, number> = {};
  const compactness: Record<string, number> = {};

  for (const cantonId of cantonIds) {
    const territory = cantonTerritories[cantonId] ?? [];
    const territorySet = new Set<CellId>(territory);
    areas[cantonId] = territory.length;
    perimeters[cantonId] = computePerimeter(territorySet, neighbors, offsets);
    compactness[cantonId] = computeCompactnessMetric(
      areas[cantonId] ?? 0,
      perimeters[cantonId] ?? 0,
    );

    if (territory.length > 0) {
      const visited = new Set<CellId>();
      const stack: CellId[] = [territory[0]];
      while (stack.length) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const start = offsets[current];
        const end = offsets[current + 1];
        for (let idx = start; idx < end; idx++) {
          const neighbor = neighbors[idx];
          if (neighbor < 0) continue;
          if (territorySet.has(neighbor) && !visited.has(neighbor)) {
            stack.push(neighbor as CellId);
          }
        }
      }
      if (visited.size !== territorySet.size) {
        disconnectedCantons.push(cantonId);
      }
    }

    coastal[cantonId] = detectCoastal(territory, biomes, neighbors, offsets);

    for (const cell of territory) {
      if (!nationCellSet.has(cell)) {
        outOfNationCells.push({ cell, canton: cantonId });
      }
      const list = assignments.get(cell) ?? [];
      list.push(cantonId);
      assignments.set(cell, list);
    }
  }

  for (const [cell, cantons] of assignments.entries()) {
    if (cantons.length > 1) {
      overlappingCells.push({ cell, cantons });
    }
  }

  for (const cell of nationCellSet) {
    if (!assignments.has(cell)) {
      missingCells.push(cell);
    }
  }

  const cantonSets = new Map<string, Set<CellId>>();
  for (const cantonId of cantonIds) {
    cantonSets.set(cantonId, new Set<CellId>(cantonTerritories[cantonId] ?? []));
  }

  for (const [cantonId, territory] of cantonSets.entries()) {
    const territoryArray = Array.from(territory);
    if (territoryArray.length === 0) continue;
    const complement = nationCells.filter(cell => !territory.has(cell));
    for (const cell of complement) {
      const start = offsets[cell];
      const end = offsets[cell + 1];
      let inNationNeighborCount = 0;
      let surrounded = true;
      for (let idx = start; idx < end; idx++) {
        const neighbor = neighbors[idx];
        if (neighbor < 0) continue;
        if (!nationCellSet.has(neighbor)) continue;
        inNationNeighborCount += 1;
        if (!territory.has(neighbor)) {
          surrounded = false;
          break;
        }
      }
      if (inNationNeighborCount > 0 && surrounded) {
        holedCantons.push(cantonId);
        break;
      }
    }
  }

  const minArea = computeMinimumCantonArea(nationCells.length, Math.max(1, cantonIds.length));
  const capitalTerritory = cantonTerritories[capitalCanton] ?? [];
  const capitalOk =
    cantonIds.includes(capitalCanton) &&
    capitalTerritory.length >= minArea &&
    !disconnectedCantons.includes(capitalCanton) &&
    (compactness[capitalCanton] ?? 0) <= MAX_COMPACTNESS_SCORE &&
    capitalTerritory.every(
      cell => cellOwnership[cell] === nationId && assignments.get(cell)?.length === 1,
    );

  return {
    missingCells,
    overlappingCells,
    outOfNationCells,
    disconnectedCantons,
    holedCantons,
    coastal,
    areas,
    perimeters,
    compactness,
    capitalOk,
  };
}

function detectCoastal(
  cells: CellId[],
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
): boolean {
  for (const cell of cells) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    for (let idx = start; idx < end; idx++) {
      const neighbor = neighbors[idx];
      if (neighbor < 0) continue;
      const biome = biomes[neighbor];
      if (biome === 6 || biome === 7) {
        return true;
      }
    }
  }
  return false;
}

function computePerimeter(
  territory: Set<CellId>,
  neighbors: Int32Array,
  offsets: Uint32Array,
): number {
  let perimeter = 0;
  for (const cell of territory) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    for (let idx = start; idx < end; idx++) {
      const neighbor = neighbors[idx];
      if (neighbor < 0 || !territory.has(neighbor)) {
        perimeter += 1;
      }
    }
  }
  return perimeter;
}

function computeCompactnessMetric(area: number, perimeter: number): number {
  if (area <= 0 || perimeter <= 0) {
    return 0;
  }
  return (perimeter * perimeter) / (4 * Math.PI * area);
}

export function repairCantonPartition({
  nationId: _nationId,
  nationCells,
  territories,
  adjacency,
  neighbors,
  offsets,
  capitalCanton,
  capitalCell,
  minArea,
  compactnessThreshold,
}: PartitionRepairInput): PartitionRepairResult {
  const nationCellSet = new Set<CellId>(nationCells);
  const sets = new Map<string, Set<CellId>>();
  const assignment = new Map<CellId, string>();

  const report: PartitionRepairReport = {
    gapsFilled: 0,
    overlapsResolved: 0,
    componentsResolved: 0,
    fragmentsAbsorbed: 0,
    finalCount: 0,
  };

  for (const [cantonId, cells] of Object.entries(territories)) {
    const filtered = cells.filter((cell) => nationCellSet.has(cell));
    const set = new Set<CellId>(filtered);
    sets.set(cantonId, set);
    for (const cell of filtered) {
      const owners = assignment.get(cell);
      if (owners === cantonId) continue;
      if (!assignment.has(cell)) {
        assignment.set(cell, cantonId);
      } else {
        // track overlap by temporarily marking as multiple entries
        const marker = `__overlap__${cell}`;
        assignment.set(cell, marker);
      }
    }
  }

  const overlapCells: Map<CellId, string[]> = new Map();
  for (const [cantonId, cells] of sets.entries()) {
    for (const cell of cells) {
      const existing = overlapCells.get(cell) ?? [];
      existing.push(cantonId);
      overlapCells.set(cell, existing);
    }
  }

  for (const [cell, owners] of overlapCells.entries()) {
    if (owners.length <= 1) {
      assignment.set(cell, owners[0] ?? capitalCanton);
      continue;
    }
    const winner = pickPrimaryOwner(owners, sets, capitalCanton);
    assignment.set(cell, winner);
    for (const owner of owners) {
      if (owner === winner) continue;
      const set = sets.get(owner);
      if (set?.delete(cell)) {
        report.overlapsResolved += 1;
      }
    }
  }

  for (const cell of nationCellSet) {
    if (assignment.has(cell)) continue;
    const owner = findNearestOwner(cell, adjacency, assignment, capitalCanton);
    assignment.set(cell, owner);
    const set = ensureTerritorySet(owner, sets);
    if (!set.has(cell)) {
      set.add(cell);
      report.gapsFilled += 1;
    }
  }

  for (const [cantonId, set] of sets.entries()) {
    pruneOutOfNation(set, nationCellSet);
    const components = findComponents(set, adjacency);
    if (components.length <= 1) continue;
    const sortedComponents = [...components].sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return (a[0] ?? 0) - (b[0] ?? 0);
    });
    let keepComponent = sortedComponents[0];
    if (cantonId === capitalCanton) {
      const containingCapital = sortedComponents.find((component) =>
        component.includes(capitalCell),
      );
      if (containingCapital) {
        keepComponent = containingCapital;
      }
    }
    const keep = new Set<CellId>(keepComponent);
    set.clear();
    for (const cell of keep) {
      set.add(cell);
      assignment.set(cell, cantonId);
    }
    for (const component of sortedComponents) {
      if (component === keepComponent) continue;
      const target = chooseNeighborForComponent(component, cantonId, sets, assignment, adjacency, capitalCanton);
      const targetSet = ensureTerritorySet(target, sets);
      for (const cell of component) {
        targetSet.add(cell);
        assignment.set(cell, target);
      }
      report.componentsResolved += 1;
    }
  }

  fillHoles(
    sets,
    nationCellSet,
    neighbors,
    offsets,
    assignment,
    report,
  );
  trimTendrils(sets, adjacency, assignment, minArea, capitalCanton, capitalCell, report);
  expandSmallCantons(sets, adjacency, assignment, minArea, capitalCanton, capitalCell, report);
  improveCompactness(
    sets,
    adjacency,
    assignment,
    neighbors,
    offsets,
    compactnessThreshold,
    minArea,
    capitalCanton,
    capitalCell,
    report,
  );
  expandSmallCantons(sets, adjacency, assignment, minArea, capitalCanton, capitalCell, report);

  const normalized: Record<string, CellId[]> = {};
  for (const [cantonId, set] of sets.entries()) {
    const sorted = [...set].sort((a, b) => a - b);
    normalized[cantonId] = sorted;
    for (const cell of sorted) {
      assignment.set(cell, cantonId);
    }
  }

  report.finalCount = Object.values(normalized).filter((cells) => cells.length > 0).length;

  return { territories: normalized, assignment, report };
}

function pruneOutOfNation(set: Set<CellId>, nation: Set<CellId>): void {
  for (const cell of [...set]) {
    if (!nation.has(cell)) {
      set.delete(cell);
    }
  }
}

function pickPrimaryOwner(
  owners: string[],
  sets: Map<string, Set<CellId>>,
  capitalCanton: string,
): string {
  if (owners.includes(capitalCanton)) return capitalCanton;
  return owners
    .slice()
    .sort((a, b) => {
      const sizeDiff = (sets.get(b)?.size ?? 0) - (sets.get(a)?.size ?? 0);
      if (sizeDiff !== 0) return sizeDiff;
      return a.localeCompare(b);
    })[0];
}

function ensureTerritorySet(id: string, sets: Map<string, Set<CellId>>): Set<CellId> {
  let set = sets.get(id);
  if (!set) {
    set = new Set<CellId>();
    sets.set(id, set);
  }
  return set;
}

function findNearestOwner(
  start: CellId,
  adjacency: Map<CellId, CellId[]>,
  assignment: Map<CellId, string>,
  fallback: string,
): string {
  const visited = new Set<CellId>([start]);
  const queue: CellId[] = [start];
  while (queue.length) {
    const cell = queue.shift()!;
    const owner = assignment.get(cell);
    if (owner && !owner.startsWith('__overlap__')) {
      return owner;
    }
    for (const neighbor of adjacency.get(cell) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return fallback;
}

function findComponents(
  set: Set<CellId>,
  adjacency: Map<CellId, CellId[]>,
): CellId[][] {
  const result: CellId[][] = [];
  const visited = new Set<CellId>();
  for (const cell of set) {
    if (visited.has(cell)) continue;
    const component: CellId[] = [];
    const stack: CellId[] = [cell];
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      if (!set.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor) && set.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
    if (component.length > 0) {
      component.sort((a, b) => a - b);
      result.push(component);
    }
  }
  return result;
}

function chooseNeighborForComponent(
  component: CellId[],
  origin: string,
  sets: Map<string, Set<CellId>>,
  assignment: Map<CellId, string>,
  adjacency: Map<CellId, CellId[]>,
  capitalCanton: string,
): string {
  const scores = new Map<string, number>();
  for (const cell of component) {
    for (const neighbor of adjacency.get(cell) ?? []) {
      const owner = assignment.get(neighbor);
      if (!owner || owner === origin) continue;
      scores.set(owner, (scores.get(owner) ?? 0) + 1);
    }
  }
  if (scores.size === 0) {
    return capitalCanton;
  }
  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const sizeDiff = (sets.get(b[0])?.size ?? 0) - (sets.get(a[0])?.size ?? 0);
      if (sizeDiff !== 0) return sizeDiff;
      return a[0].localeCompare(b[0]);
    })[0][0];
}

function fillHoles(
  sets: Map<string, Set<CellId>>,
  nation: Set<CellId>,
  neighbors: Int32Array,
  offsets: Uint32Array,
  assignment: Map<CellId, string>,
  report: PartitionRepairReport,
): void {
  for (const [cantonId, set] of sets.entries()) {
    const additions: CellId[] = [];
    for (const cell of nation) {
      if (set.has(cell)) continue;
      const start = offsets[cell];
      const end = offsets[cell + 1];
      if (start === undefined || end === undefined) continue;
      let enclosed = true;
      for (let idx = start; idx < end; idx++) {
        const neighbor = neighbors[idx];
        if (neighbor < 0 || !nation.has(neighbor)) continue;
        if (!set.has(neighbor)) {
          enclosed = false;
          break;
        }
      }
      if (enclosed) {
        additions.push(cell);
      }
    }
    if (additions.length === 0) continue;
    for (const cell of additions) {
      const previous = assignment.get(cell);
      if (previous && previous !== cantonId) {
        const prevSet = sets.get(previous);
        prevSet?.delete(cell);
      }
      set.add(cell);
      assignment.set(cell, cantonId);
      report.fragmentsAbsorbed += 1;
    }
  }
}

function trimTendrils(
  sets: Map<string, Set<CellId>>,
  adjacency: Map<CellId, CellId[]>,
  assignment: Map<CellId, string>,
  minArea: number,
  capitalCanton: string,
  capitalCell: CellId,
  report: PartitionRepairReport,
): void {
  const lastOwners = new Map<CellId, string>();
  const maxIterations = 2000;
  let iterations = 0;
  let changed = true;
  while (changed && iterations < maxIterations) {
    iterations += 1;
    changed = false;
    for (const [cantonId, set] of sets.entries()) {
      if (set.size <= minArea) continue;
      for (const cell of [...set]) {
        if (cantonId === capitalCanton && cell === capitalCell) continue;
        const neighbors = adjacency.get(cell) ?? [];
        const internalNeighbors = neighbors.filter((nb) => set.has(nb));
        if (internalNeighbors.length <= 1) {
          const targets = neighbors
            .map((nb) => assignment.get(nb))
            .filter((owner): owner is string => Boolean(owner) && owner !== cantonId);
          if (targets.length === 0) continue;
          const priorOwner = lastOwners.get(cell);
          const filteredTargets = priorOwner
            ? targets.filter((owner) => owner !== priorOwner)
            : targets;
          if (filteredTargets.length === 0) {
            continue;
          }
          const target = pickPrimaryOwner(filteredTargets, sets, capitalCanton);
          const targetSet = ensureTerritorySet(target, sets);
          set.delete(cell);
          targetSet.add(cell);
          assignment.set(cell, target);
          lastOwners.set(cell, cantonId);
          report.fragmentsAbsorbed += 1;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
}

function expandSmallCantons(
  sets: Map<string, Set<CellId>>,
  adjacency: Map<CellId, CellId[]>,
  assignment: Map<CellId, string>,
  minArea: number,
  capitalCanton: string,
  capitalCell: CellId,
  report: PartitionRepairReport,
): void {
  let iterations = 0;
  const maxIterations = 2000;
  while (iterations < maxIterations) {
    iterations += 1;
    let progressed = false;
    const entries = [...sets.entries()].sort((a, b) => a[1].size - b[1].size);
    for (const [cantonId, set] of entries) {
      if (set.size >= minArea) continue;
      const frontier: Array<{ donor: string; cell: CellId }> = [];
      for (const cell of set) {
        for (const neighbor of adjacency.get(cell) ?? []) {
          const owner = assignment.get(neighbor);
          if (!owner || owner === cantonId) continue;
          frontier.push({ donor: owner, cell: neighbor });
        }
      }
      frontier.sort((a, b) => {
        const donorDiff = (sets.get(b.donor)?.size ?? 0) - (sets.get(a.donor)?.size ?? 0);
        if (donorDiff !== 0) return donorDiff;
        return a.cell - b.cell;
      });
      for (const { donor, cell } of frontier) {
        if (donor === capitalCanton && cell === capitalCell) continue;
        const donorSet = sets.get(donor);
        if (!donorSet || !donorSet.has(cell)) continue;
        if (donorSet.size <= minArea) continue;
        if (!isRemovalSafe(donorSet, cell, adjacency)) continue;
        donorSet.delete(cell);
        set.add(cell);
        assignment.set(cell, cantonId);
        report.fragmentsAbsorbed += 1;
        progressed = true;
        break;
      }
      if (progressed) break;
    }
    if (!progressed) break;
  }
}

function improveCompactness(
  sets: Map<string, Set<CellId>>,
  adjacency: Map<CellId, CellId[]>,
  assignment: Map<CellId, string>,
  neighbors: Int32Array,
  offsets: Uint32Array,
  threshold: number,
  minArea: number,
  capitalCanton: string,
  capitalCell: CellId,
  report: PartitionRepairReport,
): void {
  let changed = true;
  let safety = 0;
  while (changed && safety < 500) {
    changed = false;
    safety += 1;
    for (const [cantonId, set] of sets.entries()) {
      if (set.size === 0) continue;
      const perimeter = computePerimeter(set, neighbors, offsets);
      const compactness = computeCompactnessMetric(set.size, perimeter);
      if (compactness <= threshold || set.size <= minArea) continue;
      const candidate = selectBoundaryCell(
        set,
        adjacency,
        neighbors,
        offsets,
        cantonId,
        assignment,
        capitalCanton,
        capitalCell,
      );
      if (candidate === null) continue;
      const targets = adjacency.get(candidate) ?? [];
      const ownerChoices = targets
        .map((nb) => assignment.get(nb))
        .filter((owner): owner is string => Boolean(owner) && owner !== cantonId);
      if (ownerChoices.length === 0) continue;
      const target = pickPrimaryOwner(ownerChoices, sets, capitalCanton);
      const donorSet = sets.get(cantonId)!;
      const targetSet = ensureTerritorySet(target, sets);
      donorSet.delete(candidate);
      targetSet.add(candidate);
      assignment.set(candidate, target);
      report.fragmentsAbsorbed += 1;
      changed = true;
      break;
    }
  }
}

function selectBoundaryCell(
  set: Set<CellId>,
  adjacency: Map<CellId, CellId[]>,
  neighbors: Int32Array,
  offsets: Uint32Array,
  cantonId: string,
  assignment: Map<CellId, string>,
  capitalCanton: string,
  capitalCell: CellId,
): CellId | null {
  const boundary: CellId[] = [];
  for (const cell of set) {
    if (cantonId === capitalCanton && cell === capitalCell) continue;
    const start = offsets[cell];
    const end = offsets[cell + 1];
    let touchesOutside = false;
    for (let idx = start; idx < end; idx++) {
      const neighbor = neighbors[idx];
      if (neighbor < 0 || !set.has(neighbor)) {
        touchesOutside = true;
        break;
      }
    }
    if (touchesOutside) {
      boundary.push(cell);
    }
  }
  boundary.sort((a, b) => a - b);
  for (const cell of boundary) {
    const donorNeighbors = (adjacency.get(cell) ?? []).filter((nb) => set.has(nb));
    if (donorNeighbors.length <= 1) {
      return cell;
    }
  }
  return boundary[0] ?? null;
}

function isRemovalSafe(
  donorSet: Set<CellId>,
  cell: CellId,
  adjacency: Map<CellId, CellId[]>,
): boolean {
  if (!donorSet.has(cell)) return false;
  if (donorSet.size <= 1) return false;
  const neighbors = (adjacency.get(cell) ?? []).filter((nb) => donorSet.has(nb));
  if (neighbors.length === 0) return false;
  const start = neighbors[0];
  const visited = new Set<CellId>([cell]);
  const stack: CellId[] = [start];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const nb of adjacency.get(current) ?? []) {
      if (!donorSet.has(nb) || nb === cell || visited.has(nb)) continue;
      stack.push(nb);
    }
  }
  return visited.size === donorSet.size;
}
