import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assignCantonShades,
  computeCellColors,
  RgbaColor,
  CANTON_CONTRAST_CONFIG,
} from './mapColors';
import { resetMapViewStateForTests } from './mapViewState';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

function colorSignature(color: RgbaColor | null): string {
  if (!color) return 'null';
  return `${color.r}-${color.g}-${color.b}-${color.a}`;
}

interface LabColor {
  l: number;
  a: number;
  b: number;
}

interface HslMetrics {
  h: number;
  s: number;
  l: number;
}

function rgbaToHsl(color: RgbaColor): HslMetrics {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return { h, s, l };
}

function srgbToLinear(channel: number): number {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

function rgbaToLab(color: RgbaColor): LabColor {
  const r = srgbToLinear(color.r / 255);
  const g = srgbToLinear(color.g / 255);
  const b = srgbToLinear(color.b / 255);

  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;

  const xRef = 0.95047;
  const yRef = 1.0;
  const zRef = 1.08883;

  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;

  function pivot(n: number): number {
    if (n > epsilon) {
      return Math.cbrt(n);
    }
    return (kappa * n + 16) / 116;
  }

  const fx = pivot(x / xRef);
  const fy = pivot(y / yRef);
  const fz = pivot(z / zRef);

  return {
    l: Math.max(0, 116 * fy - 16),
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE(labA: LabColor, labB: LabColor): number {
  const dl = labA.l - labB.l;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

const BASE_COLORS: Record<string, RgbaColor> = {
  alpha: { r: 210, g: 70, b: 70, a: 0.3 },
  beta: { r: 60, g: 135, b: 215, a: 0.3 },
};

(runInVitest ? describe : describe.skip)('map color assignments', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMapViewStateForTests();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
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

  it('meets neighbor and background contrast targets', () => {
    const cantonIds = ['a-1', 'a-2', 'a-3', 'a-4'];
    const adjacency = new Map<string, Set<string>>([
      ['a-1', new Set(['a-2', 'a-3'])],
      ['a-2', new Set(['a-1', 'a-4'])],
      ['a-3', new Set(['a-1', 'a-4'])],
      ['a-4', new Set(['a-2', 'a-3'])],
    ]);

    const backgroundLab = rgbaToLab(CANTON_CONTRAST_CONFIG.backgroundColor);
    const backgroundHsl = rgbaToHsl(CANTON_CONTRAST_CONFIG.backgroundColor);

    const shades = assignCantonShades('alpha', cantonIds, BASE_COLORS.alpha, {
      adjacency,
      seed: 'contrast-seed',
    });

    const shadeMetrics = new Map<string, { hsl: HslMetrics; lab: LabColor }>();
    for (const [cantonId, color] of Object.entries(shades)) {
      const hsl = rgbaToHsl(color);
      const lab = rgbaToLab(color);
      shadeMetrics.set(cantonId, { hsl, lab });
      const backgroundDelta = deltaE(lab, backgroundLab);
      const backgroundLightnessDiff = Math.abs(hsl.l - backgroundHsl.l);
      expect(backgroundDelta).toBeGreaterThanOrEqual(CANTON_CONTRAST_CONFIG.minBackgroundDeltaE);
      expect(backgroundLightnessDiff).toBeGreaterThanOrEqual(
        CANTON_CONTRAST_CONFIG.minBackgroundLightness,
      );
    }

    const seenPairs = new Set<string>();
    for (const [cantonId, neighbors] of adjacency.entries()) {
      for (const neighbor of neighbors) {
        const pairKey = [cantonId, neighbor].sort().join('::');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const first = shadeMetrics.get(cantonId)!;
        const second = shadeMetrics.get(neighbor)!;
        expect(deltaE(first.lab, second.lab)).toBeGreaterThanOrEqual(
          CANTON_CONTRAST_CONFIG.minNeighborDeltaE,
        );
        expect(Math.abs(first.hsl.l - second.hsl.l)).toBeGreaterThanOrEqual(
          CANTON_CONTRAST_CONFIG.minNeighborLightness,
        );
      }
    }
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

    logSpy.mockClear();
    const colorsFirst = computeCellColors('canton', {
      cellCount: 4,
      cellOwnership,
      cellCantons,
      baseColors: BASE_COLORS,
      cantonAdjacency: adjacency,
      seed: 'canton-seed',
    });

    const firstLogs = logSpy.mock.calls.map((call) => JSON.stringify(call));
    logSpy.mockClear();

    const colorsSecond = computeCellColors('canton', {
      cellCount: 4,
      cellOwnership,
      cellCantons,
      baseColors: BASE_COLORS,
      cantonAdjacency: adjacency,
      seed: 'canton-seed',
    });

    const secondLogs = logSpy.mock.calls.map((call) => JSON.stringify(call));

    expect(colorSignature(colorsFirst[0])).not.toEqual(colorSignature(BASE_COLORS.alpha));
    expect(colorSignature(colorsFirst[0])).not.toEqual(colorSignature(colorsFirst[1]));
    expect(colorSignature(colorsFirst[2])).not.toEqual(colorSignature(colorsFirst[3]));
    expect(colorsFirst.map(colorSignature)).toEqual(colorsSecond.map(colorSignature));
    expect(colorsFirst.every((color) => !color || color.a === BASE_COLORS.alpha.a || color.a === BASE_COLORS.beta.a)).toBe(true);
    expect(secondLogs).toEqual(firstLogs);
  });
});
