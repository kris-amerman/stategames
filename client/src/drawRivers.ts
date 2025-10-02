import { RiverPath, SinkType } from './terrain-gen/rivers';
import { MeshData } from './mesh';

export interface RiverRenderSegment {
  cells: number[];
  sinkType: SinkType | null;
  isComplete: boolean;
}

export interface StrahlerResult {
  orders: Map<number, number>;
  upstreams: Map<number, number[]>;
  maxOrder: number;
}

export interface RiverWidthScale {
  widthFor(order: number): number;
  minWidth: number;
  maxWidth: number;
}

const TAPER_GROWTH = 0.68;
const CONFLUENCE_GROWTH = 0.45;
const SOURCE_TAPER = 0.86;
const SOURCE_MIN_WIDTH = 1.05;

const EXIT_FRACTION = 0.45;
const ENTRY_FRACTION = 0.55;
const CURVE_TENSION = 0.72;
const EPSILON = 1e-6;

type Point = [number, number];

interface SegmentAnchorPoints {
  nodes: Point[];
  exits: Point[];
  entries: Point[];
  shared: (Point | null)[];
}

interface SegmentControls {
  cp1: Point;
  cp2: Point;
}

export function prepareRiverRenderSegments(rivers: RiverPath[]): RiverRenderSegment[] {
  const rendered = new Set<number>();
  const segments: RiverRenderSegment[] = [];

  for (const river of rivers) {
    const segmentCells: number[] = [];
    let truncated = false;

    for (const cell of river.cells) {
      if (segmentCells.length > 0 && rendered.has(cell)) {
        segmentCells.push(cell);
        truncated = true;
        break;
      }
      segmentCells.push(cell);
    }

    if (segmentCells.length < 2) {
      for (const cell of segmentCells) {
        rendered.add(cell);
      }
      continue;
    }

    const hasNewCell = segmentCells.some((cell) => !rendered.has(cell));
    if (!hasNewCell) {
      continue;
    }

    const isComplete = !truncated && segmentCells.length === river.cells.length;
    const sinkType = isComplete ? river.sinkType : null;
    segments.push({ cells: segmentCells, sinkType, isComplete });

    for (const cell of segmentCells) {
      rendered.add(cell);
    }
  }

  return segments;
}

export function computeStrahlerOrders(rivers: RiverPath[]): StrahlerResult {
  const downstream = new Map<number, number>();
  const upstreamSets = new Map<number, Set<number>>();
  const cells = new Set<number>();

  for (const river of rivers) {
    for (const cell of river.cells) {
      cells.add(cell);
    }

    for (let i = 0; i < river.cells.length - 1; i++) {
      const from = river.cells[i];
      const to = river.cells[i + 1];
      if (from === to) continue;

      const existing = downstream.get(from);
      if (existing !== undefined && existing !== to) {
        // Prefer the first encountered downstream path to maintain determinism.
        continue;
      }
      downstream.set(from, to);

      let upstream = upstreamSets.get(to);
      if (!upstream) {
        upstream = new Set<number>();
        upstreamSets.set(to, upstream);
      }
      upstream.add(from);
    }
  }

  const orders = new Map<number, number>();
  const pending = new Map<number, number>();
  const incomingOrders = new Map<number, number[]>();

  for (const cell of cells) {
    const upstream = upstreamSets.get(cell);
    pending.set(cell, upstream ? upstream.size : 0);
  }

  const sources = Array.from(cells).filter((cell) => (pending.get(cell) ?? 0) === 0);
  sources.sort((a, b) => a - b);

  const queue: number[] = [];
  for (const source of sources) {
    orders.set(source, 1);
    queue.push(source);
  }

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const downstreamCell = downstream.get(cell);
    if (downstreamCell === undefined) {
      continue;
    }

    let list = incomingOrders.get(downstreamCell);
    if (!list) {
      list = [];
      incomingOrders.set(downstreamCell, list);
    }
    list.push(orders.get(cell)!);

    const remaining = (pending.get(downstreamCell) ?? 0) - 1;
    pending.set(downstreamCell, remaining);

    if (remaining === 0) {
      const ordersList = incomingOrders.get(downstreamCell) ?? [];
      if (ordersList.length === 0) {
        orders.set(downstreamCell, 1);
      } else {
        let highest = ordersList[0];
        let highestCount = 1;
        for (let i = 1; i < ordersList.length; i++) {
          const value = ordersList[i];
          if (value > highest) {
            highest = value;
            highestCount = 1;
          } else if (value === highest) {
            highestCount += 1;
          }
        }
        const downstreamOrder = highestCount >= 2 ? highest + 1 : highest;
        orders.set(downstreamCell, downstreamOrder);
      }
      queue.push(downstreamCell);
    }
  }

  let maxOrder = 1;
  for (const order of orders.values()) {
    if (order > maxOrder) {
      maxOrder = order;
    }
  }

  const upstreams = new Map<number, number[]>();
  for (const cell of cells) {
    const upstream = upstreamSets.get(cell);
    if (upstream) {
      upstreams.set(cell, Array.from(upstream).sort((a, b) => a - b));
    } else {
      upstreams.set(cell, []);
    }
  }

  return { orders, upstreams, maxOrder };
}

export function createRiverWidthScale(
  orders: Map<number, number>,
  averageSpacing: number
): RiverWidthScale {
  let maxOrder = 1;
  for (const value of orders.values()) {
    if (value > maxOrder) {
      maxOrder = value;
    }
  }

  const minWidth = Math.max(1.4, averageSpacing * 0.22);
  const maxWidth = Math.max(minWidth + 2.2, averageSpacing * 0.85);
  const cache = new Map<number, number>();
  const clampWidth = (width: number): number =>
    Math.min(Math.max(width, minWidth), maxWidth);

  const computeBaseWidth = (order: number): number => {
    if (order <= 1) return minWidth;
    if (order >= maxOrder) return maxWidth;
    const t = maxOrder === 1 ? 0 : (order - 1) / (maxOrder - 1);
    const eased = t * (0.5 + 0.5 * t);
    const width = minWidth + (maxWidth - minWidth) * eased;
    return clampWidth(width);
  };

  for (let order = 1; order <= maxOrder; order++) {
    cache.set(order, computeBaseWidth(order));
  }

  const widthFor = (order: number): number => {
    if (order <= 1) {
      return minWidth;
    }
    if (order >= maxOrder) {
      return maxWidth;
    }
    const lower = Math.floor(order);
    const upper = Math.ceil(order);
    const lowerWidth = cache.get(lower) ?? computeBaseWidth(lower);
    const upperWidth = cache.get(upper) ?? computeBaseWidth(upper);
    if (lower === upper) {
      return lowerWidth;
    }
    const fraction = order - lower;
    const interpolated = lowerWidth + (upperWidth - lowerWidth) * fraction;
    return clampWidth(interpolated);
  };

  return { widthFor, minWidth, maxWidth };
}

export function computeSegmentEdgeWidths(
  cells: number[],
  orders: Map<number, number>,
  scale: RiverWidthScale
): number[] {
  const widths: number[] = [];
  let previous: number | null = null;

  for (let i = 0; i < cells.length - 1; i++) {
    const from = cells[i];
    const to = cells[i + 1];
    const fromOrder = orders.get(from) ?? 1;
    const toOrder = orders.get(to) ?? fromOrder;
    const upstreamTarget = scale.widthFor(fromOrder);
    const downstreamOrder = Math.max(fromOrder, toOrder);
    const downstreamTarget = scale.widthFor(downstreamOrder);

    if (previous === null) {
      const tapered = Math.min(
        upstreamTarget,
        Math.max(SOURCE_MIN_WIDTH, upstreamTarget * SOURCE_TAPER, scale.minWidth * SOURCE_TAPER)
      );
      widths.push(tapered);
      previous = tapered;
      continue;
    }

    const base = previous;
    const desired = Math.max(upstreamTarget, downstreamTarget, base);
    const delta = desired - base;

    if (delta <= 1e-6) {
      if (base + 1e-6 < upstreamTarget) {
        const catchup = Math.max(upstreamTarget - base, 0);
        previous = Math.min(upstreamTarget, base + catchup * 0.35);
        widths.push(previous);
      } else {
        widths.push(base);
      }
      continue;
    }

    const growth = toOrder > fromOrder ? CONFLUENCE_GROWTH : TAPER_GROWTH;
    let width = base + delta * growth;
    if (width < upstreamTarget) {
      width = base + Math.max(upstreamTarget - base, 0) * 0.35;
    }
    width = Math.min(width, desired, scale.maxWidth);
    if (width < base) {
      width = base;
    }
    widths.push(width);
    previous = width;
  }

  return widths;
}

export function buildRiverRenderPath(
  cells: number[],
  mesh: MeshData,
  options: { sinkType: SinkType | null; isComplete: boolean }
): [number, number][] {
  if (cells.length < 2) return [];

  const anchors = collectSegmentAnchors(cells, mesh, options);
  const points: Point[] = [anchors.nodes[0]];

  for (let i = 0; i < anchors.exits.length; i++) {
    points.push(anchors.exits[i]);
    points.push(anchors.entries[i]);
    points.push(anchors.nodes[i + 1]);
  }

  return points;
}

export function strokeSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: [number, number][]
): void {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);

  if (points.length === 2) {
    ctx.lineTo(points[1][0], points[1][1]);
    ctx.stroke();
    return;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i === 0 ? reflectPoint(points[1], points[0]) : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 =
      i + 2 < points.length
        ? points[i + 2]
        : reflectPoint(points[i], points[i + 1]);

    const control = computeCatmullRomControls(p0, p1, p2, p3, CURVE_TENSION);
    ctx.bezierCurveTo(
      control.cp1[0],
      control.cp1[1],
      control.cp2[0],
      control.cp2[1],
      p2[0],
      p2[1]
    );
  }

  ctx.stroke();
}

export function drawRivers(
  ctx: CanvasRenderingContext2D,
  mesh: MeshData,
  rivers: RiverPath[]
): void {
  if (!mesh || rivers.length === 0) return;

  const segments = prepareRiverRenderSegments(rivers);
  if (segments.length === 0) return;

  let totalDistance = 0;
  let distanceSamples = 0;
  const { cellTriangleCenters } = mesh;

  const getCenter = (cell: number): [number, number] => [
    cellTriangleCenters[cell * 2],
    cellTriangleCenters[cell * 2 + 1],
  ];

  for (const segment of segments) {
    for (let i = 0; i < segment.cells.length - 1; i++) {
      const a = getCenter(segment.cells[i]);
      const b = getCenter(segment.cells[i + 1]);
      totalDistance += Math.hypot(b[0] - a[0], b[1] - a[1]);
      distanceSamples += 1;
    }
  }

  const averageSpacing = distanceSamples > 0 ? totalDistance / distanceSamples : 8;

  const strahler = computeStrahlerOrders(rivers);
  const widthScale = createRiverWidthScale(strahler.orders, averageSpacing);

  const isDev = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
  const confluenceCounts = new Map<number, number>();
  if (isDev) {
    for (const [cell, upstream] of strahler.upstreams) {
      if (upstream.length >= 2) {
        const order = strahler.orders.get(cell) ?? 1;
        confluenceCounts.set(order, (confluenceCounts.get(order) ?? 0) + 1);
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f6ef5';

  for (const segment of segments) {
    const widths = computeSegmentEdgeWidths(segment.cells, strahler.orders, widthScale);
    const anchors = collectSegmentAnchors(segment.cells, mesh, {
      sinkType: segment.sinkType,
      isComplete: segment.isComplete,
    });

    const segmentControls = computeSegmentControlPairs(anchors);

    for (let i = 0; i < widths.length; i++) {
      ctx.lineWidth = widths[i];
      const start = anchors.nodes[i];
      const end = anchors.nodes[i + 1];
      if (!start || !end) continue;

      const controls = segmentControls[i];
      if (!controls) continue;
      const { cp1, cp2 } = controls;

      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      ctx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], end[0], end[1]);
      ctx.stroke();
    }
  }

  ctx.restore();

  if (isDev) {
    const clamped: { min: number; max: number } = { min: 0, max: 0 };
    const riverLogs: string[] = [];

    rivers.forEach((river, index) => {
      if (river.isTributary) return;
      const entries: string[] = [];
      const widths = computeSegmentEdgeWidths(river.cells, strahler.orders, widthScale);
      widths.forEach((width, idx) => {
        if (width <= widthScale.minWidth + 1e-3) {
          clamped.min += 1;
        }
        if (width >= widthScale.maxWidth - 1e-3) {
          clamped.max += 1;
        }
        const from = river.cells[idx];
        const to = river.cells[idx + 1];
        const fromOrder = strahler.orders.get(from) ?? 1;
        const toOrder = strahler.orders.get(to) ?? fromOrder;
        const order = Math.max(fromOrder, toOrder);
        entries.push(`(${order} → ${width.toFixed(2)})`);
      });
      riverLogs.push(`River ${index}: ${entries.join(', ')}`);
    });

    const confluenceSummary = Array.from(confluenceCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([order, count]) => `order ${order}: ${count}`)
      .join(', ');

    if (riverLogs.length > 0) {
      console.debug('[river-render] widths', riverLogs.join(' | '));
      if (confluenceSummary.length > 0) {
        console.debug('[river-render] confluences', confluenceSummary);
      }
      if (clamped.min + clamped.max > 0) {
        console.debug('[river-render] clamped widths', clamped);
      }
    }
  }
}

function collectSegmentAnchors(
  cells: number[],
  mesh: MeshData,
  options: { sinkType: SinkType | null; isComplete: boolean }
): SegmentAnchorPoints {
  const { cellTriangleCenters } = mesh;
  const getCenter = (cell: number): Point => [
    cellTriangleCenters[cell * 2],
    cellTriangleCenters[cell * 2 + 1],
  ];

  const nodes: Point[] = [getCenter(cells[0])];
  const exits: Point[] = [];
  const entries: Point[] = [];
  const shared: (Point | null)[] = [];

  for (let i = 0; i < cells.length - 1; i++) {
    const currentCell = cells[i];
    const nextCell = cells[i + 1];
    const start = getCenter(currentCell);
    const sharedEdge = findSharedEdgeMidpoint(currentCell, nextCell, mesh);
    let target = getCenter(nextCell);

    const isLast = i === cells.length - 2;
    if (
      isLast &&
      options.isComplete &&
      options.sinkType !== null &&
      (options.sinkType === 'lake' || options.sinkType === 'ocean')
    ) {
      const mouth = sharedEdge ?? lerpPoint(start, target, 0.52);
      if (mouth) {
        target = mouth;
      }
    }

    exits.push(lerpPoint(start, target, EXIT_FRACTION));
    entries.push(lerpPoint(start, target, ENTRY_FRACTION));
    shared.push(sharedEdge);
    nodes.push(target);
  }

  return { nodes, exits, entries, shared };
}

function computeSegmentControlPairs(anchors: SegmentAnchorPoints): SegmentControls[] {
  const { nodes, exits, entries, shared } = anchors;
  const segmentCount = nodes.length - 1;
  if (segmentCount <= 0) {
    return [];
  }

  const controls: SegmentControls[] = new Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const start = nodes[i];
    const end = nodes[i + 1];
    const prev = i === 0 ? reflectPoint(start, end) : nodes[i - 1];
    const next =
      i + 2 < nodes.length ? nodes[i + 2] : reflectPoint(end, start);
    const base = computeCatmullRomControls(prev, start, end, next, CURVE_TENSION);
    controls[i] = {
      cp1: [base.cp1[0], base.cp1[1]],
      cp2: [base.cp2[0], base.cp2[1]],
    };
  }

  const segmentLimit = (index: number): number => {
    const start = nodes[index];
    const end = nodes[index + 1];
    return pointLength(subtractPoints(end, start)) * 0.85;
  };

  for (let i = 1; i < nodes.length - 1; i++) {
    const prevControl = controls[i - 1];
    const nextControl = controls[i];
    if (!prevControl || !nextControl) continue;

    const incoming = subtractPoints(nodes[i], prevControl.cp2);
    const outgoing = subtractPoints(nextControl.cp1, nodes[i]);
    let baseLength = (pointLength(incoming) + pointLength(outgoing)) * 0.5;

    const prevLimit = pointLength(subtractPoints(nodes[i], nodes[i - 1])) * 0.82;
    const nextLimit = pointLength(subtractPoints(nodes[i + 1], nodes[i])) * 0.82;
    const maxLength = Math.max(EPSILON, Math.min(prevLimit, nextLimit));
    if (!(baseLength > EPSILON)) {
      baseLength = maxLength * 0.6;
    } else if (baseLength > maxLength) {
      baseLength = maxLength;
    }

    let direction: Point = [0, 0];
    const accumulate = (vector: Point, weight: number) => {
      const len = pointLength(vector);
      if (len < EPSILON || weight <= 0) return;
      direction = addPoints(direction, scalePoint(vector, weight / len));
    };

    accumulate(outgoing, 1);
    accumulate(incoming, 1);
    accumulate(subtractPoints(nodes[i + 1], nodes[i - 1]), 0.7);

    if (i < exits.length) {
      accumulate(subtractPoints(exits[i], nodes[i]), 0.6);
    }
    if (i - 1 >= 0 && i - 1 < entries.length) {
      accumulate(subtractPoints(nodes[i], entries[i - 1]), 0.6);
    }
    if (shared[i - 1]) {
      accumulate(subtractPoints(shared[i - 1]!, nodes[i]), 0.5);
    }
    if (shared[i]) {
      accumulate(subtractPoints(shared[i]!, nodes[i]), 0.5);
    }

    if (pointLength(direction) < EPSILON) {
      direction = subtractPoints(nodes[i + 1], nodes[i - 1]);
    }
    direction = normalizePoint(direction);
    const tangent = scalePoint(direction, baseLength);

    prevControl.cp2 = addPoints(nodes[i], scalePoint(tangent, -1));
    nextControl.cp1 = addPoints(nodes[i], tangent);

    prevControl.cp2 = clampControlAroundPoint(prevControl.cp2, nodes[i], prevLimit);
    nextControl.cp1 = clampControlAroundPoint(nextControl.cp1, nodes[i], nextLimit);
  }

  if (controls.length > 0) {
    const startControl = controls[0];
    let baseLength = pointLength(subtractPoints(startControl.cp1, nodes[0]));
    const limit = segmentLimit(0);
    if (!(baseLength > EPSILON)) {
      baseLength = limit * 0.65;
    } else if (baseLength > limit) {
      baseLength = limit;
    }

    let direction: Point = [0, 0];
    const accumulateStart = (vector: Point, weight: number) => {
      const len = pointLength(vector);
      if (len < EPSILON || weight <= 0) return;
      direction = addPoints(direction, scalePoint(vector, weight / len));
    };

    accumulateStart(subtractPoints(startControl.cp1, nodes[0]), 1);
    if (nodes.length > 1) {
      accumulateStart(subtractPoints(nodes[1], nodes[0]), 0.7);
    }
    if (exits[0]) {
      accumulateStart(subtractPoints(exits[0], nodes[0]), 0.6);
    }
    if (shared[0]) {
      accumulateStart(subtractPoints(shared[0]!, nodes[0]), 0.5);
    }

    if (pointLength(direction) < EPSILON && nodes.length > 1) {
      direction = subtractPoints(nodes[1], nodes[0]);
    }
    direction = normalizePoint(direction);
    const tangent = scalePoint(direction, baseLength);
    startControl.cp1 = addPoints(nodes[0], tangent);
    startControl.cp1 = clampControlAroundPoint(startControl.cp1, nodes[0], limit);
  }

  const lastIndex = controls.length - 1;
  if (lastIndex >= 0) {
    const endControl = controls[lastIndex];
    const nodeIndex = nodes.length - 1;
    let baseLength = pointLength(subtractPoints(nodes[nodeIndex], endControl.cp2));
    const limit = pointLength(subtractPoints(nodes[nodeIndex], nodes[nodeIndex - 1])) * 0.85;

    if (!(baseLength > EPSILON)) {
      baseLength = limit * 0.65;
    } else if (baseLength > limit) {
      baseLength = limit;
    }

    let direction: Point = [0, 0];
    const accumulateEnd = (vector: Point, weight: number) => {
      const len = pointLength(vector);
      if (len < EPSILON || weight <= 0) return;
      direction = addPoints(direction, scalePoint(vector, weight / len));
    };

    accumulateEnd(subtractPoints(nodes[nodeIndex], endControl.cp2), 1);
    accumulateEnd(subtractPoints(nodes[nodeIndex], nodes[nodeIndex - 1]), 0.7);
    if (entries.length > 0) {
      const entry = entries[entries.length - 1];
      accumulateEnd(subtractPoints(nodes[nodeIndex], entry), 0.6);
    }
    const sharedTail = shared[shared.length - 1];
    if (sharedTail) {
      accumulateEnd(subtractPoints(sharedTail, nodes[nodeIndex]), 0.5);
    }

    if (pointLength(direction) < EPSILON) {
      direction = subtractPoints(nodes[nodeIndex], nodes[nodeIndex - 1]);
    }
    direction = normalizePoint(direction);
    const tangent = scalePoint(direction, baseLength);
    endControl.cp2 = addPoints(nodes[nodeIndex], scalePoint(tangent, -1));
    endControl.cp2 = clampControlAroundPoint(endControl.cp2, nodes[nodeIndex], limit);
  }

  return controls;
}

function computeCatmullRomControls(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tension: number
): { cp1: Point; cp2: Point } {
  const factor = (tension * 1) / 6;
  const cp1: Point = [
    p1[0] + (p2[0] - p0[0]) * factor,
    p1[1] + (p2[1] - p0[1]) * factor,
  ];
  const cp2: Point = [
    p2[0] - (p3[0] - p1[0]) * factor,
    p2[1] - (p3[1] - p1[1]) * factor,
  ];
  return { cp1, cp2 };
}

function clampControlAroundPoint(point: Point, anchor: Point, limit: number): Point {
  if (!(limit > EPSILON)) {
    return point;
  }
  const vector = subtractPoints(point, anchor);
  const length = pointLength(vector);
  if (!(length > limit)) {
    return point;
  }
  const direction = normalizePoint(vector);
  return addPoints(anchor, scalePoint(direction, limit));
}

function addPoints(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]];
}

function subtractPoints(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

function scalePoint(point: Point, scalar: number): Point {
  return [point[0] * scalar, point[1] * scalar];
}

function pointLength(point: Point): number {
  return Math.hypot(point[0], point[1]);
}

function normalizePoint(point: Point): Point {
  const length = pointLength(point);
  if (!(length > EPSILON)) {
    return [0, 0];
  }
  return [point[0] / length, point[1] / length];
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function reflectPoint(pivot: Point, point: Point): Point {
  return [pivot[0] * 2 - point[0], pivot[1] * 2 - point[1]];
}

function findSharedEdgeMidpoint(
  cellA: number,
  cellB: number,
  mesh: MeshData
): [number, number] | null {
  const { cellOffsets, cellVertexIndices, allVertices } = mesh;

  const startA = cellOffsets[cellA];
  const endA = cellOffsets[cellA + 1];
  const startB = cellOffsets[cellB];
  const endB = cellOffsets[cellB + 1];

  const edgesA = new Map<string, [number, number]>();

  for (let i = startA; i < endA; i++) {
    const v1 = cellVertexIndices[i];
    const v2 = cellVertexIndices[i === endA - 1 ? startA : i + 1];
    const key = edgeKey(v1, v2);
    const midpoint = midpointForEdge(v1, v2, allVertices);
    edgesA.set(key, midpoint);
  }

  for (let i = startB; i < endB; i++) {
    const v1 = cellVertexIndices[i];
    const v2 = cellVertexIndices[i === endB - 1 ? startB : i + 1];
    const key = edgeKey(v2, v1);
    const match = edgesA.get(key);
    if (match) {
      return match;
    }
  }

  return null;
}

function edgeKey(a: number, b: number): string {
  return `${a}:${b}`;
}

function midpointForEdge(
  v1: number,
  v2: number,
  allVertices: Float64Array
): [number, number] {
  const x1 = allVertices[v1 * 2];
  const y1 = allVertices[v1 * 2 + 1];
  const x2 = allVertices[v2 * 2];
  const y2 = allVertices[v2 * 2 + 1];
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}
