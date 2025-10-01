const EPSILON = 1e-6;

export type SinkType = 'ocean' | 'lake';

export interface HeadwaterBand {
  /** Lower bound percentile (0-1) for eligible headwater elevations */
  min: number;
  /** Upper bound percentile (0-1) for eligible headwater elevations */
  max: number;
}

export interface RiverControls {
  riverCount: number;
  /** Minimum number of cells (including mouth) that a river must traverse */
  minRiverLength?: number;
  /** When true, rivers may terminate in newly created lakes inside basins */
  allowNewLakes?: boolean;
  /** Percentile band used to select headwater elevations */
  headwaterBand?: HeadwaterBand;
  /** Minimum graph distance between distinct river sources */
  minSourceSpacing?: number;
  /** Bias in [0,1] controlling preference for gentle meanders on flats */
  meanderBias?: number;
  /** Number of consecutive flat steps permitted before requiring descent */
  flatTolerance?: number;
  /** Relative density of seeded tributaries along main stems */
  tributaryDensity?: number;
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
  /** True when this path joins a previously generated river network */
  isTributary: boolean;
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

interface SourceCandidate {
  cell: number;
  elevation: number;
  component: number;
  concavity: number;
  lowerNeighbors: number;
  adjacentLake: boolean;
  score: number;
}

interface LandmassInfo {
  componentByCell: Int32Array;
  componentAreas: number[];
  componentCount: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
  const coastDistances = computeCoastDistances(
    isWater,
    isOcean,
    cellNeighbors,
    cellOffsets
  );
  const lakeOutlets = computeLakeOutlets(
    cellElevations,
    cellNeighbors,
    cellOffsets,
    isWater,
    isOcean,
    lakeSet
  );

  const riverFlags = new Uint8Array(cellCount);
  const rivers: RiverPath[] = [];
  const logs: string[] = [];
  const newLakeCells: number[] = [];
  const downstream = new Int32Array(cellCount).fill(-1);
  let distinctCount = 0;

  const minRiverLength = Math.max(2, controls.minRiverLength ?? 6);
  const allowNewLakes = controls.allowNewLakes !== false;
  const headwaterBand = normalizeHeadwaterBand(controls.headwaterBand);
  const minSourceSpacing = Math.max(1, Math.floor(controls.minSourceSpacing ?? 12));
  const meanderBias = clamp01(controls.meanderBias ?? 0.6);
  const flatTolerance = Math.max(0, Math.floor(controls.flatTolerance ?? 3));
  const tributaryDensity = clamp01(controls.tributaryDensity ?? 0.45);

  const landInfo = labelLandmasses(isWater, cellNeighbors, cellOffsets);
  const { minElevation: headwaterMin, maxElevation: headwaterMax } =
    computeHeadwaterElevationBand(cellElevations, isWater, headwaterBand);

  const sourceCandidates = identifySourceCandidates(
    cellElevations,
    cellNeighbors,
    cellOffsets,
    isWater,
    isOcean,
    waterLevel,
    landInfo,
    headwaterMin,
    headwaterMax
  );


  const primarySources = selectPrimarySources(
    sourceCandidates,
    landInfo,
    controls.riverCount,
    minSourceSpacing,
    cellNeighbors,
    cellOffsets,
    isWater,
    isOcean,
    logs
  );

  const candidateOrder = buildCandidateOrder(primarySources, sourceCandidates, tributaryDensity);

  for (const candidate of candidateOrder) {
    if (distinctCount >= controls.riverCount) break;
    if (riverFlags[candidate.cell] === 1) continue;

    const trace = traceRiver(
      candidate.cell,
      cellElevations,
      cellNeighbors,
      cellOffsets,
      isWater,
      isOcean,
      riverFlags,
      lakeSet,
      downstream,
      allowNewLakes,
      meanderBias,
      flatTolerance,
      coastDistances,
      lakeOutlets
    );

    if (!trace) continue;

    if (trace.cells.length < minRiverLength) {
      continue;
    }

    const isTributary = trace.joinedExisting;

    rivers.push({
      cells: trace.cells.slice(),
      source: candidate.cell,
      sink: trace.sinkCell,
      sinkType: trace.sinkType,
      length: trace.cells.length,
      confluences: trace.confluences,
      isTributary,
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

    if (!isTributary) {
      distinctCount += 1;
    }

    const elevation = cellElevations[candidate.cell];
    const label = isTributary ? 'Tributary' : 'River';
    logs.push(
      `${label} ${rivers.length}: source ${candidate.cell} (e=${elevation.toFixed(3)}) length ${trace.cells.length} ` +
        `sink ${trace.sinkType} at ${trace.sinkCell} confluences ${trace.confluences}`
    );
  }

  if (distinctCount < controls.riverCount) {
    logs.push(
      `Requested ${controls.riverCount} rivers but only generated ${distinctCount} due to limited valid sources.`
    );
  }

  return {
    rivers,
    riverFlags,
    newLakeCells,
    requested: controls.riverCount,
    generated: distinctCount,
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

function normalizeHeadwaterBand(band?: HeadwaterBand): HeadwaterBand {
  const min = clamp01(band?.min ?? 0.55);
  let max = clamp01(band?.max ?? 0.92);
  if (max <= min) {
    max = clamp01(Math.min(1, min + 0.1));
  }
  if (max - min < 0.05) {
    max = clamp01(min + 0.05);
  }
  return { min, max };
}

function computeHeadwaterElevationBand(
  cellElevations: Float64Array,
  isWater: boolean[],
  band: HeadwaterBand
): { minElevation: number; maxElevation: number } {
  const landElevations: number[] = [];
  for (let i = 0; i < cellElevations.length; i++) {
    if (!isWater[i]) {
      landElevations.push(cellElevations[i]);
    }
  }

  if (landElevations.length === 0) {
    return { minElevation: 0, maxElevation: 0 };
  }

  landElevations.sort((a, b) => a - b);
  const lastIndex = landElevations.length - 1;
  const minIndex = Math.max(0, Math.min(lastIndex, Math.floor(band.min * lastIndex)));
  const maxIndex = Math.max(0, Math.min(lastIndex, Math.floor(band.max * lastIndex)));
  let minElevation = landElevations[minIndex];
  let maxElevation = landElevations[Math.max(minIndex, maxIndex)];
  if (maxElevation < minElevation + EPSILON) {
    maxElevation = minElevation + EPSILON;
  }
  return { minElevation, maxElevation };
}

function labelLandmasses(
  isWater: boolean[],
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array
): LandmassInfo {
  const cellCount = cellOffsets.length - 1;
  const componentByCell = new Int32Array(cellCount).fill(-1);
  const componentAreas: number[] = [];
  let componentCount = 0;
  const queue: number[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (isWater[cid]) continue;
    if (componentByCell[cid] !== -1) continue;

    queue.length = 0;
    queue.push(cid);
    componentByCell[cid] = componentCount;
    let area = 0;

    while (queue.length > 0) {
      const cell = queue.shift()!;
      area += 1;
      const start = cellOffsets[cell];
      const end = cellOffsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = cellNeighbors[i];
        if (nb < 0) continue;
        if (isWater[nb]) continue;
        if (componentByCell[nb] !== -1) continue;
        componentByCell[nb] = componentCount;
        queue.push(nb);
      }
    }

    componentAreas.push(area);
    componentCount += 1;
  }

  return { componentByCell, componentAreas, componentCount };
}

function computeCoastDistances(
  isWater: boolean[],
  isOcean: boolean[],
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array
): Float32Array {
  const cellCount = cellOffsets.length - 1;
  const distances = new Float32Array(cellCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const queue: number[] = [];

  for (let cid = 0; cid < cellCount; cid++) {
    if (isWater[cid]) continue;
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (isWater[nb] && isOcean[nb]) {
        distances[cid] = 0;
        queue.push(cid);
        break;
      }
    }
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const cell = queue[qi];
    const base = distances[cell];
    const start = cellOffsets[cell];
    const end = cellOffsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (isWater[nb]) continue;
      if (distances[nb] <= base + 1) continue;
      distances[nb] = base + 1;
      queue.push(nb);
    }
  }

  return distances;
}

function computeLakeOutlets(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  isOcean: boolean[],
  lakeSet: Set<number>
): Map<number, number> {
  const outlets = new Map<number, number>();

  for (const lakeCell of lakeSet) {
    const start = cellOffsets[lakeCell];
    const end = cellOffsets[lakeCell + 1];
    let best = -1;
    let bestElevation = Number.POSITIVE_INFINITY;

    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (isWater[nb]) continue;
      if (isOcean[nb]) continue;
      const elevation = cellElevations[nb];
      if (
        elevation < bestElevation - EPSILON ||
        (Math.abs(elevation - bestElevation) <= EPSILON && nb < best)
      ) {
        bestElevation = elevation;
        best = nb;
      }
    }

    if (best !== -1) {
      outlets.set(lakeCell, best);
    }
  }

  return outlets;
}

function selectPrimarySources(
  candidates: SourceCandidate[],
  landInfo: LandmassInfo,
  requestedRivers: number,
  minSourceSpacing: number,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  isOcean: boolean[],
  logs: string[]
): SourceCandidate[] {
  if (requestedRivers <= 0 || candidates.length === 0) {
    return [];
  }

  const { componentCount, componentAreas } = landInfo;
  if (componentCount === 0) {
    return [];
  }

  const availablePerComponent = new Array<number>(componentCount).fill(0);
  for (const candidate of candidates) {
    if (candidate.component >= 0) {
      availablePerComponent[candidate.component] += 1;
    }
  }

  const totalArea = componentAreas.reduce((sum, value) => sum + value, 0);
  const rawTargets = componentAreas.map((area) =>
    totalArea > 0 ? (area / totalArea) * requestedRivers : 0
  );
  const targets = rawTargets.map((value) => Math.floor(value));
  let assigned = targets.reduce((sum, value) => sum + value, 0);
  let remainder = Math.max(0, requestedRivers - assigned);

  const fractionalOrder = rawTargets
    .map((value, idx) => ({ idx, fraction: value - targets[idx] }))
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.idx - b.idx;
    });

  for (const entry of fractionalOrder) {
    if (remainder <= 0) break;
    if (availablePerComponent[entry.idx] <= targets[entry.idx]) continue;
    targets[entry.idx] += 1;
    remainder -= 1;
  }

  if (remainder > 0) {
    const capacityOrder = availablePerComponent
      .map((available, idx) => ({ idx, slack: Math.max(0, available - targets[idx]) }))
      .filter((entry) => entry.slack > 0)
      .sort((a, b) => {
        if (b.slack !== a.slack) return b.slack - a.slack;
        return a.idx - b.idx;
      });
    for (const entry of capacityOrder) {
      if (remainder <= 0) break;
      const allocatable = Math.min(entry.slack, remainder);
      targets[entry.idx] += allocatable;
      remainder -= allocatable;
    }
  }

  const selected: SourceCandidate[] = [];
  const selectedSet = new Set<number>();
  const selectedPerComponent = new Array<number>(componentCount).fill(0);
  const totalTarget = targets.reduce((sum, value) => sum + value, 0);

  for (const candidate of candidates) {
    if (selected.length >= totalTarget) {
      break;
    }

    const comp = candidate.component;
    if (comp < 0) continue;
    if (selectedPerComponent[comp] >= targets[comp]) continue;

    if (
      !isBeyondSpacing(
        candidate.cell,
        selectedSet,
        minSourceSpacing,
        cellNeighbors,
        cellOffsets,
        isWater,
        isOcean
      )
    ) {
      continue;
    }

    selected.push(candidate);
    selectedSet.add(candidate.cell);
    selectedPerComponent[comp] += 1;
  }

  for (let comp = 0; comp < componentCount; comp++) {
    if (targets[comp] > 0 && selectedPerComponent[comp] < targets[comp]) {
      logs.push(
        `Landmass ${comp}: requested ${targets[comp]} river sources but placed ${selectedPerComponent[comp]} (shortfall ${targets[comp] - selectedPerComponent[comp]}).`
      );
    }
  }

  return selected;
}

function buildCandidateOrder(
  primarySources: SourceCandidate[],
  allCandidates: SourceCandidate[],
  tributaryDensity: number
): SourceCandidate[] {
  if (allCandidates.length === 0) {
    return [];
  }

  const indexLookup = new Map<number, number>();
  for (let i = 0; i < allCandidates.length; i++) {
    indexLookup.set(allCandidates[i].cell, i);
  }

  const primaries = [...primarySources].sort((a, b) => {
    const ia = indexLookup.get(a.cell) ?? 0;
    const ib = indexLookup.get(b.cell) ?? 0;
    return ia - ib;
  });
  const primarySet = new Set<number>(primaries.map((candidate) => candidate.cell));

  const secondary = allCandidates.filter((candidate) => !primarySet.has(candidate.cell));
  const prioritizedCount = Math.min(
    secondary.length,
    Math.round(secondary.length * clamp01(tributaryDensity))
  );
  const prioritized = secondary.slice(0, prioritizedCount);
  const remainder = secondary.slice(prioritizedCount);

  return [...primaries, ...prioritized, ...remainder];
}

function isBeyondSpacing(
  cell: number,
  selected: Set<number>,
  minSourceSpacing: number,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  isOcean: boolean[]
): boolean {
  if (selected.size === 0 || minSourceSpacing <= 0) {
    return true;
  }

  const visited = new Set<number>([cell]);
  const queue: Array<{ id: number; distance: number }> = [{ id: cell, distance: 0 }];

  while (queue.length > 0) {
    const { id, distance } = queue.shift()!;
    if (distance > 0 && selected.has(id)) {
      return false;
    }
    if (distance >= minSourceSpacing) continue;

    const start = cellOffsets[id];
    const end = cellOffsets[id + 1];
    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      if (visited.has(nb)) continue;
      if (isWater[nb] && isOcean[nb]) continue;
      visited.add(nb);
      queue.push({ id: nb, distance: distance + 1 });
    }
  }

  return true;
}

function identifySourceCandidates(
  cellElevations: Float64Array,
  cellNeighbors: Int32Array,
  cellOffsets: Uint32Array,
  isWater: boolean[],
  isOcean: boolean[],
  waterLevel: number,
  landInfo: LandmassInfo,
  minElevation: number,
  maxElevation: number
): SourceCandidate[] {
  const cellCount = cellOffsets.length - 1;
  const candidates: SourceCandidate[] = [];
  const elevationRange = Math.max(EPSILON, maxElevation - minElevation);

  for (let cid = 0; cid < cellCount; cid++) {
    if (isWater[cid]) continue;

    const component = landInfo.componentByCell[cid];
    if (component < 0) continue;

    const elevation = cellElevations[cid];
    const start = cellOffsets[cid];
    const end = cellOffsets[cid + 1];
    if (start === end) continue;

    let higherNeighbors = 0;
    let lowerNeighbors = 0;
    let lowerDropSum = 0;
    let nearlyLevel = 0;
    let concavitySupport = 0;
    let adjacentLake = false;

    for (let i = start; i < end; i++) {
      const nb = cellNeighbors[i];
      if (nb < 0) continue;
      const nbElevation = cellElevations[nb];

      if (isWater[nb] && !isOcean[nb]) {
        adjacentLake = true;
      }

      if (nbElevation > elevation + EPSILON) {
        higherNeighbors += 1;
      } else if (nbElevation < elevation - EPSILON) {
        lowerNeighbors += 1;
        const drop = elevation - nbElevation;
        lowerDropSum += drop;
        if (!isWater[nb]) {
          concavitySupport += Math.min(1, drop / 0.15);
        }
      } else {
        nearlyLevel += 1;
      }
    }

    if (!adjacentLake) {
      if (elevation < minElevation - EPSILON) continue;
      if (elevation > maxElevation + EPSILON) continue;
    }

    if (higherNeighbors === 0 && !adjacentLake) {
      continue; // local maximum
    }

    if (lowerNeighbors === 0 && !adjacentLake) {
      continue; // ridge or flat summit
    }

    const concavity = lowerNeighbors > 0 ? lowerDropSum / lowerNeighbors : 0;
    const normalizedElevation = Math.min(1, Math.max(0, (elevation - minElevation) / elevationRange));
    const slopeBalance = lowerNeighbors + nearlyLevel > 0
      ? lowerNeighbors / (lowerNeighbors + nearlyLevel)
      : 0;
    const lakeBonus = adjacentLake ? 0.25 : 0;
    const score = normalizedElevation * 0.6 + concavity * 0.25 + slopeBalance * 0.1 + concavitySupport * 0.05 + lakeBonus;

    if (elevation <= waterLevel + 0.02 && !adjacentLake) {
      continue;
    }

    candidates.push({
      cell: cid,
      elevation,
      component,
      concavity,
      lowerNeighbors,
      adjacentLake,
      score,
    });
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
    if (Math.abs(b.elevation - a.elevation) > EPSILON) return b.elevation - a.elevation;
    return a.cell - b.cell;
  });

  return candidates;
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
  allowNewLakes: boolean,
  meanderBias: number,
  flatTolerance: number,
  coastDistances: Float32Array,
  lakeOutlets: Map<number, number>
): TraceResult | null {
  const path: number[] = [source];
  const visited = new Set<number>([source]);
  let current = source;
  let confluences = 0;
  let flatStreak = 0;

  const gentleThreshold = 0.02 + 0.08 * clamp01(meanderBias);
  const normalizedCoastDistance = (cell: number): number => {
    const value = coastDistances[cell];
    return Number.isFinite(value) ? value : 6;
  };

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

    const coastalCurrent = normalizedCoastDistance(current);
    const scored = downhill.map((nb) => {
      const drop = currentElevation - cellElevations[nb];
      const gentle = drop <= gentleThreshold + EPSILON;
      const dropScore = gentle
        ? 1 + Math.max(0, gentleThreshold - drop)
        : 2 + drop;
      const coastalNext = normalizedCoastDistance(nb);
      const coastDiff = coastalNext - coastalCurrent;
      const coastWeight = coastalCurrent <= 2 ? 1.2 : 0.35;
      let coastScore = coastDiff * coastWeight;
      if (coastalCurrent <= 1 && coastDiff <= 0) {
        coastScore += coastDiff * 1.4;
      }
      const score = dropScore + coastScore;
      return { nb, score, drop, coastDiff };
    });

    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > EPSILON) return b.score - a.score;
      if (Math.abs(b.drop - a.drop) > EPSILON) return b.drop - a.drop;
      if (Math.abs(b.coastDiff - a.coastDiff) > EPSILON) {
        return b.coastDiff - a.coastDiff;
      }
      if (a.nb !== b.nb) return a.nb - b.nb;
      return 0;
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
        joinedExisting: true,
      };
    }

    let next: number | undefined;
    for (const candidate of scored) {
      if (visited.has(candidate.nb)) continue;
      const drop = currentElevation - cellElevations[candidate.nb];
      if (drop <= EPSILON && flatStreak >= flatTolerance) {
        continue;
      }
      next = candidate.nb;
      break;
    }

    if (next === undefined) {
      if (!allowNewLakes) return null;
      return {
        cells: [...path],
        sinkCell: current,
        sinkType: 'lake',
        confluences,
        newLakes: [current],
        joinedExisting: false,
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
        joinedExisting: false,
      };
    }

    path.push(next);

    if (isWater[next] || lakeSet.has(next)) {
      const sinkType = isOcean[next] ? 'ocean' : 'lake';
      visited.add(next);
      flatStreak = 0;

      if (!isOcean[next]) {
        const outlet = lakeOutlets.get(next);
        if (outlet !== undefined && !visited.has(outlet)) {
          const outletElevation = cellElevations[outlet];
          if (outletElevation <= currentElevation + gentleThreshold + 0.02) {
            path.push(outlet);
            visited.add(outlet);
            current = outlet;
            if (Math.abs(cellElevations[next] - outletElevation) <= EPSILON) {
              flatStreak = Math.min(flatTolerance, flatStreak + 1);
            }
            continue;
          }
        }
      }

      return {
        cells: [...path],
        sinkCell: next,
        sinkType,
        confluences,
        newLakes: [],
        joinedExisting: false,
      };
    }

    visited.add(next);
    if (Math.abs(currentElevation - nextElevation) <= EPSILON) {
      flatStreak = Math.min(flatTolerance, flatStreak + 1);
    } else {
      flatStreak = 0;
    }
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
