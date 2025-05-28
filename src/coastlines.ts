// TODO not really used at the moment, could be useful later

import { DualMesh } from "./dual-mesh";

/**
 * Identifies coastline cells (land cells adjacent to water cells)
 * @param dualMesh The dual mesh instance
 * @param cellElevations Array of elevation values for each cell (indexed by cell ID)
 * @param waterLevel The elevation threshold below which cells are considered water (default: 0.5)
 * @returns Set of cell IDs that are coastline cells
 */

// TODO instead of returning a Set, return a typed array?
export function findCoastlineCells(
  dualMesh: DualMesh,
  cellElevations: Float64Array | number[],
  waterLevel: number = 0.5
): Set<number> {
  const coastlineCells = new Set<number>();
  const totalCells = dualMesh.cellOffsets.length - 1;

  // Pre-compute water cell set for O(1) lookups
  const waterCells = new Set<number>();
  for (let cellId = 0; cellId < totalCells; cellId++) {
    if (cellElevations[cellId] < waterLevel) {
      waterCells.add(cellId);
    }
  }

  // Check each land cell for water neighbors
  for (let cellId = 0; cellId < totalCells; cellId++) {
    // Skip if this cell is water
    if (waterCells.has(cellId)) continue;

    // Check if any valid neighbor is water
    const start = dualMesh.cellOffsets[cellId];
    const end = dualMesh.cellOffsets[cellId + 1];

    for (let i = start; i < end; i++) {
      const neighborId = dualMesh.cellNeighbors[i];

      // Check valid neighbors (neighborId >= 0) and boundary edges (neighborId === -1)
      if (neighborId === -1 || waterCells.has(neighborId)) {
        coastlineCells.add(cellId);
        break; // Found water neighbor, no need to check remaining neighbors
      }
    }
  }

  return coastlineCells;
}

/**
 * More detailed coastline analysis that returns both coastline and water cells
 */
export function analyzeCoastline(
  dualMesh: DualMesh,
  cellElevations: Float64Array | number[],
  waterLevel: number = 0.5
): {
  coastlineCells: Set<number>;
  waterCells: Set<number>;
  landCells: Set<number>;
} {
  const coastlineCells = new Set<number>();
  const waterCells = new Set<number>();
  const landCells = new Set<number>();
  const totalCells = dualMesh.cellOffsets.length - 1;

  // Classify all cells first
  for (let cellId = 0; cellId < totalCells; cellId++) {
    if (cellElevations[cellId] < waterLevel) {
      waterCells.add(cellId);
    } else {
      landCells.add(cellId);
    }
  }

  // Find coastline cells among land cells
  for (const cellId of landCells) {
    const start = dualMesh.cellOffsets[cellId];
    const end = dualMesh.cellOffsets[cellId + 1];

    for (let i = start; i < end; i++) {
      const neighborId = dualMesh.cellNeighbors[i];

      if (neighborId === -1 || waterCells.has(neighborId)) {
        coastlineCells.add(cellId);
        break;
      }
    }
  }

  return { coastlineCells, waterCells, landCells };
}
