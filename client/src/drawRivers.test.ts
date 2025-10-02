import { describe, expect, it } from 'vitest';
import { MeshData } from './mesh';
import {
  buildRiverRenderPath,
  drawRivers,
  prepareRiverRenderSegments,
  RiverRenderSegment,
  strokeSmoothPath,
} from './drawRivers';
import { RiverPath, RiverSample, RiverCellSpan } from './terrain-gen/rivers';

type MockCommand =
  | { type: 'beginPath' }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'quadraticCurveTo'; cx: number; cy: number; x: number; y: number }
  | { type: 'stroke' };

class MockContext {
  public canvas: { width: number; height: number } = { width: 300, height: 200 };
  public commands: MockCommand[] = [];
  public lineCap = 'butt';
  public lineJoin = 'miter';
  public strokeStyle = '#000000';
  public lineWidth = 1;

  beginPath() {
    this.commands.push({ type: 'beginPath' });
  }
  moveTo(x: number, y: number) {
    this.commands.push({ type: 'moveTo', x, y });
  }
  lineTo(x: number, y: number) {
    this.commands.push({ type: 'lineTo', x, y });
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.commands.push({ type: 'quadraticCurveTo', cx, cy, x, y });
  }
  stroke() {
    this.commands.push({ type: 'stroke' });
  }
  save() {}
  restore() {}
}

const mesh: MeshData = {
  allVertices: new Float64Array([
    0, 0,
    10, 0,
    20, 0,
    30, 0,
    0, 10,
    10, 10,
    20, 10,
    30, 10,
    0, 20,
    10, 20,
    20, 20,
    30, 20,
  ]),
  cellOffsets: new Uint32Array([0, 4, 8, 12, 16, 20, 24]),
  cellVertexIndices: new Uint32Array([
    0, 1, 5, 4,
    1, 2, 6, 5,
    2, 3, 7, 6,
    4, 5, 9, 8,
    5, 6, 10, 9,
    6, 7, 11, 10,
  ]),
  cellNeighbors: new Int32Array(0),
  cellTriangleCenters: new Float64Array([
    5, 5,
    15, 5,
    25, 5,
    5, 15,
    15, 15,
    25, 15,
  ]),
  cellCount: 6,
};

function buildSamples(cells: number[]): { samples: RiverSample[]; spans: RiverCellSpan[] } {
  const samples: RiverSample[] = [];
  const spans: RiverCellSpan[] = [];

  const getCenter = (cell: number): [number, number] => [
    mesh.cellTriangleCenters[cell * 2],
    mesh.cellTriangleCenters[cell * 2 + 1],
  ];

  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];

  const pushSample = (cell: number, position: [number, number], distance: number, index: number) => {
    const sample: RiverSample = {
      cell,
      distance,
      position,
      order: 1,
      width: 2 + index * 0.2,
    };
    samples.push(sample);
    const last = spans[spans.length - 1];
    if (last && last.cell === cell) {
      last.end = samples.length;
    } else {
      spans.push({ cell, start: samples.length - 1, end: samples.length });
    }
  };

  let distance = 0;
  let index = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const center = getCenter(cell);
    if (i === 0) {
      pushSample(cell, center, distance, index++);
    }
    if (i === cells.length - 1) break;
    const next = cells[i + 1];
    const nextCenter = getCenter(next);
    const exitPoint = lerp(center, nextCenter, 0.55);
    distance += Math.hypot(exitPoint[0] - samples[samples.length - 1].position[0], exitPoint[1] - samples[samples.length - 1].position[1]);
    pushSample(cell, exitPoint, distance, index++);
    const entryPoint = lerp(center, nextCenter, 0.45);
    distance += Math.hypot(entryPoint[0] - exitPoint[0], entryPoint[1] - exitPoint[1]);
    pushSample(next, entryPoint, distance, index++);
    distance += Math.hypot(nextCenter[0] - entryPoint[0], nextCenter[1] - entryPoint[1]);
    pushSample(next, nextCenter, distance, index++);
  }

  return { samples, spans };
}

function makeRiverPath(cells: number[], sinkType: SinkType, isTributary = false): RiverPath {
  const { samples, spans } = buildSamples(cells);
  return {
    cells,
    samples,
    spans,
    source: cells[0],
    sink: cells[cells.length - 1],
    sinkType,
    length: cells.length,
    confluences: isTributary ? 1 : 0,
    isTributary,
    order: 1,
    widthStats: { min: 2, mean: 2.5, max: 3 },
  };
}

describe('prepareRiverRenderSegments', () => {
  it('avoids duplicating downstream segments at confluences', () => {
    const rivers: RiverPath[] = [
      makeRiverPath([0, 1, 4, 5], 'ocean', false),
      makeRiverPath([3, 4, 5], 'ocean', true),
    ];

    const segments = prepareRiverRenderSegments(rivers);
    expect(segments.length).toBe(2);
    expect(segments[0].cells).toEqual([0, 1, 4, 5]);
    expect(segments[0].sinkType).toBe('ocean');
    expect(segments[0].isComplete).toBe(true);
    expect(segments[0].samples.length).toBeGreaterThan(3);
    expect(segments[1].cells).toEqual([3, 4]);
    expect(segments[1].sinkType).toBeNull();
    expect(segments[1].samples.length).toBeGreaterThan(0);
  });
});

describe('buildRiverRenderPath', () => {
  it('creates a continuous interior path with interior offsets', () => {
    const path = buildRiverRenderPath([0, 1, 2], mesh, { sinkType: 'ocean', isComplete: true });
    expect(path[0]).toEqual([5, 5]);
    const exit = path[1];
    expect(exit[0]).toBeLessThan(10);
    const entry = path[2];
    expect(entry[0]).toBeGreaterThan(10);
    const mouth = path[path.length - 1];
    expect(mouth[0]).toBe(20);
    expect(mouth[1]).toBe(5);
  });

  it('stops at confluence without reusing downstream cells', () => {
    const path = buildRiverRenderPath([3, 4], mesh, { sinkType: null, isComplete: false });
    expect(path[path.length - 1]).toEqual([15, 15]);
  });
});

describe('strokeSmoothPath', () => {
  it('uses quadratic curves to ensure smooth transitions', () => {
    const ctx = new MockContext();
    const points: [number, number][] = [
      [5, 5],
      [9, 5],
      [11, 5],
      [15, 5],
      [15, 9],
      [15, 11],
      [15, 15],
    ];

    strokeSmoothPath(ctx as unknown as CanvasRenderingContext2D, points);
    const curveCommands = ctx.commands.filter((cmd) => cmd.type === 'quadraticCurveTo');
    expect(curveCommands.length).toBeGreaterThan(0);
  });
});

describe('drawRivers', () => {
  it('draws deterministic smooth paths for all river segments', () => {
    const ctxA = new MockContext();
    const ctxB = new MockContext();

    const rivers: RiverPath[] = [
      makeRiverPath([0, 1, 4, 5], 'ocean', false),
      makeRiverPath([3, 4, 5], 'ocean', true),
    ];

    drawRivers(ctxA as unknown as CanvasRenderingContext2D, mesh, rivers);
    drawRivers(ctxB as unknown as CanvasRenderingContext2D, mesh, rivers);

    expect(ctxA.commands).toEqual(ctxB.commands);
    expect(ctxA.lineWidth).toBeLessThan(10);
  });
});
