import { describe, expect, it } from 'vitest';
import { MeshData } from './mesh';
import {
  buildRiverRenderPath,
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

describe('prepareRiverRenderSegments', () => {
  it('avoids duplicating downstream segments at confluences', () => {
    const rivers: RiverPath[] = [
      { cells: [0, 1, 4, 5], source: 0, sink: 5, sinkType: 'ocean', length: 4, confluences: 0 },
      { cells: [3, 4, 5], source: 3, sink: 5, sinkType: 'ocean', length: 3, confluences: 1 },
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
      { cells: [0, 1, 4, 5], source: 0, sink: 5, sinkType: 'ocean', length: 4, confluences: 0 },
      { cells: [3, 4, 5], source: 3, sink: 5, sinkType: 'ocean', length: 3, confluences: 1 },
    ];

    drawRivers(ctxA as unknown as CanvasRenderingContext2D, mesh, rivers);
    drawRivers(ctxB as unknown as CanvasRenderingContext2D, mesh, rivers);

    expect(ctxA.commands).toEqual(ctxB.commands);
    expect(ctxA.lineWidth).toBeLessThan(10);
  });
});
