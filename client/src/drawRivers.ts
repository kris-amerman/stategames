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

const EXIT_FRACTION = 0.45;
const ENTRY_FRACTION = 0.55;

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

export function buildRiverRenderPath(
  cells: number[],
  mesh: MeshData,
  options: { sinkType: SinkType | null; isComplete: boolean }
): [number, number][] {
  if (cells.length < 2) return [];

  const points: [number, number][] = [];
  const { cellTriangleCenters } = mesh;

  const getCenter = (cell: number): [number, number] => [
    cellTriangleCenters[cell * 2],
    cellTriangleCenters[cell * 2 + 1],
  ];

  const lerp = (
    a: [number, number],
    b: [number, number],
    t: number
  ): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const mouthPoint = (
    upstream: number,
    sink: number
  ): [number, number] | null =>
    findSharedEdgeMidpoint(upstream, sink, mesh) ?? lerp(getCenter(upstream), getCenter(sink), 0.52);

  points.push(getCenter(cells[0]));

  for (let i = 0; i < cells.length - 1; i++) {
    const current = cells[i];
    const next = cells[i + 1];

    const centerCurrent = getCenter(current);
    const centerNext = getCenter(next);

    const exitPoint = lerp(centerCurrent, centerNext, EXIT_FRACTION);
    points.push(exitPoint);

    const isLastSegment = i === cells.length - 2;
    if (
      isLastSegment &&
      options.isComplete &&
      options.sinkType !== null &&
      (options.sinkType === 'lake' || options.sinkType === 'ocean')
    ) {
      const mouth = mouthPoint(current, next);
      if (mouth) {
        points.push(mouth);
      } else {
        points.push(lerp(centerCurrent, centerNext, ENTRY_FRACTION));
      }
      continue;
    }

    const entryPoint = lerp(centerCurrent, centerNext, ENTRY_FRACTION);
    points.push(entryPoint);
    points.push(centerNext);
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
  } else {
    for (let i = 0; i < points.length - 2; i++) {
      const [cx, cy] = points[i + 1];
      const [nx, ny] = points[i + 2];
      const midX = (cx + nx) / 2;
      const midY = (cy + ny) / 2;
      ctx.quadraticCurveTo(cx, cy, midX, midY);
    }
    const [px, py] = points[points.length - 2];
    const [lx, ly] = points[points.length - 1];
    ctx.quadraticCurveTo(px, py, lx, ly);
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

  const edgeWidth = (fromOrder: number, toOrder: number): number => {
    const upstreamWidth = widthScale.widthFor(fromOrder);
    const downstreamOrder = Math.max(fromOrder, toOrder);
    const downstreamWidth = widthScale.widthFor(downstreamOrder);
    if (downstreamWidth <= upstreamWidth) {
      return upstreamWidth;
    }
    return upstreamWidth * 0.35 + downstreamWidth * 0.65;
  };

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
    let previousWidth: number | null = null;
    for (let i = 0; i < segment.cells.length - 1; i++) {
      const from = segment.cells[i];
      const to = segment.cells[i + 1];
      const fromOrder = strahler.orders.get(from) ?? 1;
      const toOrder = strahler.orders.get(to) ?? fromOrder;
      let width = edgeWidth(fromOrder, toOrder);
      if (previousWidth !== null && width < previousWidth) {
        width = previousWidth;
      }
      ctx.lineWidth = width;

      const subPath = buildRiverRenderPath([from, to], mesh, {
        sinkType: i === segment.cells.length - 2 ? segment.sinkType : null,
        isComplete: i === segment.cells.length - 2 ? segment.isComplete : false,
      });
      if (subPath.length < 2) continue;
      strokeSmoothPath(ctx, subPath);
      previousWidth = width;
    }
  }

  ctx.restore();

  if (isDev) {
    const clamped: { min: number; max: number } = { min: 0, max: 0 };
    const riverLogs: string[] = [];

    rivers.forEach((river, index) => {
      if (river.isTributary) return;
      const entries: string[] = [];
      let lastWidth = 0;
      for (let i = 0; i < river.cells.length - 1; i++) {
        const from = river.cells[i];
        const to = river.cells[i + 1];
        const fromOrder = strahler.orders.get(from) ?? 1;
        const toOrder = strahler.orders.get(to) ?? fromOrder;
        let width = edgeWidth(fromOrder, toOrder);
        if (width <= widthScale.minWidth + 1e-3) {
          clamped.min += 1;
        }
        if (width >= widthScale.maxWidth - 1e-3) {
          clamped.max += 1;
        }
        if (width < lastWidth) {
          width = lastWidth;
        }
        lastWidth = width;
        const order = Math.max(fromOrder, toOrder);
        entries.push(`(${order} → ${width.toFixed(2)})`);
      }
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
