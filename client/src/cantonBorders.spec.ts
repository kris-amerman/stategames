import { describe, expect, it } from 'vitest';
import {
  computeCantonViewBorders,
  darkenColor,
  lightenColor,
  type BorderMeshData,
} from './cantonBorders';
import type { RgbaColor } from './mapColors';

function createGridMesh(width: number, height: number, step = 10): BorderMeshData {
  const columns = width + 1;
  const rows = height + 1;
  const vertices = new Float64Array(columns * rows * 2);
  let index = 0;
  for (let row = 0; row <= height; row++) {
    for (let col = 0; col <= width; col++) {
      vertices[index++] = col * step;
      vertices[index++] = row * step;
    }
  }

  const cellCount = width * height;
  const cellOffsets = new Uint32Array(cellCount + 1);
  const cellVertexIndices = new Uint32Array(cellCount * 4);
  const cellNeighbors = new Int32Array(cellCount * 4).fill(-1);

  let offset = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cellId = row * width + col;
      cellOffsets[cellId] = offset;

      const topLeft = row * columns + col;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * columns + col;
      const bottomRight = bottomLeft + 1;

      cellVertexIndices[offset] = topLeft;
      cellVertexIndices[offset + 1] = topRight;
      cellVertexIndices[offset + 2] = bottomRight;
      cellVertexIndices[offset + 3] = bottomLeft;

      cellNeighbors[offset] = row > 0 ? cellId - width : -1;
      cellNeighbors[offset + 1] = col < width - 1 ? cellId + 1 : -1;
      cellNeighbors[offset + 2] = row < height - 1 ? cellId + width : -1;
      cellNeighbors[offset + 3] = col > 0 ? cellId - 1 : -1;

      offset += 4;
    }
  }
  cellOffsets[cellCount] = offset;

  return {
    allVertices: vertices,
    cellOffsets,
    cellVertexIndices,
    cellNeighbors,
    cellCount,
  };
}

describe('computeCantonViewBorders', () => {
  it('builds a single nation hull without interior per-cell edges', () => {
    const mesh = createGridMesh(3, 3);
    const cellOwnership: Record<string, string> = {};
    for (let i = 0; i < mesh.cellCount; i++) {
      cellOwnership[String(i)] = 'alpha';
    }
    const cellCantons: Record<string, string> = { '4': 'alpha-core' };

    const borders = computeCantonViewBorders({ cellOwnership, cellCantons, mesh });
    const alphaOutlines = borders.nationOutlines.filter((outline) => outline.nationId === 'alpha');
    expect(alphaOutlines).toHaveLength(1);
    const outline = alphaOutlines[0];
    expect(outline.closed).toBe(true);
    expect(outline.vertices[0]).toBe(outline.vertices[outline.vertices.length - 1]);
    expect(outline.vertices).not.toContain(5);
    const uniqueVertices = new Set(outline.vertices.slice(0, -1));
    expect(uniqueVertices.size).toBeGreaterThan(3);
  });

  it('creates a single closed outline for a canton interface', () => {
    const mesh = createGridMesh(3, 3);
    const cellOwnership: Record<string, string> = {};
    for (let i = 0; i < mesh.cellCount; i++) {
      cellOwnership[String(i)] = 'alpha';
    }
    const cellCantons: Record<string, string> = {};
    for (let i = 0; i < mesh.cellCount; i++) {
      cellCantons[String(i)] = 'alpha-a';
    }
    cellCantons['4'] = 'alpha-b';

    const borders = computeCantonViewBorders({ cellOwnership, cellCantons, mesh });
    expect(borders.cantonOutlines).toHaveLength(1);
    const outline = borders.cantonOutlines[0];
    expect(outline.closed).toBe(true);
    expect(outline.vertices[0]).toBe(outline.vertices[outline.vertices.length - 1]);
    const uniqueVertices = new Set(outline.vertices.slice(0, -1));
    expect(uniqueVertices).toEqual(new Set([5, 6, 10, 9]));
  });

  it('keeps shoreline canton borders as open polylines', () => {
    const mesh = createGridMesh(2, 2);
    const cellOwnership: Record<string, string> = {};
    for (let i = 0; i < mesh.cellCount; i++) {
      cellOwnership[String(i)] = 'alpha';
    }
    const cellCantons: Record<string, string> = {
      '0': 'alpha-west',
      '2': 'alpha-west',
      '1': 'alpha-east',
      '3': 'alpha-east',
    };

    const borders = computeCantonViewBorders({ cellOwnership, cellCantons, mesh });
    expect(borders.cantonOutlines).toHaveLength(1);
    const outline = borders.cantonOutlines[0];
    expect(outline.closed).toBe(false);
    expect(outline.vertices[0]).toBe(1);
    expect(outline.vertices[outline.vertices.length - 1]).toBe(7);
    expect(new Set(outline.vertices)).toEqual(new Set([1, 4, 7]));
  });

  it('returns separate nation hulls for disconnected landmasses', () => {
    const mesh = createGridMesh(2, 2);
    const cellOwnership: Record<string, string> = {
      '0': 'alpha',
      '1': 'beta',
      '2': 'beta',
      '3': 'alpha',
    };

    const borders = computeCantonViewBorders({ cellOwnership, mesh });
    const alphaOutlines = borders.nationOutlines.filter((outline) => outline.nationId === 'alpha');
    expect(alphaOutlines).toHaveLength(2);
    for (const outline of alphaOutlines) {
      expect(outline.closed).toBe(true);
      expect(outline.vertices[0]).toBe(outline.vertices[outline.vertices.length - 1]);
      expect(new Set(outline.vertices.slice(0, -1)).size).toBe(4);
    }
  });

  it('is deterministic for identical inputs', () => {
    const mesh = createGridMesh(3, 3);
    const cellOwnership: Record<string, string> = {};
    for (let i = 0; i < mesh.cellCount; i++) {
      cellOwnership[String(i)] = i % 2 === 0 ? 'alpha' : 'beta';
    }
    const cellCantons: Record<string, string> = {
      '0': 'alpha-a',
      '2': 'beta-a',
      '4': 'alpha-b',
      '6': 'beta-b',
    };

    const first = computeCantonViewBorders({ cellOwnership, cellCantons, mesh });
    const second = computeCantonViewBorders({ cellOwnership, cellCantons, mesh });
    expect(first).toEqual(second);
  });
});

describe('border styling helpers', () => {
  it('darkens colors while preserving alpha', () => {
    const base: RgbaColor = { r: 120, g: 150, b: 200, a: 0.4 };
    const darker = darkenColor(base, 0.3);
    expect(darker.r).toBeLessThan(base.r);
    expect(darker.g).toBeLessThan(base.g);
    expect(darker.b).toBeLessThan(base.b);
    expect(darker.a).toBe(base.a);
  });

  it('lightens colors while preserving alpha', () => {
    const base: RgbaColor = { r: 40, g: 80, b: 120, a: 0.4 };
    const lighter = lightenColor(base, 0.25);
    expect(lighter.r).toBeGreaterThan(base.r);
    expect(lighter.g).toBeGreaterThan(base.g);
    expect(lighter.b).toBeGreaterThan(base.b);
    expect(lighter.a).toBe(base.a);
  });
});
