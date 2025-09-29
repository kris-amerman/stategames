import { MapViewMode } from './mapViewState';

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface MapColoringInput {
  cellCount: number;
  cellOwnership: Record<string, string>;
  cellCantons?: Record<string, string | undefined>;
  nationCantons?: Record<string, string[]>;
  baseColors: Record<string, RgbaColor>;
  cantonAdjacency?: Map<string, Set<string>>;
  seed?: string | null;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
  a: number;
}

const SAFE_SATURATION_MIN = 0.45;
const SAFE_SATURATION_MAX = 0.85;
const SAFE_LIGHTNESS_MIN = 0.3;
const SAFE_LIGHTNESS_MAX = 0.72;
const FALLBACK_PREFIX = '__fallback__';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function cloneColor(color: RgbaColor): RgbaColor {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

function colorKey(color: RgbaColor): string {
  return `${clampByte(color.r)}|${clampByte(color.g)}|${clampByte(color.b)}`;
}

function enforceDistinctCandidate(base: RgbaColor, used: Set<string>): RgbaColor {
  const baseHsl = rgbaToHsl(base);
  let offset = 0.06;
  for (let i = 0; i < 8; i++) {
    const candidate = hslToRgba({
      h: baseHsl.h,
      s: clamp(baseHsl.s + offset, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
      l: clamp(baseHsl.l + offset, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
      a: base.a,
    });
    const key = colorKey(candidate);
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    offset = -offset * 1.2;
  }
  return cloneColor(base);
}

function rgbaToHsl(color: RgbaColor): HslColor {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l, a: color.a };
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgba(color: HslColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clamp(color.s, 0, 1);
  const l = clamp(color.l, 0, 1);
  const a = color.a;

  if (s === 0) {
    const gray = clampByte(l * 255);
    return { r: gray, g: gray, b: gray, a };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = hueToRgb(p, q, h / 360 + 1 / 3);
  const g = hueToRgb(p, q, h / 360);
  const b = hueToRgb(p, q, h / 360 - 1 / 3);

  return { r: clampByte(r * 255), g: clampByte(g * 255), b: clampByte(b * 255), a };
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ k, 597399067);
    h2 = Math.imul(h2 ^ k, 2869860233);
    h3 = Math.imul(h3 ^ k, 951274213);
    h4 = Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function createSeededRng(seed: string): () => number {
  const [a, b, c, d] = cyrb128(seed);
  return sfc32(a, b, c, d);
}

function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function resolveCantonId(
  cellKey: string,
  owner: string | undefined,
  cellCantons: Record<string, string | undefined>,
): string | null {
  const explicit = cellCantons[cellKey];
  if (explicit) return explicit;
  if (!owner) return null;
  return `${FALLBACK_PREFIX}${owner}`;
}

function filterAdjacency(source: Map<string, Set<string>>, allowed: string[]): Map<string, Set<string>> {
  const allowedSet = new Set(allowed);
  const filtered = new Map<string, Set<string>>();
  for (const id of allowed) {
    const neighbors = source.get(id);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!allowedSet.has(neighbor) || neighbor === id) continue;
      if (!filtered.has(id)) filtered.set(id, new Set());
      filtered.get(id)!.add(neighbor);
    }
  }
  return filtered;
}

function assignFallbackShade(base: RgbaColor, assigned: Record<string, RgbaColor>): RgbaColor {
  const used = new Set(Object.values(assigned).map(colorKey));
  const baseHsl = rgbaToHsl(base);
  let step = 0.05;
  for (let i = 0; i < 10; i++) {
    const candidate = hslToRgba({
      h: baseHsl.h,
      s: clamp(baseHsl.s + step, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
      l: clamp(baseHsl.l - step, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
      a: base.a,
    });
    const key = colorKey(candidate);
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    step = -step * 1.15;
  }
  return cloneColor(base);
}

export function assignCantonShades(
  nationId: string,
  cantonIds: string[],
  baseColor: RgbaColor,
  options: { adjacency?: Map<string, Set<string>>; seed?: string | null } = {},
): Record<string, RgbaColor> {
  if (cantonIds.length === 0) {
    return {};
  }

  const uniqueCantons = Array.from(new Set(cantonIds));
  const adjacency = options.adjacency ?? new Map<string, Set<string>>();
  const rng = createSeededRng(`${options.seed ?? 'default'}::${nationId}`);

  const prioritized = uniqueCantons
    .slice()
    .sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b));

  const order = shuffleWithRng(prioritized, rng);

  const baseHsl = rgbaToHsl(baseColor);
  const baseS = clamp(baseHsl.s, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX);
  const baseL = clamp(baseHsl.l, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX);
  const amplitudeL = Math.min(0.22, 0.12 + order.length * 0.015);
  const amplitudeS = Math.min(0.18, 0.08 + order.length * 0.012);

  const shades: Record<string, RgbaColor> = {};
  const used = new Set<string>();

  for (let i = 0; i < order.length; i++) {
    const cantonId = order[i];
    const direction = i % 2 === 0 ? 1 : -1;
    const magnitude = Math.floor(i / 2) + 1;
    const rangeFactor = Math.max(1, order.length);
    let lightShift = direction * (amplitudeL * (magnitude / rangeFactor));
    let satShift = direction * (amplitudeS * (magnitude / rangeFactor));
    lightShift += (rng() - 0.5) * 0.04;
    satShift += (rng() - 0.5) * 0.04;

    if (order.length === 1 && Math.abs(lightShift) < 0.05) {
      lightShift = 0.08;
      satShift = 0.06;
    }

    let candidate = hslToRgba({
      h: baseHsl.h,
      s: clamp(baseS + satShift, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
      l: clamp(baseL + lightShift, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
      a: baseColor.a,
    });

    let key = colorKey(candidate);
    let guard = 0;
    while (used.has(key) && guard < 6) {
      lightShift += (rng() - 0.5) * 0.06;
      satShift += (rng() - 0.5) * 0.05;
      candidate = hslToRgba({
        h: baseHsl.h,
        s: clamp(baseS + satShift, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
        l: clamp(baseL + lightShift, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
        a: baseColor.a,
      });
      key = colorKey(candidate);
      guard++;
    }

    if (used.has(key)) {
      candidate = enforceDistinctCandidate(baseColor, used);
      key = colorKey(candidate);
    } else {
      used.add(key);
    }

    shades[cantonId] = candidate;
  }

  return shades;
}

export function computeCellColors(mode: MapViewMode, input: MapColoringInput): Array<RgbaColor | null> {
  const result = new Array<RgbaColor | null>(Math.max(0, input.cellCount)).fill(null);

  if (mode === 'nation') {
    for (const [cellKey, owner] of Object.entries(input.cellOwnership)) {
      const color = input.baseColors[owner];
      if (!color) continue;
      const cellId = Number(cellKey);
      if (!Number.isFinite(cellId) || cellId < 0 || cellId >= result.length) continue;
      result[cellId] = cloneColor(color);
    }
    return result;
  }

  const cellCantons = input.cellCantons ?? {};
  const cantonAdjacency = input.cantonAdjacency ?? new Map<string, Set<string>>();
  const assignments: Record<string, RgbaColor> = {};
  const cantonCells = new Map<string, number[]>();
  const cantonNation = new Map<string, string>();
  const cantonsByNation = new Map<string, Set<string>>();

  for (const [cellKey, owner] of Object.entries(input.cellOwnership)) {
    if (!owner) continue;
    const cantonId = resolveCantonId(cellKey, owner, cellCantons);
    if (!cantonId) continue;
    cantonNation.set(cantonId, owner);
    let cells = cantonCells.get(cantonId);
    if (!cells) {
      cells = [];
      cantonCells.set(cantonId, cells);
    }
    const numericId = Number(cellKey);
    if (Number.isFinite(numericId) && numericId >= 0 && numericId < result.length) {
      cells.push(numericId);
    }
    let set = cantonsByNation.get(owner);
    if (!set) {
      set = new Set();
      cantonsByNation.set(owner, set);
    }
    set.add(cantonId);
  }

  for (const [nationId, cantonSet] of cantonsByNation.entries()) {
    const base = input.baseColors[nationId];
    if (!base) continue;
    const cantonIds = Array.from(cantonSet);
    if (cantonIds.length === 0) continue;
    const filteredAdjacency = filterAdjacency(cantonAdjacency, cantonIds);
    const shades = assignCantonShades(nationId, cantonIds, base, {
      adjacency: filteredAdjacency,
      seed: input.seed ?? undefined,
    });
    Object.assign(assignments, shades);
  }

  for (const [cantonId, cells] of cantonCells.entries()) {
    const shade = assignments[cantonId];
    if (!shade) {
      const owner = cantonNation.get(cantonId);
      if (!owner) continue;
      const base = input.baseColors[owner];
      if (!base) continue;
      const fallback = assignFallbackShade(base, assignments);
      assignments[cantonId] = fallback;
      for (const cellId of cells) {
        if (cellId >= 0 && cellId < result.length) {
          result[cellId] = cloneColor(fallback);
        }
      }
      continue;
    }
    for (const cellId of cells) {
      if (cellId >= 0 && cellId < result.length) {
        result[cellId] = cloneColor(shade);
      }
    }
  }

  return result;
}

export function rgbaToCss(color: RgbaColor): string {
  const r = clampByte(color.r);
  const g = clampByte(color.g);
  const b = clampByte(color.b);
  const alpha = clamp(color.a, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildCantonAdjacency(
  cellCantons: Record<string, string | undefined>,
  cellOwnership: Record<string, string>,
  cellOffsets: Uint32Array,
  cellNeighbors: Int32Array,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const totalCells = cellOffsets.length - 1;

  for (let cellId = 0; cellId < totalCells; cellId++) {
    const owner = cellOwnership[cellId] ?? cellOwnership[String(cellId)];
    if (!owner) continue;
    const cellKey = String(cellId);
    const cantonId = resolveCantonId(cellKey, owner, cellCantons);
    if (!cantonId) continue;

    for (let ptr = cellOffsets[cellId]; ptr < cellOffsets[cellId + 1]; ptr++) {
      const neighborId = cellNeighbors[ptr];
      if (neighborId < 0 || neighborId >= totalCells) continue;
      const neighborOwner = cellOwnership[neighborId] ?? cellOwnership[String(neighborId)];
      if (neighborOwner !== owner) continue;
      const neighborKey = String(neighborId);
      const neighborCanton = resolveCantonId(neighborKey, neighborOwner, cellCantons);
      if (!neighborCanton || neighborCanton === cantonId) continue;
      if (!adjacency.has(cantonId)) adjacency.set(cantonId, new Set());
      adjacency.get(cantonId)!.add(neighborCanton);
      if (!adjacency.has(neighborCanton)) adjacency.set(neighborCanton, new Set());
      adjacency.get(neighborCanton)!.add(cantonId);
    }
  }

  return adjacency;
}
