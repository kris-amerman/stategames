import { describe, it, expect, beforeEach } from 'vitest';
import { assignCantonShades, computeCellColors, RgbaColor } from './mapColors';
import { resetMapViewStateForTests } from './mapViewState';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

function colorSignature(color: RgbaColor | null): string {
  if (!color) return 'null';
  return `${color.r}-${color.g}-${color.b}-${color.a}`;
}

const BASE_COLORS: Record<string, RgbaColor> = {
  alpha: { r: 210, g: 70, b: 70, a: 0.3 },
  beta: { r: 60, g: 135, b: 215, a: 0.3 },
};

(runInVitest ? describe : describe.skip)('map color assignments', () => {
  beforeEach(() => {
    resetMapViewStateForTests();
  });

  it('keeps nation view restricted to base colors', () => {
    const cellOwnership = { '0': 'alpha', '1': 'alpha', '2': 'beta' };
    const colors = computeCellColors('nation', {
      cellCount: 3,
      cellOwnership,
      baseColors: BASE_COLORS,
    });

    expect(colors[0]).toEqual(BASE_COLORS.alpha);
    expect(colors[1]).toEqual(BASE_COLORS.alpha);
    expect(colors[2]).toEqual(BASE_COLORS.beta);
  });

  it('assigns unique canton shades with matching opacity', () => {
    const cantonIds = ['a-1', 'a-2', 'a-3'];
    const adjacency = new Map<string, Set<string>>([
      ['a-1', new Set(['a-2'])],
      ['a-2', new Set(['a-1', 'a-3'])],
      ['a-3', new Set(['a-2'])],
    ]);

    const shades = assignCantonShades('alpha', cantonIds, BASE_COLORS.alpha, {
      adjacency,
      seed: 'test-seed',
    });

    const uniqueSignatures = new Set(Object.values(shades).map(colorSignature));
    expect(uniqueSignatures.size).toBe(cantonIds.length);
    expect(Object.values(shades).every((shade) => shade.a === BASE_COLORS.alpha.a)).toBe(true);
    expect(colorSignature(shades['a-1'])).not.toEqual(colorSignature(shades['a-2']));
    expect(colorSignature(shades['a-2'])).not.toEqual(colorSignature(shades['a-3']));
  });

  it('renders canton view with deterministic distinct shades', () => {
    const cellOwnership = { '0': 'alpha', '1': 'alpha', '2': 'beta', '3': 'beta' };
    const cellCantons = { '0': 'a-1', '1': 'a-2', '2': 'b-1', '3': 'b-2' };
    const adjacency = new Map<string, Set<string>>([
      ['a-1', new Set(['a-2'])],
      ['a-2', new Set(['a-1'])],
      ['b-1', new Set(['b-2'])],
      ['b-2', new Set(['b-1'])],
    ]);

    const colorsFirst = computeCellColors('canton', {
      cellCount: 4,
      cellOwnership,
      cellCantons,
      baseColors: BASE_COLORS,
      cantonAdjacency: adjacency,
      seed: 'canton-seed',
    });

    const colorsSecond = computeCellColors('canton', {
      cellCount: 4,
      cellOwnership,
      cellCantons,
      baseColors: BASE_COLORS,
      cantonAdjacency: adjacency,
      seed: 'canton-seed',
    });

    expect(colorSignature(colorsFirst[0])).not.toEqual(colorSignature(BASE_COLORS.alpha));
    expect(colorSignature(colorsFirst[0])).not.toEqual(colorSignature(colorsFirst[1]));
    expect(colorSignature(colorsFirst[2])).not.toEqual(colorSignature(colorsFirst[3]));
    expect(colorsFirst.map(colorSignature)).toEqual(colorsSecond.map(colorSignature));
    expect(colorsFirst.every((color) => !color || color.a === BASE_COLORS.alpha.a || color.a === BASE_COLORS.beta.a)).toBe(true);
  });
});
