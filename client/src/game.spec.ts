import { expect, test } from 'bun:test';
import { assignCantonFillColors, generateCantonShades, type HSLColor } from './game';

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

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

test('generateCantonShades yields distinct deterministic palette', () => {
  const base: HSLColor = { h: 210, s: 62, l: 48 };
  const shades = generateCantonShades(base, 6);
  expect(shades).toHaveLength(6);
  expect(unique(shades)).toBe(true);
  for (const shade of shades) {
    const parsed = parseHsla(shade);
    expect(Math.abs(parsed.h - base.h)).toBeLessThanOrEqual(1);
    expect(parsed.a).toBeCloseTo(0.68);
  }
  const lights = shades.map(shade => parseHsla(shade).l);
  expect(Math.max(...lights) - Math.min(...lights)).toBeGreaterThan(8);
});

test('assignCantonFillColors respects adjacency uniqueness', () => {
  const base: HSLColor = { h: 52, s: 70, l: 58 };
  const cantonIds = ['a', 'b', 'c', 'd'];
  const adjacency = {
    a: ['b'],
    b: ['a', 'c'],
    c: ['b', 'd'],
    d: ['c'],
  };
  const { fillByCanton } = assignCantonFillColors(cantonIds, base, adjacency);
  expect(Object.keys(fillByCanton)).toEqual(cantonIds);
  const pairs: Array<[string, string]> = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
  ];
  for (const [left, right] of pairs) {
    expect(fillByCanton[left]).not.toBe(fillByCanton[right]);
  }
});

test('assignCantonFillColors is deterministic for identical input', () => {
  const base: HSLColor = { h: 130, s: 55, l: 46 };
  const cantonIds = ['one', 'two', 'three', 'four', 'five'];
  const adjacency = {
    one: ['two', 'three'],
    two: ['one', 'four'],
    three: ['one', 'five'],
    four: ['two'],
    five: ['three'],
  };
  const first = assignCantonFillColors(cantonIds, base, adjacency);
  const second = assignCantonFillColors(cantonIds, base, adjacency);
  expect(second.fillByCanton).toEqual(first.fillByCanton);
});
