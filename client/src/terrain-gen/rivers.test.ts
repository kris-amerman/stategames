import { describe, expect, it } from 'vitest';
import { generateRivers } from './rivers';

interface GridMesh {
  offsets: Uint32Array;
  neighbors: Int32Array;
  centers: Float64Array;
}

function createGridMesh(width: number, height: number): GridMesh {
  const cellCount = width * height;
  const neighbors: number[] = [];
  const offsets = new Uint32Array(cellCount + 1);
  const centers = new Float64Array(cellCount * 2);

  const index = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cid = index(x, y);
      offsets[cid] = neighbors.length;

      centers[cid * 2] = x * 10 + 5;
      centers[cid * 2 + 1] = y * 10 + 5;

      neighbors.push(y > 0 ? index(x, y - 1) : -1);
      neighbors.push(y < height - 1 ? index(x, y + 1) : -1);
      neighbors.push(x > 0 ? index(x - 1, y) : -1);
      neighbors.push(x < width - 1 ? index(x + 1, y) : -1);
    }
  }

  offsets[cellCount] = neighbors.length;
  return { offsets, neighbors: Int32Array.from(neighbors), centers };
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

    const controls = {
      riverCount: 2,
      minRiverLength: 2,
      widthMin: 1.3,
      widthMax: 3.8,
      widthByOrder: [1.3, 2.0, 3.2],
      widthTaper: 12,
      maxWidthSlope: 0.25,
      widthJitterPct: 0.08,
    } as const;

    const result = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      mesh.centers,
      waterLevel,
      controls
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
      expect(sourceElevation).toBeLessThanOrEqual(median + 1e-6);

      expect(river.samples.length).toBeGreaterThan(river.cells.length);
      for (const sample of river.samples) {
        expect(sample.width).toBeGreaterThanOrEqual(controls.widthMin);
        expect(sample.width).toBeLessThanOrEqual(controls.widthMax);
      }
      for (let i = 1; i < river.samples.length; i++) {
        const prev = river.samples[i - 1];
        const curr = river.samples[i];
        const allowedDrop = prev.width * controls.widthJitterPct;
        expect(curr.width + allowedDrop + 1e-3).toBeGreaterThanOrEqual(prev.width);
        const distance = Math.max(1e-6, curr.distance - prev.distance);
        expect(Math.abs(curr.width - prev.width)).toBeLessThanOrEqual(
          controls.maxWidthSlope * distance + 1e-3
        );
      }

      const firstSpan = river.spans.find((span) => span.end - span.start > 1);
      if (firstSpan) {
        expect(firstSpan.end - firstSpan.start).toBeGreaterThan(1);
      }

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
      mesh.centers,
      waterLevel,
      { riverCount: 2, minRiverLength: 2 }
    );
    const runB = generateRivers(
      elevations,
      mesh.neighbors,
      mesh.offsets,
      mesh.centers,
      waterLevel,
      { riverCount: 2, minRiverLength: 2 }
    );

    expect(runA.generated).toBe(runB.generated);
    expect(runA.rivers.map((r) => r.cells)).toEqual(runB.rivers.map((r) => r.cells));
    expect(Array.from(runA.riverFlags)).toEqual(Array.from(runB.riverFlags));
  });

  it('produces tributaries that join a main stem', () => {
    const widthC = 6;
    const heightC = 6;
    const meshC = createGridMesh(widthC, heightC);
    const indexC = (x: number, y: number) => y * widthC + x;
    const elevations = new Float64Array(widthC * heightC).fill(0.5);

    const waterLevel = 0.3;

    for (let x = 0; x < widthC; x++) {
      elevations[indexC(x, 0)] = 0.88;
      elevations[indexC(x, heightC - 1)] = 0.05;
    }
    for (let y = 0; y < heightC; y++) {
      elevations[indexC(0, y)] = Math.max(0.55, elevations[indexC(0, y)]);
      elevations[indexC(widthC - 1, y)] = Math.max(0.55, elevations[indexC(widthC - 1, y)]);
    }

    elevations[indexC(2, 1)] = 0.78;
    elevations[indexC(3, 1)] = 0.79;
    elevations[indexC(2, 0)] = 0.86;
    elevations[indexC(3, 0)] = 0.87;
    elevations[indexC(1, 1)] = 0.82;
    elevations[indexC(4, 1)] = 0.83;
    elevations[indexC(2, 2)] = 0.68;
    elevations[indexC(3, 2)] = 0.62;
    elevations[indexC(2, 3)] = 0.58;
    elevations[indexC(3, 3)] = 0.46;
    elevations[indexC(3, 4)] = 0.32;
    elevations[indexC(3, 5)] = 0.05;
    elevations[indexC(2, 4)] = 0.28;
    elevations[indexC(4, 2)] = 0.72;
    elevations[indexC(1, 2)] = 0.72;

    const result = generateRivers(
      elevations,
      meshC.neighbors,
      meshC.offsets,
      meshC.centers,
      waterLevel,
      { riverCount: 2, minRiverLength: 3 }
    );

    const mainRivers = result.rivers.filter((river) => !river.isTributary);
    expect(mainRivers.length).toBeGreaterThan(0);
    const tributaries = result.rivers.filter((river) => river.isTributary);
    expect(tributaries.length).toBeGreaterThan(0);

    const main = mainRivers[0];
    const shared = new Set<number>();
    for (const tributary of tributaries) {
      for (const cell of tributary.cells) {
        if (main.cells.includes(cell)) {
          shared.add(cell);
        }
      }
    }
    expect(shared.size).toBeGreaterThan(0);
    expect(result.logs.some((log) => log.includes('source'))).toBe(true);
  });
});
