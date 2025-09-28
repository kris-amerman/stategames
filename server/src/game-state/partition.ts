import type { CellId, PlayerId } from '../types';

export interface PartitionValidationResult {
  missingCells: CellId[];
  overlappingCells: Array<{ cell: CellId; cantons: string[] }>;
  outOfNationCells: Array<{ cell: CellId; canton: string }>;
  disconnectedCantons: string[];
  holedCantons: string[];
  coastal: Record<string, boolean>;
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

  for (const cantonId of cantonIds) {
    const territory = cantonTerritories[cantonId] ?? [];
    const territorySet = new Set<CellId>(territory);

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

  const capitalOk =
    cantonIds.includes(capitalCanton) &&
    (cantonTerritories[capitalCanton]?.length ?? 0) > 0 &&
    cantonTerritories[capitalCanton]!.every(
      cell => cellOwnership[cell] === nationId && assignments.get(cell)?.length === 1,
    );

  return {
    missingCells,
    overlappingCells,
    outOfNationCells,
    disconnectedCantons,
    holedCantons,
    coastal,
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
