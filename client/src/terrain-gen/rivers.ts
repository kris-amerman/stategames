const EPSILON = 1e-6;

export type SinkType = 'ocean' | 'lake';

export interface RiverControls {
  riverCount: number;
  /** Minimum number of cells (including mouth) that a river must traverse */
  minRiverLength?: number;
  /** When true, rivers may terminate in newly created lakes inside basins */
  allowNewLakes?: boolean;
}

export interface RiverPath {
  /** Ordered list of cells from source (index 0) to sink (last index) */
  cells: number[];
  source: number;
  sink: number;
  sinkType: SinkType;
  length: number;
  /** Number of confluences encountered while tracing this path */
  confluences: number;
}

export interface RiverGenerationResult {
  rivers: RiverPath[];
  /** Boolean flags for every cell indicating the presence of a river */
  riverFlags: Uint8Array;
  /** Cells that were designated as new inland lakes to terminate rivers */
  newLakeCells: number[];
  requested: number;
  generated: number;
  logs: string[];
}

interface WaterBodies {
  isWater: boolean[];
  isOcean: boolean[];
  lakeSet: Set<number>;
}

interface TraceResult {
  cells: number[];
  sinkCell: number;
  sinkType: SinkType;
  confluences: number;
  newLakes: number[];
}

/**
 * Generates river paths and per-cell river flags for a terrain mesh.
 */
export function generateRivers(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  waterLevel: number,
  controls: RiverControls
): RiverGenerationResult {
  const cellCount = cellOffsets.length - 1;
  const { isWater, isOcean, lakeSet } = classifyWaterBodies(
    cellElevations,
    cellNeighbors,
    cellOffsets,
    waterLevel
  );

  const riverFlags = new Uint8Array(cellCount);
  const rivers: RiverPath[] = [];
  const logs: string[] = [];
  const newLakeCells: number[] = [];
  const downstream = new Int32Array(cellCount).fill(-1);

  const minRiverLength = Math.max(2, controls.minRiverLength ?? 6);
  const allowNewLakes = controls.allowNewLakes !== false;

  const sourceCandidates = identifySourceCandidates(
    cellElevations,
    cellNeighbors,
    cellOffsets,
    isWater,
    waterLevel
  );

  for (const candidate of sourceCandidates) {
    if (rivers.length >= controls.riverCount) break;
    if (riverFlags[candidate] === 1) continue;

    const trace = traceRiver(
      candidate,
      cellElevations,
      cellNeighbors,
      cellOffsets,
      isWater,
      isOcean,
      riverFlags,
      lakeSet,
      downstream,
      allowNewLakes
    );

    if (!trace) continue;

    if (trace.cells.length < minRiverLength) {
      continue;
    }

    rivers.push({
      cells: trace.cells.slice(),
      source: candidate,
      sink: trace.sinkCell,
      sinkType: trace.sinkType,
      length: trace.cells.length,
      confluences: trace.confluences,
    });

    for (let i = 0; i < trace.cells.length; i++) {
      const cell = trace.cells[i];
      riverFlags[cell] = 1;
      const next = trace.cells[i + 1] ?? -1;
      downstream[cell] = next ?? -1;
    }

    if (trace.newLakes.length) {
      for (const lake of trace.newLakes) {
        if (!lakeSet.has(lake)) {
          lakeSet.add(lake);
          isWater[lake] = true;
        }
        if (!newLakeCells.includes(lake)) {
          newLakeCells.push(lake);
        }
      }
    }

    const elevation = cellElevations[candidate];
    logs.push(
      `River ${rivers.length}: source ${candidate} (e=${elevation.toFixed(3)}) length ${trace.cells.length} ` +
        `sink ${trace.sinkType} at ${trace.sinkCell} confluences ${trace.confluences}`
    );
  }

  if (rivers.length < controls.riverCount) {
    logs.push(
      `Requested ${controls.riverCount} rivers but only generated ${rivers.length} due to limited valid sources.`
    );
  }

  return {
    rivers,
    riverFlags,
    newLakeCells,
    requested: controls.riverCount,
    generated: rivers.length,
    logs,
  };
}

function classifyWaterBodies(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  waterLevel: number
): WaterBodies {
  const cellCount = cellOffsets.length - 1;
  const isWater = new Array<boolean>(cellCount).fill(false);
  const isOcean = new Array<boolean>(cellCount).fill(false);
  const visited = new Array<boolean>(cellCount).fill(false);

  for (let cid = 0; cid < cellCount; cid++) {
    if (cellElevations[cid] <= waterLevel) {
      isWater[cid] = true;
    }
  }

  const queue: number[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (!isWater[cid]) continue;
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    for (let i = start; i < end; i++) {
      if (cellNeighbors[i] === -1) {
        queue.push(cid);
        visited[cid] = true;
        isOcean[cid] = true;
        break;
      }
    }
  }

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const start = cellOffsets[cell];
    const end = cellOffsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (!isWater[nb] || visited[nb]) continue;
      visited[nb] = true;
      isOcean[nb] = true;
      queue.push(nb);
    }
  }

  const lakeSet = new Set<number>();
  for (let cid = 0; cid < cellCount; cid++) {
    if (isWater[cid] && !isOcean[cid]) {
      lakeSet.add(cid);
    }
  }

  return { isWater, isOcean, lakeSet };
}

function identifySourceCandidates(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  waterLevel: number
): number[] {
  const cellCount = cellOffsets.length - 1;
  const candidates: number[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (isWater[cid]) continue;
    const neighborhood: number[] = [cellElevations[cid]];
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      neighborhood.push(cellElevations[nb]);
    }

    if (neighborhood.length <= 1) continue;

    const median = computeMedian(neighborhood);
    if (cellElevations[cid] <= median + EPSILON) continue;
    if (cellElevations[cid] <= waterLevel + 0.05) continue;

    candidates.push(cid);
  }

  candidates.sort((a, b) => {
    const da = cellElevations[a];
    const db = cellElevations[b];
    if (da !== db) return db - da;
    return a - b;
  });

  return candidates;
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function traceRiver(
  source: number,
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  isOcean: boolean[],
  riverFlags: Uint8Array,
  lakeSet: Set<number>,
  downstream: Int32Array,
  allowNewLakes: boolean
): TraceResult | null {
  const path: number[] = [source];
  const visited = new Set<number>([source]);
  let current = source;
  let confluences = 0;

  while (true) {
    const currentElevation = cellElevations[current];
    const start = cellOffsets[current];
    const end = cellOffsets[current + 1];

    const downhill: number[] = [];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (cellElevations[nb] <= currentElevation + EPSILON) {
        downhill.push(nb);
      }
    }

    downhill.sort((a, b) => {
      const ea = cellElevations[a];
      const eb = cellElevations[b];
      if (Math.abs(ea - eb) > EPSILON) return ea - eb;
      return a - b;
    });

    const riverNeighbor = downhill.find((nb) => riverFlags[nb] === 1);
    if (riverNeighbor !== undefined) {
      if (cellElevations[riverNeighbor] > currentElevation + EPSILON) {
        return null;
      }
      confluences += 1;
      const downstreamPath = collectDownstream(riverNeighbor, downstream);
      return {
        cells: [...path, riverNeighbor, ...downstreamPath],
        sinkCell: downstreamPath.length
          ? downstreamPath[downstreamPath.length - 1]
          : riverNeighbor,
        sinkType: determineSinkType(
          riverNeighbor,
          downstreamPath,
          isOcean,
          lakeSet
        ),
        confluences,
        newLakes: [],
      };
    }

    let next: number | undefined;
    for (const candidate of downhill) {
      if (!visited.has(candidate)) {
        next = candidate;
        break;
      }
    }

    if (next === undefined) {
      if (!allowNewLakes) return null;
      return {
        cells: [...path],
        sinkCell: current,
        sinkType: 'lake',
        confluences,
        newLakes: [current],
      };
    }

    const nextElevation = cellElevations[next];
    if (nextElevation > currentElevation + EPSILON) {
      if (!allowNewLakes) return null;
      return {
        cells: [...path],
        sinkCell: current,
        sinkType: 'lake',
        confluences,
        newLakes: [current],
      };
    }

    path.push(next);

    if (isWater[next] || lakeSet.has(next)) {
      return {
        cells: [...path],
        sinkCell: next,
        sinkType: isOcean[next] ? 'ocean' : 'lake',
        confluences,
        newLakes: [],
      };
    }

    visited.add(next);
    current = next;
  }
}

function collectDownstream(cell: number, downstream: Int32Array): number[] {
  const path: number[] = [];
  let current = cell;
  const seen = new Set<number>();

  while (true) {
    const next = downstream[current];
    if (next === -1 || next === undefined) break;
    if (seen.has(next)) break;
    path.push(next);
    seen.add(next);
    current = next;
  }

  return path;
}

function determineSinkType(
  mergeCell: number,
  downstreamPath: number[],
  isOcean: boolean[],
  lakeSet: Set<number>
): SinkType {
  if (downstreamPath.length === 0) {
    return isOcean[mergeCell] ? 'ocean' : 'lake';
  }
  const terminal = downstreamPath[downstreamPath.length - 1];
  if (isOcean[terminal]) return 'ocean';
  if (lakeSet.has(terminal)) return 'lake';
  return lakeSet.has(mergeCell) ? 'lake' : 'ocean';
}
