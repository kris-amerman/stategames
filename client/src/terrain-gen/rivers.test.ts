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
  const EPS = 1e-6;

  function percentileBand(
    elevations: Float64Array,
    waterLevel: number,
    min: number,
    max: number
  ): { minElevation: number; maxElevation: number } {
    const landElevations = Array.from(elevations).filter((value) => value > waterLevel);
    landElevations.sort((a, b) => a - b);
    const last = landElevations.length - 1;
    const minIndex = Math.max(0, Math.min(last, Math.floor(min * last)));
    const maxIndex = Math.max(0, Math.min(last, Math.floor(max * last)));
    return {
      minElevation: landElevations[minIndex],
      maxElevation: landElevations[Math.max(minIndex, maxIndex)],
    };
  }

  function graphDistance(
    from: number,
    to: number,
    mesh: GridMesh,
    passable: (cell: number) => boolean
  ): number | null {
    if (from === to) return 0;
    const visited = new Set<number>([from]);
    const queue: Array<{ cell: number; distance: number }> = [{ cell: from, distance: 0 }];
    while (queue.length > 0) {
      const { cell, distance } = queue.shift()!;
      const start = mesh.offsets[cell];
      const end = mesh.offsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = mesh.neighbors[i];
        if (nb < 0 || visited.has(nb) || !passable(nb)) continue;
        if (nb === to) {
          return distance + 1;
        }
        visited.add(nb);
        queue.push({ cell: nb, distance: distance + 1 });
      }
    }
    return null;
  }

  it('selects headwaters below peaks within the configured band', () => {
    const width = 6;
    const height = 6;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.25;
    const elevations = new Float64Array(width * height).fill(0.45);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          elevations[index(x, y)] = 0.12;
        }
      }
    }

    const peakA = index(2, 2);
    const peakB = index(4, 3);
    elevations[peakA] = 0.97;
    elevations[peakB] = 0.95;

    elevations[index(2, 1)] = 0.9;
    elevations[index(1, 2)] = 0.91;
    elevations[index(3, 2)] = 0.89;
    elevations[index(2, 3)] = 0.88;

    elevations[index(4, 2)] = 0.9;
    elevations[index(3, 3)] = 0.91;
    elevations[index(5, 3)] = 0.4; // coastline near second massif
    elevations[index(4, 4)] = 0.87;

    const controls = {
      riverCount: 2,
      minRiverLength: 2,
      headwaterBand: { min: 0.55, max: 0.85 },
      minSourceSpacing: 3,
      meanderBias: 0.5,
      flatTolerance: 3,
      tributaryDensity: 0.4,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    const primaries = result.rivers.filter((river) => !river.isTributary);
    expect(result.generated).toBeGreaterThan(0);
    expect(primaries.length).toBeGreaterThan(0);

    const { minElevation, maxElevation } = percentileBand(
      elevations,
      waterLevel,
      controls.headwaterBand.min,
      controls.headwaterBand.max
    );
    const peakSet = new Set([peakA, peakB]);

    for (const river of primaries) {
      expect(peakSet.has(river.source)).toBe(false);
      const sourceElevation = elevations[river.source];
      expect(sourceElevation).toBeGreaterThanOrEqual(minElevation - EPS);
      expect(sourceElevation).toBeLessThanOrEqual(maxElevation + EPS);

      const start = mesh.offsets[river.source];
      const end = mesh.offsets[river.source + 1];
      let higherNeighbor = false;
      let lowerNeighbor = false;
      for (let i = start; i < end; i++) {
        const nb = mesh.neighbors[i];
        if (nb < 0) continue;
        if (elevations[nb] > sourceElevation + EPS) higherNeighbor = true;
        if (elevations[nb] < sourceElevation - EPS) lowerNeighbor = true;
      }
      expect(higherNeighbor).toBe(true);
      expect(lowerNeighbor).toBe(true);
    }
  });

  it('distributes primary sources across landmasses with minimum spacing', () => {
    const width = 9;
    const height = 7;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.2;
    const elevations = new Float64Array(width * height).fill(0.45);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
          elevations[index(x, y)] = 0.1;
        }
        if (x === 4) {
          elevations[index(x, y)] = 0.1; // channel splitting landmasses
        }
      }
    }

    elevations[index(2, 2)] = 0.97;
    elevations[index(3, 2)] = 0.9;
    elevations[index(2, 3)] = 0.88;
    elevations[index(2, 4)] = 0.72;
    elevations[index(2, 5)] = 0.55;
    elevations[index(2, 6)] = 0.1;
    elevations[index(3, 3)] = 0.78;

    elevations[index(6, 2)] = 0.96;
    elevations[index(5, 2)] = 0.9;
    elevations[index(6, 3)] = 0.88;
    elevations[index(6, 4)] = 0.72;
    elevations[index(6, 5)] = 0.55;
    elevations[index(6, 6)] = 0.1;
    elevations[index(5, 3)] = 0.78;

    const controls = {
      riverCount: 2,
      minRiverLength: 3,
      headwaterBand: { min: 0.5, max: 0.95 },
      minSourceSpacing: 3,
      meanderBias: 0.4,
      flatTolerance: 2,
      tributaryDensity: 0.2,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    expect(result.generated).toBeGreaterThan(0);
    const primaries = result.rivers.filter((river) => !river.isTributary);
    expect(primaries.length).toBe(result.generated);

    const leftSources = primaries.filter((river) => (river.source % width) <= 2);
    const rightSources = primaries.filter((river) => (river.source % width) >= 4);
    expect(leftSources.length).toBeGreaterThan(0);
    expect(rightSources.length).toBeGreaterThan(0);

    for (let i = 0; i < primaries.length; i++) {
      for (let j = i + 1; j < primaries.length; j++) {
        const distance = graphDistance(
          primaries[i].source,
          primaries[j].source,
          mesh,
          (cell) => elevations[cell] > waterLevel
        );
        if (distance !== null) {
          expect(distance).toBeGreaterThanOrEqual(controls.minSourceSpacing);
        }
      }
    }
  });

  it('flows downhill without uphill steps and marks river cells', () => {
    const width = 5;
    const height = 5;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.3;
    const elevations = buildBaseElevations(width, height);
    elevations[index(2, 1)] = 0.86;
    elevations[index(1, 2)] = 0.8;
    elevations[index(3, 2)] = 0.79;
    elevations[index(2, 3)] = 0.45;
    elevations[index(2, 4)] = 0.05;

    const controls = {
      riverCount: 2,
      minRiverLength: 2,
      headwaterBand: { min: 0.55, max: 0.9 },
      minSourceSpacing: 2,
      meanderBias: 0.6,
      flatTolerance: 3,
      tributaryDensity: 0.3,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    const flaggedCells = new Set<number>();
    for (const river of result.rivers) {
      for (let i = 0; i < river.cells.length - 1; i++) {
        const current = river.cells[i];
        const next = river.cells[i + 1];
        expect(areAdjacent(current, next, mesh)).toBe(true);
        expect(elevations[next]).toBeLessThanOrEqual(elevations[current] + EPS);
      }
      river.cells.forEach((cell) => flaggedCells.add(cell));
      const sink = river.cells[river.cells.length - 1];
      const sinkIsOcean = elevations[sink] <= waterLevel + EPS;
      const sinkIsLake = result.newLakeCells.includes(sink);
      expect(sinkIsOcean || sinkIsLake).toBe(true);
    }

    for (let cid = 0; cid < result.riverFlags.length; cid++) {
      const expected = flaggedCells.has(cid) ? 1 : 0;
      expect(result.riverFlags[cid]).toBe(expected);
    }
  });

  it('introduces gentle meanders on shallow slopes', () => {
    const width = 5;
    const height = 6;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.25;
    const elevations = new Float64Array(width * height).fill(0.5);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          elevations[index(x, y)] = 0.1;
        }
      }
    }

    const source = index(2, 2);
    elevations[index(2, 1)] = 0.9;
    elevations[source] = 0.85;
    elevations[index(3, 2)] = 0.84;
    elevations[index(2, 3)] = 0.83;
    elevations[index(3, 3)] = 0.8;
    elevations[index(2, 4)] = 0.6;
    elevations[index(3, 4)] = 0.58;
    elevations[index(2, 5)] = 0.1;
    elevations[index(3, 5)] = 0.1;

    const controls = {
      riverCount: 1,
      minRiverLength: 3,
      headwaterBand: { min: 0.8, max: 0.9 },
      minSourceSpacing: 2,
      meanderBias: 0.9,
      flatTolerance: 5,
      tributaryDensity: 0.1,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    expect(result.rivers.length).toBeGreaterThan(0);
    const [river] = result.rivers.filter((r) => !r.isTributary);
    expect(river).toBeDefined();

    if (!river) {
      throw new Error('expected primary river');
    }
    expect(river.cells.length).toBeGreaterThan(2);

    const horizontalSteps = river.cells.filter((cell, idx) => {
      if (idx === 0) return false;
      const prev = river.cells[idx - 1];
      const prevX = prev % width;
      const prevY = Math.floor(prev / width);
      const x = cell % width;
      const y = Math.floor(cell / width);
      return prevY === y && Math.abs(prevX - x) === 1;
    });
    expect(horizontalSteps.length).toBeGreaterThan(0);

  });

  it('terminates inland basins by creating lakes when no outlet exists', () => {
    const width = 5;
    const height = 5;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.2;
    const elevations = new Float64Array(width * height).fill(0.5);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          elevations[index(x, y)] = 0.65;
        }
      }
    }

    const basin = index(2, 2);
    elevations[basin] = 0.3;
    elevations[index(2, 1)] = 0.88;
    elevations[index(1, 2)] = 0.8;
    elevations[index(3, 2)] = 0.78;
    elevations[index(1, 1)] = 0.92;
    elevations[index(3, 1)] = 0.9;
    elevations[index(2, 3)] = 0.45;
    elevations[index(1, 3)] = 0.52;
    elevations[index(3, 3)] = 0.51;

    const controls = {
      riverCount: 1,
      minRiverLength: 2,
      headwaterBand: { min: 0.6, max: 0.95 },
      minSourceSpacing: 2,
      meanderBias: 0.3,
      flatTolerance: 2,
      tributaryDensity: 0,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    expect(result.rivers.length).toBeGreaterThan(0);
    const main = result.rivers.find((river) => !river.isTributary);
    expect(main).toBeDefined();
    expect(main!.sinkType).toBe('lake');
    expect(main!.sink).toBe(basin);
    expect(result.newLakeCells).toContain(basin);
    expect(result.riverFlags[basin]).toBe(1);
  });

  it('remains deterministic for identical inputs', () => {
    const width = 5;
    const height = 5;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const waterLevel = 0.3;
    const elevations = buildBaseElevations(width, height);
    elevations[index(2, 1)] = 0.86;
    elevations[index(1, 2)] = 0.8;
    elevations[index(3, 2)] = 0.79;

    const controls = {
      riverCount: 2,
      minRiverLength: 2,
      headwaterBand: { min: 0.55, max: 0.9 },
      minSourceSpacing: 2,
      meanderBias: 0.6,
      flatTolerance: 3,
      tributaryDensity: 0.3,
      allowNewLakes: true,
    } as const;

    const runA = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );
    const runB = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    expect(runA.generated).toBe(runB.generated);
    expect(runA.rivers.map((r) => r.cells)).toEqual(runB.rivers.map((r) => r.cells));
    expect(Array.from(runA.riverFlags)).toEqual(Array.from(runB.riverFlags));
  });

  it('supports tributary confluences with shared downstream channels', () => {
    const width = 5;
    const height = 5;
    const mesh = createGridMesh(width, height);
    const index = (x: number, y: number) => y * width + x;
    const elevations = new Float64Array(width * height).fill(0.45);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || x === width - 1 || y === height - 1) {
          elevations[index(x, y)] = 0.1;
        }
      }
    }

    elevations[index(2, 0)] = 0.92; // block direct ocean drop above the main stem
    elevations[index(2, 1)] = 0.88; // main river headwater
    elevations[index(2, 2)] = 0.7;
    elevations[index(2, 3)] = 0.52;
    elevations[index(2, 4)] = 0.1; // shoreline sink

    elevations[index(1, 1)] = 0.9;
    elevations[index(1, 2)] = 0.81; // left tributary source
    elevations[index(1, 3)] = 0.86;
    elevations[index(0, 2)] = 0.9;

    elevations[index(3, 1)] = 0.89;
    elevations[index(3, 2)] = 0.8; // right tributary source
    elevations[index(3, 3)] = 0.85;
    elevations[index(4, 2)] = 0.88;

    const waterLevel = 0.2;
    const controls = {
      riverCount: 2,
      minRiverLength: 3,
      headwaterBand: { min: 0.2, max: 0.95 },
      minSourceSpacing: 3,
      meanderBias: 0.5,
      flatTolerance: 3,
      tributaryDensity: 1,
      allowNewLakes: true,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      waterLevel,
      controls
    );

    const primaries = result.rivers.filter((river) => !river.isTributary);
    expect(primaries.length).toBe(1);
    const tributaries = result.rivers.filter((river) => river.isTributary);
    expect(tributaries.length).toBeGreaterThan(0);

    const sharedCells = new Set<number>();
    const mainCells = primaries[0].cells;
    for (const tributary of tributaries) {
      for (const cell of tributary.cells) {
        if (mainCells.includes(cell)) {
          sharedCells.add(cell);
        }
      }
    }
    expect(sharedCells.size).toBeGreaterThan(0);
  });
});
