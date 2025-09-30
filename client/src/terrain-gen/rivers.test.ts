import { describe, expect, it } from 'vitest';
import { generateRivers } from './rivers';

interface GridMesh {
  offsets: Uint32Array;
  neighbors: Int32Array;
}

function createGridMesh(width: number, height: number): GridMesh {
  const cellCount = width * height;
  const neighbors: number[] = [];
  const offsets = new Uint32Array(cellCount + 1);

  const index = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cid = index(x, y);
      offsets[cid] = neighbors.length;

      neighbors.push(y > 0 ? index(x, y - 1) : -1);
      neighbors.push(y < height - 1 ? index(x, y + 1) : -1);
      neighbors.push(x > 0 ? index(x - 1, y) : -1);
      neighbors.push(x < width - 1 ? index(x + 1, y) : -1);
    }
  }

  offsets[cellCount] = neighbors.length;
  return { offsets, neighbors: Int32Array.from(neighbors) };
}

function areAdjacent(a: number, b: number, mesh: GridMesh): boolean {
  const start = mesh.offsets[a];
  const end = mesh.offsets[a + 1];
  for (let i = start; i < end; i++) {
    if (mesh.neighbors[i] === b) {
      return true;
    }
  }
  return false;
}

function buildBaseElevations(width: number, height: number): Float64Array {
  const cellCount = width * height;
  const data = new Float64Array(cellCount);

  const index = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let elevation = 0.6 - 0.08 * y;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        elevation = 0.1; // ocean boundary
      }
      data[index(x, y)] = elevation;
    }
  }

  return data;
}

describe('generateRivers', () => {
  const width = 5;
  const height = 5;
  const mesh = createGridMesh(width, height);
  const index = (x: number, y: number) => y * width + x;

  function createTestElevations(): Float64Array {
    const elevations = buildBaseElevations(width, height);
    elevations[index(2, 1)] = 0.86;
    elevations[index(1, 2)] = 0.8;
    elevations[index(3, 2)] = 0.79;
    elevations[index(2, 3)] = 0.45;
    elevations[index(2, 4)] = 0.05; // ocean outlet
    return elevations;
  }

  it('places rivers from high elevation sources that flow downhill to ocean', () => {
    const elevations = createTestElevations();
    const copy = new Float64Array(elevations);
    const waterLevel = 0.3;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      { riverCount: 2, minRiverLength: 2 }
    );

    const primaries = result.rivers.filter((river) => !river.isTributary);
    expect(result.generated).toBe(2);
    expect(primaries.length).toBe(2);

    for (const river of primaries) {
      const sourceElevation = elevations[river.source];
      const neighborhood: number[] = [sourceElevation];
      const start = mesh.offsets[river.source];
      const end = mesh.offsets[river.source + 1];
      for (let i = start; i < end; i++) {
        const nb = mesh.neighbors[i];
        if (nb >= 0) {
          neighborhood.push(elevations[nb]);
        }
      }
      const sorted = [...neighborhood].sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      expect(sourceElevation).toBeGreaterThan(median);

      for (let i = 0; i < river.cells.length - 1; i++) {
        const current = river.cells[i];
        const next = river.cells[i + 1];
        expect(areAdjacent(current, next, mesh)).toBe(true);
        expect(elevations[next]).toBeLessThanOrEqual(elevations[current] + 1e-6);
      }

      const sink = river.cells[river.cells.length - 1];
      const sinkIsOcean = elevations[sink] <= waterLevel + 1e-6;
      const sinkIsLake = result.newLakeCells.includes(sink);
      expect(sinkIsOcean || sinkIsLake).toBe(true);
    }

    // ensure per-cell flags match river paths and inputs remain unchanged
    const flaggedCells = new Set<number>();
    for (const river of result.rivers) {
      for (const cell of river.cells) {
        flaggedCells.add(cell);
      }
    }

    for (let cid = 0; cid < result.riverFlags.length; cid++) {
      const expectedFlag = flaggedCells.has(cid) ? 1 : 0;
      expect(result.riverFlags[cid]).toBe(expectedFlag);
    }

    expect(elevations).toEqual(copy);
  });

  it('is deterministic for fixed inputs', () => {
    const elevations = createTestElevations();
    const waterLevel = 0.3;

    const runA = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      { riverCount: 2, minRiverLength: 2 }
    );
    const runB = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      { riverCount: 2, minRiverLength: 2 }
    );

    expect(runA.generated).toBe(runB.generated);
    expect(runA.rivers.map((r) => r.cells)).toEqual(runB.rivers.map((r) => r.cells));
    expect(Array.from(runA.riverFlags)).toEqual(Array.from(runB.riverFlags));
  });

  it('allows confluences with shared downstream segments', () => {
    const elevations = buildBaseElevations(width, height);
    elevations[index(1, 1)] = 0.95;
    elevations[index(3, 1)] = 0.94;
    elevations[index(2, 1)] = 0.7;
    elevations[index(2, 2)] = 0.55;
    elevations[index(2, 3)] = 0.35;
    elevations[index(2, 4)] = 0.05;
    elevations[index(1, 2)] = 0.75;
    elevations[index(3, 2)] = 0.75;
    elevations[index(0, 1)] = 0.9;
    elevations[index(4, 1)] = 0.9;
    elevations[index(1, 0)] = 0.9;
    elevations[index(2, 0)] = 0.9;
    elevations[index(3, 0)] = 0.9;

    const waterLevel = 0.3;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      { riverCount: 2, minRiverLength: 3 }
    );

    const tributaries = result.rivers.filter((river) => river.isTributary);
    expect(result.generated).toBe(1);
    expect(tributaries.length).toBeGreaterThan(0);
    expect(result.logs.some((log) => log.includes('only generated 1'))).toBe(true);

    const [main] = result.rivers.filter((river) => !river.isTributary);
    expect(main).toBeDefined();
    const sharedCells = new Set<number>();
    for (const tributary of tributaries) {
      for (const cell of tributary.cells) {
        if (main.cells.includes(cell)) {
          sharedCells.add(cell);
        }
      }
    }
    expect(sharedCells.size).toBeGreaterThan(0);
  });
});
