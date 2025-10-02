import { describe, expect, it } from 'vitest';
import { MeshData } from './mesh';
import {
  buildRiverRenderPath,
  computeStrahlerOrders,
  createRiverWidthScale,
  computeSegmentEdgeWidths,
  drawRivers,
  prepareRiverRenderSegments,
  RiverRenderSegment,
  strokeSmoothPath,
} from './drawRivers';
import { RiverPath } from './terrain-gen/rivers';

type MockCommand =
  | { type: 'beginPath' }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'quadraticCurveTo'; cx: number; cy: number; x: number; y: number }
  | { type: 'bezierCurveTo'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { type: 'stroke' }
  | { type: 'lineWidth'; value: number };

type Point = [number, number];

class MockContext {
  public canvas: { width: number; height: number } = { width: 300, height: 200 };
  public commands: MockCommand[] = [];
  public lineCap = 'butt';
  public lineJoin = 'miter';
  public strokeStyle = '#000000';
  private _lineWidth = 1;

  get lineWidth() {
    return this._lineWidth;
  }

  set lineWidth(value: number) {
    this._lineWidth = value;
    this.commands.push({ type: 'lineWidth', value });
  }

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
  bezierCurveTo(
    cx1: number,
    cy1: number,
    cx2: number,
    cy2: number,
    x: number,
    y: number
  ) {
    this.commands.push({ type: 'bezierCurveTo', cx1, cy1, cx2, cy2, x, y });
  }
  stroke() {
    this.commands.push({ type: 'stroke' });
  }
  save() {}
  restore() {}
}

interface BezierSegment {
  start: Point;
  cp1: Point;
  cp2: Point;
  end: Point;
}

function extractBezierSegments(commands: MockCommand[]): BezierSegment[] {
  const segments: BezierSegment[] = [];
  let currentStart: Point | null = null;

  for (const command of commands) {
    if (command.type === 'moveTo') {
      currentStart = [command.x, command.y];
    } else if (command.type === 'bezierCurveTo' && currentStart) {
      segments.push({
        start: currentStart,
        cp1: [command.cx1, command.cy1],
        cp2: [command.cx2, command.cy2],
        end: [command.x, command.y],
      });
      currentStart = [command.x, command.y];
    }
  }

  return segments;
}

function pointSubtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

function pointLength(point: Point): number {
  return Math.hypot(point[0], point[1]);
}

function normalizePoint(point: Point): Point {
  const length = pointLength(point);
  if (length < 1e-6) return [0, 0];
  return [point[0] / length, point[1] / length];
}

function dotProduct(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1];
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

describe('computeStrahlerOrders', () => {
  it('assigns order one to simple source-to-sink rivers', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 2],
        source: 0,
        sink: 2,
        sinkType: 'ocean',
        length: 3,
        confluences: 0,
        isTributary: false,
      },
    ];

    const result = computeStrahlerOrders(rivers);
    expect(result.orders.get(0)).toBe(1);
    expect(result.orders.get(1)).toBe(1);
    expect(result.orders.get(2)).toBe(1);
  });

  it('increments order at symmetric confluences', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 8],
        source: 0,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: false,
      },
      {
        cells: [2, 3, 4, 8],
        source: 2,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
      {
        cells: [5, 6, 7, 8],
        source: 5,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
      {
        cells: [9, 10, 7, 8],
        source: 9,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
    ];

    const result = computeStrahlerOrders(rivers);
    expect(result.orders.get(4)).toBe(2);
    expect(result.orders.get(7)).toBe(2);
    expect(result.orders.get(8)).toBe(3);
  });

  it('keeps downstream order for asymmetric merges', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 8],
        source: 0,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: false,
      },
      {
        cells: [2, 3, 4, 8],
        source: 2,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
      {
        cells: [5, 6, 8],
        source: 5,
        sink: 8,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    const result = computeStrahlerOrders(rivers);
    expect(result.orders.get(4)).toBe(2);
    expect(result.orders.get(8)).toBe(2);
  });
});

describe('createRiverWidthScale', () => {
  it('maps increasing order to monotonically increasing widths', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 8],
        source: 0,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: false,
      },
      {
        cells: [2, 3, 4, 8],
        source: 2,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
      {
        cells: [5, 6, 7, 8],
        source: 5,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
      {
        cells: [9, 10, 7, 8],
        source: 9,
        sink: 8,
        sinkType: 'ocean',
        length: 4,
        confluences: 1,
        isTributary: true,
      },
    ];

    const { orders } = computeStrahlerOrders(rivers);
    const scale = createRiverWidthScale(orders, 12);
    const width1 = scale.widthFor(1);
    const width2 = scale.widthFor(2);
    const width3 = scale.widthFor(3);
    expect(width1).toBeGreaterThanOrEqual(scale.minWidth);
    expect(width3).toBeLessThanOrEqual(scale.maxWidth);
    expect(width2).toBeGreaterThan(width1);
    expect(width3).toBeGreaterThan(width2);
  });
});

describe('prepareRiverRenderSegments', () => {
  it('avoids duplicating downstream segments at confluences', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 5],
        source: 0,
        sink: 5,
        sinkType: 'ocean',
        length: 4,
        confluences: 0,
        isTributary: false,
      },
      {
        cells: [3, 4, 5],
        source: 3,
        sink: 5,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    const segments = prepareRiverRenderSegments(rivers);
    const expected: RiverRenderSegment[] = [
      { cells: [0, 1, 4, 5], sinkType: 'ocean', isComplete: true },
      { cells: [3, 4], sinkType: null, isComplete: false },
    ];
    expect(segments).toEqual(expected);
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
  it('uses bezier curves to ensure smooth transitions', () => {
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
    const curveCommands = ctx.commands.filter((cmd) => cmd.type === 'bezierCurveTo');
    expect(curveCommands.length).toBeGreaterThan(0);
  });
});

describe('drawRivers', () => {
  it('draws deterministic smooth paths for all river segments', () => {
    const ctxA = new MockContext();
    const ctxB = new MockContext();

    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 5],
        source: 0,
        sink: 5,
        sinkType: 'ocean',
        length: 4,
        confluences: 0,
        isTributary: false,
      },
      {
        cells: [3, 4, 5],
        source: 3,
        sink: 5,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    drawRivers(ctxA as unknown as CanvasRenderingContext2D, mesh, rivers);
    drawRivers(ctxB as unknown as CanvasRenderingContext2D, mesh, rivers);

    expect(ctxA.commands).toEqual(ctxB.commands);
    expect(ctxA.lineWidth).toBeLessThan(12);
  });

  it('maintains continuous tangents between consecutive bezier segments', () => {
    const ctx = new MockContext();

    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 5],
        source: 0,
        sink: 5,
        sinkType: 'ocean',
        length: 4,
        confluences: 0,
        isTributary: false,
      },
      {
        cells: [3, 4, 5],
        source: 3,
        sink: 5,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    drawRivers(ctx as unknown as CanvasRenderingContext2D, mesh, rivers);

    const segments = extractBezierSegments(ctx.commands);
    expect(segments.length).toBeGreaterThan(1);

    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];

      const incoming = pointSubtract(current.end, current.cp2);
      const outgoing = pointSubtract(next.cp1, next.start);

      const incomingLength = pointLength(incoming);
      const outgoingLength = pointLength(outgoing);
      expect(incomingLength).toBeGreaterThan(0);
      expect(outgoingLength).toBeGreaterThan(0);

      const dot = dotProduct(normalizePoint(incoming), normalizePoint(outgoing));
      expect(dot).toBeGreaterThan(0.94);

      const ratio =
        Math.abs(incomingLength - outgoingLength) /
        Math.max(incomingLength, outgoingLength);
      expect(ratio).toBeLessThan(0.65);
    }
  });

  it('ensures widths grow or stay constant downstream on the main river', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 5],
        source: 0,
        sink: 5,
        sinkType: 'ocean',
        length: 4,
        confluences: 0,
        isTributary: false,
      },
      {
        cells: [3, 4, 5],
        source: 3,
        sink: 5,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    const segments = prepareRiverRenderSegments(rivers);
    const { orders } = computeStrahlerOrders(rivers);
    const scale = createRiverWidthScale(orders, 10);

    const main = segments.find((segment) => segment.cells[0] === 0);
    expect(main).toBeDefined();
    if (!main) return;

    const widths = computeSegmentEdgeWidths(main.cells, orders, scale);

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }

    const downstreamOrder = orders.get(main.cells[main.cells.length - 1]) ?? 1;
    const downstreamTarget = scale.widthFor(downstreamOrder);
    const upstreamTarget = scale.widthFor(orders.get(main.cells[0]) ?? 1);
    expect(widths[0]).toBeLessThanOrEqual(upstreamTarget);
    expect(widths[0]).toBeGreaterThanOrEqual(upstreamTarget * 0.8);
    const lastWidth = widths[widths.length - 1];
    const penultimate = widths[widths.length - 2];
    expect(lastWidth).toBeGreaterThan(penultimate);
    expect(lastWidth).toBeLessThanOrEqual(downstreamTarget + 1e-6);
    if (downstreamTarget > penultimate + 1e-3) {
      expect(lastWidth).toBeLessThan(downstreamTarget);
    }
  });

  it('keeps tributaries narrower than the downstream confluence order', () => {
    const rivers: RiverPath[] = [
      {
        cells: [0, 1, 4, 5],
        source: 0,
        sink: 5,
        sinkType: 'ocean',
        length: 4,
        confluences: 0,
        isTributary: false,
      },
      {
        cells: [3, 4, 5],
        source: 3,
        sink: 5,
        sinkType: 'ocean',
        length: 3,
        confluences: 1,
        isTributary: true,
      },
    ];

    const segments = prepareRiverRenderSegments(rivers);
    const { orders } = computeStrahlerOrders(rivers);
    const scale = createRiverWidthScale(orders, 10);

    const tributary = segments.find((segment) => segment.cells[0] === 3);
    const main = segments.find((segment) => segment.cells[0] === 0);
    expect(tributary).toBeDefined();
    expect(main).toBeDefined();
    if (!tributary || !main) return;

    const tribWidths = computeSegmentEdgeWidths(tributary.cells, orders, scale);
    const mainWidths = computeSegmentEdgeWidths(main.cells, orders, scale);

    const mainOrder = orders.get(main.cells[main.cells.length - 1]) ?? 1;
    const mainTarget = scale.widthFor(mainOrder);
    const tribLast = tribWidths[tribWidths.length - 1];
    expect(tribLast).toBeLessThan(mainTarget);
    expect(tribLast).toBeGreaterThanOrEqual(tribWidths[0]);
    expect(mainWidths[mainWidths.length - 1]).toBeGreaterThan(tribLast);
  });
});
