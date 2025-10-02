import { RiverPath, RiverSample, SinkType } from './terrain-gen/rivers';
import { MeshData } from './mesh';

export interface RiverRenderSegment {
  cells: number[];
  sinkType: SinkType | null;
  isComplete: boolean;
  samples: RiverSample[];
}

const EXIT_FRACTION = 0.45;
const ENTRY_FRACTION = 0.55;

export function prepareRiverRenderSegments(rivers: RiverPath[]): RiverRenderSegment[] {
  const rendered = new Set<number>();
  const segments: RiverRenderSegment[] = [];

  for (const river of rivers) {
    const segmentCells: number[] = [];
    const segmentSpans: { start: number; end: number }[] = [];
    let truncated = false;
    let spanIndex = 0;

    for (const cell of river.cells) {
      while (spanIndex < river.spans.length && river.spans[spanIndex].cell !== cell) {
        spanIndex += 1;
      }
      const span = river.spans[spanIndex];
      if (!span) break;
      if (segmentCells.length > 0 && rendered.has(cell)) {
        segmentCells.push(cell);
        segmentSpans.push({ start: span.start, end: span.end });
        truncated = true;
        break;
      }
      segmentCells.push(cell);
      segmentSpans.push({ start: span.start, end: span.end });
      spanIndex += 1;
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
    const spanStart = segmentSpans[0]?.start ?? 0;
    const spanEnd = segmentSpans[segmentSpans.length - 1]?.end ?? spanStart;
    const samples = spanEnd > spanStart ? river.samples.slice(spanStart, spanEnd) : [];
    segments.push({ cells: segmentCells, sinkType, isComplete, samples });

    for (const cell of segmentCells) {
      rendered.add(cell);
    }
  }

  return segments;
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
  const lineWidth = Math.max(1.2, averageSpacing * 0.35);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f6ef5';
  ctx.lineWidth = lineWidth;

  for (const segment of segments) {
    if (segment.samples.length > 1) {
      strokeVariableWidthPath(ctx, segment.samples);
      continue;
    }
    const path = buildRiverRenderPath(segment.cells, mesh, {
      sinkType: segment.sinkType,
      isComplete: segment.isComplete,
    });
    if (path.length < 2) continue;
    strokeSmoothPath(ctx, path);
  }

  ctx.restore();
}

function strokeVariableWidthPath(ctx: CanvasRenderingContext2D, samples: RiverSample[]): void {
  if (samples.length < 2) return;

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const control: [number, number] = [
      (a.position[0] + b.position[0]) / 2,
      (a.position[1] + b.position[1]) / 2,
    ];
    ctx.lineWidth = Math.max(0.5, (a.width + b.width) / 2);
    ctx.beginPath();
    ctx.moveTo(a.position[0], a.position[1]);
    ctx.quadraticCurveTo(control[0], control[1], b.position[0], b.position[1]);
    ctx.stroke();
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
