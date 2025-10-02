const EPSILON = 1e-6;
const DEFAULT_SEED = 90210;

export type SinkType = 'ocean' | 'lake';

export interface RiverControls {
  riverCount: number;
  /** Minimum number of cells (including mouth) that a river must traverse */
  minRiverLength?: number;
  /** When true, rivers may terminate in newly created lakes inside basins */
  allowNewLakes?: boolean;
  /** Visual minimum width at map scale */
  widthMin?: number;
  /** Visual maximum width at map scale */
  widthMax?: number;
  /** Max local variation expressed as 0.05 for ±5% */
  widthJitterPct?: number;
  /** Optional deterministic seed */
  seed?: number;
  /** Percentile band (0-1) for eligible headwaters */
  headwaterBand?: [number, number];
  /** Minimum euclidean spacing between sources */
  minSourceSpacing?: number;
  /** Elevation difference window for meander selection */
  meanderBias?: number;
  /** Maximum distance along flats before descent is required */
  flatTolerance?: number;
  /** Probability for seeding additional tributaries */
  tributaryDensity?: number;
  /** Mapping of Strahler order → width target */
  widthByOrder?: number[];
  /** Distance to ease width increases at confluences */
  widthTaper?: number;
  /** Maximum |Δw| per unit length */
  maxWidthSlope?: number;
  /** Iterations of smoothing for centerline */
  curvatureSmoothness?: number;
}

export interface RiverSample {
  /** cell that contains this sample */
  cell: number;
  /** cumulative arclength from source */
  distance: number;
  /** smoothed path coordinates */
  position: [number, number];
  /** Strahler order at this sample */
  order: number;
  /** Render width at this sample */
  width: number;
}

export interface RiverCellSpan {
  cell: number;
  start: number;
  end: number;
}

export interface RiverPath {
  /** Ordered list of cells from source (index 0) to sink (last index) */
  cells: number[];
  /** River samples for rendering and validation */
  samples: RiverSample[];
  /** Sample spans mapped to each cell index */
  spans: RiverCellSpan[];
  source: number;
  sink: number;
  sinkType: SinkType;
  length: number;
  /** Number of confluences encountered while tracing this path */
  confluences: number;
  /** True when this path joins a previously generated river network */
  isTributary: boolean;
  /** Strahler order of the downstream terminus */
  order: number;
  /** Width statistics for logging */
  widthStats: { min: number; max: number; mean: number };
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
  joinedExisting: boolean;
}

interface NodeData {
  cell: number;
  downstream: number | null;
  upstream: Set<number>;
  order: number;
}

interface HeadwaterCandidate {
  cell: number;
  score: number;
  landmass: number;
  elevation: number;
}

interface LandmassInfo {
  id: number;
  cells: number[];
  area: number;
  targetMain: number;
  selectedSources: number[];
}

interface RequiredControls {
  riverCount: number;
  minRiverLength: number;
  allowNewLakes: boolean;
  widthMin: number;
  widthMax: number;
  widthJitterPct: number;
  seed: number;
  headwaterBand: [number, number];
  minSourceSpacing: number;
  meanderBias: number;
  flatTolerance: number;
  tributaryDensity: number;
  widthByOrder: number[];
  widthTaper: number;
  maxWidthSlope: number;
  curvatureSmoothness: number;
}

interface GenerationContext {
  controls: RequiredControls;
  cellElevations: Float64Array;
  cellNeighbors: Int32Array;
  cellOffsets: Uint32Array;
  cellCenters: Float64Array;
  waterLevel: number;
  riverFlags: Uint8Array;
  downstream: Int32Array;
  nodes: Map<number, NodeData>;
  averageSpacing: number;
  cellSize: Float64Array;
  landmassByCell: Int32Array;
  rng: () => number;
}

/**
 * Generates river paths and per-cell river flags for a terrain mesh.
 */
export function generateRivers(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  cellCenters: Float64Array,
  waterLevel: number,
  controls: RiverControls
): RiverGenerationResult {
  const cellCount = cellOffsets.length - 1;
  const applied = applyControlDefaults(
    controls,
    cellCenters,
    cellOffsets,
    cellNeighbors
  );
  const rng = createDeterministicRng(applied.seed);

  const { isWater, isOcean, lakeSet } = classifyWaterBodies(
    cellElevations,
    cellNeighbors,
    cellOffsets,
    waterLevel
  );

  const riverFlags = new Uint8Array(cellCount);
  const downstream = new Int32Array(cellCount).fill(-1);

  const context: GenerationContext = {
    controls: applied,
    cellElevations,
    cellNeighbors,
    cellOffsets,
    cellCenters,
    waterLevel,
    riverFlags,
    downstream,
    nodes: new Map<number, NodeData>(),
    averageSpacing: computeAverageSpacing(cellCenters, cellOffsets, cellNeighbors),
    cellSize: computeCellSize(cellCenters, cellOffsets, cellNeighbors),
    landmassByCell: identifyLandmasses(cellElevations, cellNeighbors, cellOffsets, waterLevel),
    rng,
  };

  const landmasses = buildLandmassInfo(context);
  const candidates = identifySourceCandidates(
    context,
    isWater,
    lakeSet,
    applied.headwaterBand
  );


  const logs: string[] = [];
  const rivers: RiverPath[] = [];
  const newLakeCells: number[] = [];
  let distinctCount = 0;

  distributeTargets(landmasses, applied.riverCount);

  for (const candidate of candidates) {
    const landmass = landmasses.find((lm) => lm.id === candidate.landmass);
    if (!landmass) continue;

    if (landmass.targetMain <= landmass.selectedSources.length) {
      continue;
    }

    if (!respectSourceSpacing(candidate.cell, landmass, context)) {
      continue;
    }

    const trace = traceRiver(
      candidate.cell,
      context,
      isWater,
      isOcean,
      lakeSet
    );

    if (!trace) continue;

    if (trace.cells.length < applied.minRiverLength) {
      continue;
    }

    const path = createRiverPath(trace, candidate.cell, context, isOcean, lakeSet);
    rivers.push(path);

    landmass.selectedSources.push(candidate.cell);

    for (let i = 0; i < trace.cells.length; i++) {
      const cell = trace.cells[i];
      riverFlags[cell] = 1;
      const next = trace.cells[i + 1] ?? -1;
      downstream[cell] = next >= 0 ? next : -1;
      ensureNode(cell, context.nodes);
      if (next >= 0) {
        ensureNode(next, context.nodes);
        context.nodes.get(cell)!.downstream = next;
        context.nodes.get(next)!.upstream.add(cell);
      }
    }

    for (const lake of trace.newLakes) {
      if (!lakeSet.has(lake)) {
        lakeSet.add(lake);
        isWater[lake] = true;
      }
      if (!newLakeCells.includes(lake)) {
        newLakeCells.push(lake);
      }
    }

    if (!trace.joinedExisting) {
      distinctCount += 1;
    }

    logs.push(
      `${trace.joinedExisting ? 'Tributary' : 'River'} ${rivers.length}: source ${
        candidate.cell
      } (e=${cellElevations[candidate.cell].toFixed(3)}) length ${trace.cells.length} ` +
        `sink ${trace.sinkType} at ${trace.sinkCell} confluences ${trace.confluences}`
    );

    if (distinctCount >= applied.riverCount) {
      break;
    }
  }

  if (distinctCount < applied.riverCount) {
    logs.push(
      `Requested ${applied.riverCount} rivers but only generated ${distinctCount} due to limited valid sources.`
    );
  }

  const orderMap = computeStrahlerOrders(context.nodes);

  for (const river of rivers) {
    decorateRiverPath(river, context, orderMap);
    logs.push(
      `\tWidths: min=${river.widthStats.min.toFixed(2)} mean=${river.widthStats.mean.toFixed(
        2
      )} max=${river.widthStats.max.toFixed(2)} order=${river.order}`
    );
  }

  const summary = summarizeLandmasses(landmasses);
  for (const entry of summary) {
    logs.push(entry);
  }

  logs.push(`Mesh spacing ${context.averageSpacing.toFixed(2)}`);

  return {
    rivers,
    riverFlags,
    newLakeCells,
    requested: applied.riverCount,
    generated: distinctCount,
    logs,
  };
}

function applyControlDefaults(
  controls: RiverControls,
  cellCenters: Float64Array,
  cellOffsets: Uint32Array,
  cellNeighbors: Int32Array
): RequiredControls {
  const baseSpacing = computeAverageSpacing(cellCenters, cellOffsets, cellNeighbors) || 12;
  const defaultSpacing = baseSpacing * 1.2;
  const minSpacing = controls.minSourceSpacing ?? defaultSpacing;
  return {
    riverCount: controls.riverCount,
    minRiverLength: Math.max(2, controls.minRiverLength ?? 8),
    allowNewLakes: controls.allowNewLakes !== false,
    widthMin: controls.widthMin ?? 1.6,
    widthMax: controls.widthMax ?? 9,
    widthJitterPct: controls.widthJitterPct ?? 0.08,
    seed: controls.seed ?? DEFAULT_SEED,
    headwaterBand: controls.headwaterBand ?? [0.65, 0.93],
    minSourceSpacing: Math.max(baseSpacing, minSpacing),
    meanderBias: controls.meanderBias ?? 0.05,
    flatTolerance: controls.flatTolerance ?? baseSpacing * 3,
    tributaryDensity: controls.tributaryDensity ?? 0.4,
    widthByOrder: controls.widthByOrder ?? [1.4, 2.2, 3.3, 4.6, 5.6, 6.8],
    widthTaper: controls.widthTaper ?? baseSpacing * 2.5,
    maxWidthSlope: controls.maxWidthSlope ?? 0.06,
    curvatureSmoothness: controls.curvatureSmoothness ?? 1.0,
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

function identifyLandmasses(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  waterLevel: number
): Int32Array {
  const cellCount = cellOffsets.length - 1;
  const result = new Int32Array(cellCount).fill(-1);
  let currentId = 0;

  for (let cid = 0; cid < cellCount; cid++) {
    if (cellElevations[cid] <= waterLevel || result[cid] !== -1) continue;

    const stack = [cid];
    result[cid] = currentId;

    while (stack.length) {
      const cell = stack.pop()!;
      const start = cellOffsets[cell];
      const end = cellOffsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = cellNeighbors[i];
        if (nb < 0) continue;
        if (cellElevations[nb] <= waterLevel) continue;
        if (result[nb] !== -1) continue;
        result[nb] = currentId;
        stack.push(nb);
      }
    }

    currentId += 1;
  }

  return result;
}

function buildLandmassInfo(context: GenerationContext): LandmassInfo[] {
  const { landmassByCell } = context;
  const byMass = new Map<number, LandmassInfo>();

  for (let cid = 0; cid < landmassByCell.length; cid++) {
    const landmass = landmassByCell[cid];
    if (landmass < 0) continue;
    if (!byMass.has(landmass)) {
      byMass.set(landmass, {
        id: landmass,
        cells: [],
        area: 0,
        targetMain: 0,
        selectedSources: [],
      });
    }
    const entry = byMass.get(landmass)!;
    entry.cells.push(cid);
    entry.area += 1;
  }

  return Array.from(byMass.values()).sort((a, b) => b.area - a.area);
}

function summarizeLandmasses(landmasses: LandmassInfo[]): string[] {
  return landmasses.map((lm) => {
    const shortfall = Math.max(0, lm.targetMain - lm.selectedSources.length);
    const shortfallText = shortfall > 0 ? ` shortfall ${shortfall}` : '';
    return `Landmass ${lm.id}: cells=${lm.area} target=${lm.targetMain} actual=${lm.selectedSources.length}${shortfallText}`;
  });
}

function distributeTargets(landmasses: LandmassInfo[], desired: number): void {
  const totalArea = landmasses.reduce((sum, lm) => sum + lm.area, 0);
  if (totalArea === 0) return;

  const fractional: { id: number; base: number; fraction: number }[] = [];
  let sumFloor = 0;

  for (const lm of landmasses) {
    const raw = (lm.area / totalArea) * desired;
    const base = Math.floor(raw);
    lm.targetMain = base;
    sumFloor += base;
    fractional.push({ id: lm.id, base, fraction: raw - base });
  }

  let remainder = desired - sumFloor;
  fractional.sort((a, b) => b.fraction - a.fraction);
  for (const entry of fractional) {
    if (remainder <= 0) break;
    const lm = landmasses.find((l) => l.id === entry.id);
    if (!lm) continue;
    lm.targetMain += 1;
    remainder -= 1;
  }

  if (landmasses.length && landmasses[0].targetMain === 0 && desired > 0) {
    landmasses[0].targetMain = 1;
  }
}

function respectSourceSpacing(cell: number, landmass: LandmassInfo, context: GenerationContext): boolean {
  const { controls, cellCenters } = context;
  const cx = cellCenters[cell * 2];
  const cy = cellCenters[cell * 2 + 1];
  for (const existing of landmass.selectedSources) {
    const ex = cellCenters[existing * 2];
    const ey = cellCenters[existing * 2 + 1];
    const dist = Math.hypot(cx - ex, cy - ey);
    if (dist < controls.minSourceSpacing) {
      return false;
    }
  }
  return true;
}

function identifySourceCandidates(
  context: GenerationContext,
  isWater: boolean[],
  lakeSet: Set<number>,
  headwaterBand: [number, number]
): HeadwaterCandidate[] {
  const { cellElevations, cellOffsets, cellNeighbors, waterLevel, landmassByCell, cellCenters } = context;
  const cellCount = cellOffsets.length - 1;
  const landElevations: number[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (cellElevations[cid] > waterLevel) {
      landElevations.push(cellElevations[cid]);
    }
  }

  const lower = percentile(landElevations, headwaterBand[0]);
  const upper = percentile(landElevations, headwaterBand[1]);

  const curvatureValues: number[] = [];
  const concavity: number[] = new Array(cellCount).fill(0);

  for (let cid = 0; cid < cellCount; cid++) {
    if (cellElevations[cid] <= waterLevel || isWater[cid]) continue;
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    let sum = 0;
    let count = 0;
    let maxNeighbor = -Infinity;
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      sum += cellElevations[nb];
      count += 1;
      if (cellElevations[nb] > maxNeighbor) {
        maxNeighbor = cellElevations[nb];
      }
    }
    if (count === 0) continue;
    const avg = sum / count;
    const curve = avg - cellElevations[cid];
    concavity[cid] = curve;
    curvatureValues.push(curve);
  }

  const curvatureLower = Math.min(...curvatureValues);
  const curvatureUpper = Math.max(...curvatureValues);

  const candidates: HeadwaterCandidate[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (cellElevations[cid] <= waterLevel || isWater[cid]) continue;
    const elevation = cellElevations[cid];
    if (elevation < lower || elevation > upper) continue;
    const landmass = landmassByCell[cid];
    if (landmass < 0) continue;

    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    let isPeak = true;
    let neighborCount = 0;
    let hasHigherNeighbor = false;
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      neighborCount += 1;
      if (cellElevations[nb] >= elevation - EPSILON) {
        isPeak = false;
      }
      if (cellElevations[nb] > elevation + EPSILON) {
        hasHigherNeighbor = true;
      }
    }

    if (isPeak) continue;
    if (!hasHigherNeighbor && neighborCount > 0) continue;

    const curvature = concavity[cid];
    const curvatureScore = normalize(curvature, curvatureLower, curvatureUpper);
    const elevScore = normalize(elevation, lower, upper);
    let score = elevScore * 0.6 + curvatureScore * 0.4;

    if (adjacentToLake(cid, lakeSet, cellOffsets, cellNeighbors)) {
      score += 0.1;
    }

    const jitter = hashNoise(context.controls.seed, cid) * 0.05;
    score += jitter;

    candidates.push({ cell: cid, score, landmass, elevation });
  }

  candidates.sort((a, b) => b.score - a.score);

  // ensure spacing by jittering centerlines slightly to avoid clustering
  const accepted: HeadwaterCandidate[] = [];
  for (const candidate of candidates) {
    const { cell } = candidate;
    const cx = cellCenters[cell * 2];
    const cy = cellCenters[cell * 2 + 1];
    let tooClose = false;
    for (const existing of accepted) {
      if (existing.landmass !== candidate.landmass) continue;
      const ex = cellCenters[existing.cell * 2];
      const ey = cellCenters[existing.cell * 2 + 1];
      if (Math.hypot(cx - ex, cy - ey) < context.controls.minSourceSpacing * 0.5) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      accepted.push(candidate);
    }
  }

  return accepted;
}

function adjacentToLake(
  cell: number,
  lakeSet: Set<number>,
  cellOffsets: Uint32Array,
  cellNeighbors: Int32Array
): boolean {
  const start = cellOffsets[cell];
  const end = cellOffsets[cell + 1];
  for (let i = start; i < end; i++) {
    const nb = cellNeighbors[i];
    if (nb >= 0 && lakeSet.has(nb)) {
      return true;
    }
  }
  return false;
}

function traceRiver(
  source: number,
  context: GenerationContext,
  isWater: boolean[],
  isOcean: boolean[],
  lakeSet: Set<number>
): TraceResult | null {
  const {
    cellElevations,
    cellNeighbors,
    cellOffsets,
    controls,
    cellCenters,
    riverFlags,
    downstream,
    averageSpacing,
    rng,
  } = context;

  const path: number[] = [source];
  const visited = new Set<number>([source]);
  let current = source;
  let confluences = 0;
  let flatDistance = 0;
  let previousDirection: [number, number] | null = null;

  while (true) {
    const currentElevation = cellElevations[current];
    const start = cellOffsets[current];
    const end = cellOffsets[current + 1];

    const candidates: {
      cell: number;
      elevation: number;
      distance: number;
      direction: [number, number];
      isExistingRiver: boolean;
    }[] = [];

    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      const elevation = cellElevations[nb];
      if (elevation > currentElevation + EPSILON) {
        continue;
      }
      const dx = cellCenters[nb * 2] - cellCenters[current * 2];
      const dy = cellCenters[nb * 2 + 1] - cellCenters[current * 2 + 1];
      const distance = Math.hypot(dx, dy);
      if (distance < EPSILON) continue;
      const direction: [number, number] = [dx / distance, dy / distance];
      const isExistingRiver = riverFlags[nb] === 1;
      candidates.push({ cell: nb, elevation, distance, direction, isExistingRiver });
    }

    if (candidates.length === 0) {
      if (!controls.allowNewLakes) return null;
      return {
        cells: [...path],
        sinkCell: current,
        sinkType: 'lake',
        confluences,
        newLakes: [current],
        joinedExisting: false,
      };
    }

    candidates.sort((a, b) => a.elevation - b.elevation);
    const bestElevation = candidates[0].elevation;
    const elevationWindow = controls.meanderBias * (1 - controls.headwaterBand[0]);
    const threshold = bestElevation + elevationWindow;
    const viable = candidates.filter((c) => c.elevation <= threshold + EPSILON);

    let nextChoice: typeof candidates[number] | undefined;

    if (viable.length > 1 && previousDirection) {
      viable.sort((a, b) => {
        const ad = 1 - Math.abs(dot(previousDirection!, a.direction));
        const bd = 1 - Math.abs(dot(previousDirection!, b.direction));
        if (Math.abs(a.elevation - b.elevation) > 1e-4) {
          return a.elevation - b.elevation;
        }
        if (Math.abs(ad - bd) > 1e-4) {
          return bd - ad;
        }
        return a.distance - b.distance;
      });
      nextChoice = viable[0];
    } else {
      const top = viable.filter((c) => Math.abs(c.elevation - bestElevation) < 1e-5);
      if (top.length > 1) {
        top.sort((a, b) => a.distance - b.distance);
        nextChoice = top[Math.floor(rng() * top.length) % top.length];
      } else {
        nextChoice = candidates[0];
      }
    }

    if (!nextChoice) {
      nextChoice = candidates[0];
    }

    if (visited.has(nextChoice.cell)) {
      const alternative = candidates.find((c) => !visited.has(c.cell));
      if (!alternative) {
        if (!controls.allowNewLakes) return null;
        return {
          cells: [...path],
          sinkCell: current,
          sinkType: 'lake',
          confluences,
          newLakes: [current],
          joinedExisting: false,
        };
      }
      nextChoice = alternative;
    }

    const drop = currentElevation - nextChoice.elevation;
    if (drop < EPSILON) {
      flatDistance += nextChoice.distance;
      if (flatDistance > controls.flatTolerance) {
        const descending = candidates.find((c) => currentElevation - c.elevation > EPSILON);
        if (descending) {
          nextChoice = descending;
        }
      }
    } else {
      flatDistance = 0;
    }

    path.push(nextChoice.cell);
    visited.add(nextChoice.cell);

    if (nextChoice.isExistingRiver) {
      if (cellElevations[nextChoice.cell] > currentElevation + EPSILON) {
        return null;
      }
      confluences += 1;
      const downstreamPath = collectDownstream(nextChoice.cell, downstream);
      const sinkCell = downstreamPath.length
        ? downstreamPath[downstreamPath.length - 1]
        : nextChoice.cell;
      return {
        cells: [...path, ...downstreamPath],
        sinkCell,
        sinkType: determineSinkType(nextChoice.cell, downstreamPath, isOcean, lakeSet),
        confluences,
        newLakes: [],
        joinedExisting: true,
      };
    }

    if (isWater[nextChoice.cell] || lakeSet.has(nextChoice.cell)) {
      return {
        cells: [...path],
        sinkCell: nextChoice.cell,
        sinkType: isOcean[nextChoice.cell] ? 'ocean' : 'lake',
        confluences,
        newLakes: [],
        joinedExisting: false,
      };
    }

    previousDirection = nextChoice.direction;
    current = nextChoice.cell;
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

function createRiverPath(
  trace: TraceResult,
  source: number,
  context: GenerationContext,
  isOcean: boolean[],
  lakeSet: Set<number>
): RiverPath {
  const { cellCenters } = context;
  const cells = trace.cells.slice();
  const samples: RiverSample[] = [];
  const spans: RiverCellSpan[] = [];
  const start: RiverSample = {
    cell: cells[0],
    distance: 0,
    position: [cellCenters[cells[0] * 2], cellCenters[cells[0] * 2 + 1]],
    order: 1,
    width: context.controls.widthMin,
  };
  samples.push(start);
  spans.push({ cell: cells[0], start: 0, end: 1 });

  for (let i = 0; i < cells.length - 1; i++) {
    const current = cells[i];
    const next = cells[i + 1];
    const currentCenter: [number, number] = [
      cellCenters[current * 2],
      cellCenters[current * 2 + 1],
    ];
    const nextCenter: [number, number] = [
      cellCenters[next * 2],
      cellCenters[next * 2 + 1],
    ];
    const exitPoint = lerp(currentCenter, nextCenter, 0.55);
    const entryPoint = lerp(currentCenter, nextCenter, 0.45);

    addSample(samples, spans, current, exitPoint);
    addSample(samples, spans, next, entryPoint);
    addSample(samples, spans, next, nextCenter);
  }

  const sinkCell = cells[cells.length - 1];
  const sinkType = trace.sinkType;

  return {
    cells,
    samples,
    spans,
    source,
    sink: sinkCell,
    sinkType,
    length: cells.length,
    confluences: trace.confluences,
    isTributary: trace.joinedExisting,
    order: 1,
    widthStats: { min: context.controls.widthMin, max: context.controls.widthMin, mean: context.controls.widthMin },
  };
}

function addSample(samples: RiverSample[], spans: RiverCellSpan[], cell: number, position: [number, number]) {
  const previous = samples[samples.length - 1];
  const distance = previous
    ? previous.distance + Math.hypot(position[0] - previous.position[0], position[1] - previous.position[1])
    : 0;
  const sample: RiverSample = {
    cell,
    distance,
    position,
    order: 1,
    width: 0,
  };
  samples.push(sample);

  const lastSpan = spans[spans.length - 1];
  if (lastSpan && lastSpan.cell === cell) {
    lastSpan.end = samples.length;
  } else {
    spans.push({ cell, start: samples.length - 1, end: samples.length });
  }
}

function ensureNode(cell: number, nodes: Map<number, NodeData>): void {
  if (!nodes.has(cell)) {
    nodes.set(cell, { cell, downstream: null, upstream: new Set(), order: 1 });
  }
}

function computeStrahlerOrders(nodes: Map<number, NodeData>): Map<number, number> {
  const orderMap = new Map<number, number>();

  const getOrder = (cell: number): number => {
    if (orderMap.has(cell)) {
      return orderMap.get(cell)!;
    }
    const node = nodes.get(cell);
    if (!node) {
      orderMap.set(cell, 1);
      return 1;
    }
    if (node.upstream.size === 0) {
      orderMap.set(cell, 1);
      return 1;
    }
    const upstreamOrders = Array.from(node.upstream).map((up) => getOrder(up));
    const maxOrder = Math.max(...upstreamOrders);
    const countMax = upstreamOrders.filter((value) => value === maxOrder).length;
    const order = countMax >= 2 ? maxOrder + 1 : maxOrder;
    orderMap.set(cell, order);
    return order;
  };

  for (const cell of nodes.keys()) {
    getOrder(cell);
  }

  return orderMap;
}

function decorateRiverPath(
  river: RiverPath,
  context: GenerationContext,
  orderMap: Map<number, number>
): void {
  const { controls, cellSize } = context;
  const { samples, cells } = river;
  if (samples.length === 0) return;

  const widths = new Float64Array(samples.length);
  const orders = new Int32Array(samples.length);
  const distances = new Float64Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    distances[i] = i === 0 ? 0 : distances[i - 1] + Math.hypot(
      samples[i].position[0] - samples[i - 1].position[0],
      samples[i].position[1] - samples[i - 1].position[1]
    );
  }

  const widthTargets = controls.widthByOrder.slice();
  const widthMin = controls.widthMin;
  const widthMax = controls.widthMax;

  const orderAtCell = new Map<number, number>();
  for (const cell of cells) {
    const order = orderMap.get(cell) ?? 1;
    orderAtCell.set(cell, order);
  }

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const order = orderAtCell.get(sample.cell) ?? 1;
    orders[i] = order;
    const target = widthTargets[Math.min(order - 1, widthTargets.length - 1)];
    widths[i] = clamp(target, widthMin, widthMax);
  }

  for (let i = 1; i < widths.length; i++) {
    if (widths[i] < widths[i - 1]) {
      widths[i] = widths[i - 1];
    }
  }

  const taper = Math.max(controls.widthTaper, 1);
  for (let i = 1; i < widths.length; i++) {
    if (orders[i] > orders[i - 1]) {
      const startWidth = widths[i - 1];
      const targetWidth = widths[i];
      const delta = targetWidth - startWidth;
      const startDistance = distances[i];
      for (let j = i; j < widths.length; j++) {
        const t = clamp((distances[j] - startDistance) / taper, 0, 1);
        const eased = startWidth + delta * t;
        widths[j] = Math.max(widths[j], eased);
      }
    }
  }

  const jitterPct = controls.widthJitterPct;
  for (let i = 0; i < widths.length; i++) {
    const noise = hashNoise(controls.seed, river.cells[0] * 131 + i * 17) * 2 - 1;
    const variation = 1 + noise * jitterPct;
    widths[i] *= variation;
  }

  for (let i = 1; i < widths.length; i++) {
    if (widths[i] < widths[i - 1] * (1 - jitterPct)) {
      widths[i] = widths[i - 1] * (1 - jitterPct);
    }
  }

  const slopeLimit = controls.maxWidthSlope;
  for (let i = 1; i < widths.length; i++) {
    const deltaWidth = widths[i] - widths[i - 1];
    const deltaDistance = Math.max(distances[i] - distances[i - 1], 1e-6);
    const maxDelta = slopeLimit * deltaDistance;
    if (deltaWidth > maxDelta) {
      widths[i] = widths[i - 1] + maxDelta;
    }
  }

  for (let i = 0; i < widths.length; i++) {
    const limit = Math.min(widthMax, cellSize[samples[i].cell] * 0.9);
    widths[i] = clamp(widths[i], widthMin, limit);
  }

  let sumWidth = 0;
  let minWidth = Number.POSITIVE_INFINITY;
  let maxWidth = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < samples.length; i++) {
    samples[i].order = orders[i];
    samples[i].width = widths[i];
    sumWidth += widths[i];
    if (widths[i] < minWidth) minWidth = widths[i];
    if (widths[i] > maxWidth) maxWidth = widths[i];
  }

  river.order = orders[samples.length - 1];
  river.widthStats = {
    min: minWidth,
    max: maxWidth,
    mean: sumWidth / samples.length,
  };
}

function computeAverageSpacing(
  cellCenters: Float64Array,
  cellOffsets: Uint32Array,
  cellNeighbors: Int32Array
): number {
  const cellCount = cellOffsets.length - 1;
  let total = 0;
  let count = 0;
  for (let cid = 0; cid < cellCount; cid++) {
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb <= cid || nb < 0) continue;
      const dx = cellCenters[cid * 2] - cellCenters[nb * 2];
      const dy = cellCenters[cid * 2 + 1] - cellCenters[nb * 2 + 1];
      total += Math.hypot(dx, dy);
      count += 1;
    }
  }
  return count > 0 ? total / count : 10;
}

function computeCellSize(
  cellCenters: Float64Array,
  cellOffsets: Uint32Array,
  cellNeighbors: Int32Array
): Float64Array {
  const cellCount = cellOffsets.length - 1;
  const sizes = new Float64Array(cellCount).fill(8);
  for (let cid = 0; cid < cellCount; cid++) {
    let minDistance = Number.POSITIVE_INFINITY;
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      const dx = cellCenters[cid * 2] - cellCenters[nb * 2];
      const dy = cellCenters[cid * 2 + 1] - cellCenters[nb * 2 + 1];
      const d = Math.hypot(dx, dy);
      if (d > EPSILON && d < minDistance) {
        minDistance = d;
      }
    }
    if (minDistance < Number.POSITIVE_INFINITY) {
      sizes[cid] = minDistance;
    }
  }
  return sizes;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)));
  return sorted[index];
}

function normalize(value: number, min: number, max: number): number {
  if (max - min < EPSILON) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashNoise(seed: number, value: number): number {
  let x = (seed ^ value) >>> 0;
  x = Math.imul(x ^ (x >> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >> 15), 0x846ca68b);
  x ^= x >> 16;
  return (x >>> 0) / 4294967295;
}

function dot(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}
