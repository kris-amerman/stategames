import { expect, test } from 'bun:test';
import { generateCantonShades, type HSLColor } from './game';

function parseHsla(value: string): { h: number; s: number; l: number; a: number } {
  const match = value.match(/hsla\(([-\d.]+),\s*([-\d.]+)%?,\s*([-\d.]+)%?,\s*([-\d.]+)\)/i);
  if (!match) {
    throw new Error(`Invalid HSLA string: ${value}`);
  }
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
    a: Number(match[4]),
  };
}

test('generateCantonShades yields distinct deterministic palette', () => {
  const base: HSLColor = { h: 210, s: 62, l: 48 };
  const shades = generateCantonShades(base, 6);
  expect(shades).toHaveLength(6);
  expect(new Set(shades).size).toBe(6);
  for (const shade of shades) {
    const parsed = parseHsla(shade);
    expect(Math.abs(parsed.h - base.h)).toBeLessThanOrEqual(1);
    expect(parsed.a).toBeCloseTo(0.6);
  }
  const lights = shades.map(shade => parseHsla(shade).l);
  expect(Math.max(...lights) - Math.min(...lights)).toBeGreaterThan(3);
});

test('generateCantonShades assigns different colors to adjacent cantons', () => {
  const base: HSLColor = { h: 52, s: 70, l: 58 };
  const shades = generateCantonShades(base, 4);
  const adjacency: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
  ];
  for (const [a, b] of adjacency) {
    expect(shades[a]).not.toBe(shades[b]);
  }
});

test('generateCantonShades is stable for identical input', () => {
  const base: HSLColor = { h: 130, s: 55, l: 46 };
  const first = generateCantonShades(base, 5);
  const second = generateCantonShades(base, 5);
  expect(second).toEqual(first);
});
