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

interface LabColor {
  l: number;
  a: number;
  b: number;
}

const SAFE_SATURATION_MIN = 0.4;
const SAFE_SATURATION_MAX = 0.9;
const SAFE_LIGHTNESS_MIN = 0.26;
const SAFE_LIGHTNESS_MAX = 0.78;
const BACKGROUND_COLOR: RgbaColor = { r: 28, g: 46, b: 64, a: 1 };
const BACKGROUND_HSL = rgbaToHsl(BACKGROUND_COLOR);
const BACKGROUND_LAB = rgbaToLab(BACKGROUND_COLOR);

export const CANTON_CONTRAST_CONFIG = {
  minNeighborDeltaE: 24,
  minNeighborLightness: 0.14,
  minBackgroundDeltaE: 26,
  minBackgroundLightness: 0.18,
  backgroundColor: BACKGROUND_COLOR,
} as const;
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

function srgbToLinear(channel: number): number {
  const c = clamp(channel, 0, 255) / 255;
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbaToLab(color: RgbaColor): LabColor {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

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

  const xr = x / xRef;
  const yr = y / yRef;
  const zr = z / zRef;

  const fx = pivot(xr);
  const fy = pivot(yr);
  const fz = pivot(zr);

  const l = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return { l, a, b: bVal };
}

function deltaE(labA: LabColor, labB: LabColor): number {
  const dl = labA.l - labB.l;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dl * dl + da * da + db * db);
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

interface ShadeRecord {
  rgba: RgbaColor;
  hsl: HslColor;
  lab: LabColor;
}

function arrangeExtremes(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const result: number[] = [];
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    if (low === high) {
      result.push(sorted[high]);
      break;
    }
    if (result.length % 2 === 0) {
      result.push(sorted[high]);
      high--;
    } else {
      result.push(sorted[low]);
      low++;
    }
  }
  return result;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildShadePalette(count: number, base: HslColor, rng: () => number): HslColor[] {
  const baseS = clamp(base.s, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX);
  const baseL = clamp(base.l, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX);

  if (count === 1) {
    const soloL = clamp(baseL + 0.1, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX);
    const soloS = clamp(baseS + 0.08, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX);
    return [{ h: base.h, s: soloS, l: soloL, a: base.a }];
  }

  const spanL = Math.min(0.46, 0.28 + count * 0.025);
  const spanS = Math.min(0.34, 0.18 + count * 0.02);

  const minL = clamp(baseL - spanL / 2, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX - 0.01);
  const maxL = clamp(baseL + spanL / 2, minL + 0.01, SAFE_LIGHTNESS_MAX);
  const minS = clamp(baseS - spanS / 2, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX - 0.01);
  const maxS = clamp(baseS + spanS / 2, minS + 0.01, SAFE_SATURATION_MAX);

  const lightnessSteps: number[] = [];
  const saturationSteps: number[] = [];

  for (let i = 0; i < count; i++) {
    const fraction = count === 1 ? 0.5 : i / (count - 1);
    const baseOffset = (rng() - 0.5) * 0.02;
    lightnessSteps.push(
      clamp(minL + fraction * (maxL - minL) + baseOffset, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
    );
    saturationSteps.push(
      clamp(minS + (1 - fraction) * (maxS - minS) - baseOffset, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
    );
  }

  const arrangedLightness = arrangeExtremes(lightnessSteps);
  const arrangedSaturation = shuffleWithRng(arrangeExtremes(saturationSteps), rng);

  return arrangedLightness.map((lightness, index) => ({
    h: base.h,
    s: arrangedSaturation[index % arrangedSaturation.length],
    l: lightness,
    a: base.a,
  }));
}

function toShadeRecord(hsl: HslColor): ShadeRecord {
  const clamped: HslColor = {
    h: hsl.h,
    s: clamp(hsl.s, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
    l: clamp(hsl.l, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
    a: hsl.a,
  };
  const rgba = hslToRgba(clamped);
  return { rgba, hsl: clamped, lab: rgbaToLab(rgba) };
}

function candidateMeetsConstraints(candidate: HslColor, neighbors: ShadeRecord[]): boolean {
  const record = toShadeRecord(candidate);
  const backgroundDelta = deltaE(record.lab, BACKGROUND_LAB);
  const backgroundLightnessDiff = Math.abs(record.hsl.l - BACKGROUND_HSL.l);
  if (
    backgroundDelta < CANTON_CONTRAST_CONFIG.minBackgroundDeltaE ||
    backgroundLightnessDiff < CANTON_CONTRAST_CONFIG.minBackgroundLightness
  ) {
    return false;
  }

  for (const neighbor of neighbors) {
    const neighborDelta = deltaE(record.lab, neighbor.lab);
    const lightnessGap = Math.abs(record.hsl.l - neighbor.hsl.l);
    if (
      neighborDelta < CANTON_CONTRAST_CONFIG.minNeighborDeltaE ||
      lightnessGap < CANTON_CONTRAST_CONFIG.minNeighborLightness
    ) {
      return false;
    }
  }

  return true;
}

function refineShade(
  initial: HslColor,
  neighbors: ShadeRecord[],
  notes: string[],
): HslColor {
  let current: HslColor = {
    h: initial.h,
    s: clamp(initial.s, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
    l: clamp(initial.l, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
    a: initial.a,
  };

  for (let iteration = 0; iteration < 24; iteration++) {
    const record = toShadeRecord(current);
    const backgroundDelta = deltaE(record.lab, BACKGROUND_LAB);
    const backgroundLightnessDiff = Math.abs(record.hsl.l - BACKGROUND_HSL.l);

    const violatingNeighbors = neighbors.filter((neighbor) => {
      const neighborDelta = deltaE(record.lab, neighbor.lab);
      const lightnessGap = Math.abs(record.hsl.l - neighbor.hsl.l);
      return (
        neighborDelta < CANTON_CONTRAST_CONFIG.minNeighborDeltaE ||
        lightnessGap < CANTON_CONTRAST_CONFIG.minNeighborLightness
      );
    });

    let updated = false;

    if (violatingNeighbors.length > 0) {
      const targetLightness: number[] = [];
      for (const neighbor of violatingNeighbors) {
        const direction = current.l <= neighbor.hsl.l ? -1 : 1;
        const lightTarget = neighbor.hsl.l +
          direction * (CANTON_CONTRAST_CONFIG.minNeighborLightness + 0.03);
        targetLightness.push(lightTarget);
      }
      const proposedL = clamp(average(targetLightness), SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX);
      if (Math.abs(proposedL - current.l) >= 0.002) {
        notes.push(`lightness ${current.l.toFixed(3)} -> ${proposedL.toFixed(3)}`);
        current = { ...current, l: proposedL };
        updated = true;
      } else {
        const targetSaturation: number[] = [];
        for (const neighbor of violatingNeighbors) {
          const direction = current.s <= neighbor.hsl.s ? -1 : 1;
          targetSaturation.push(
            clamp(
              current.s + direction * (0.1 + iteration * 0.01),
              SAFE_SATURATION_MIN,
              SAFE_SATURATION_MAX,
            ),
          );
        }
        const proposedS = clamp(average(targetSaturation), SAFE_SATURATION_MIN, SAFE_SATURATION_MAX);
        if (Math.abs(proposedS - current.s) >= 0.002) {
          notes.push(`saturation ${current.s.toFixed(3)} -> ${proposedS.toFixed(3)}`);
          current = { ...current, s: proposedS };
          updated = true;
        }
      }

      if (!updated) {
        const minExtremeL = Math.max(
          SAFE_LIGHTNESS_MIN,
          BACKGROUND_HSL.l + CANTON_CONTRAST_CONFIG.minBackgroundLightness + 0.02,
        );
        for (const neighbor of violatingNeighbors) {
          const satDirection = current.s <= neighbor.hsl.s ? -1 : 1;
          const satExtreme = satDirection === -1 ? SAFE_SATURATION_MIN : SAFE_SATURATION_MAX;
          const lightExtreme = current.l <= neighbor.hsl.l ? minExtremeL : SAFE_LIGHTNESS_MAX;
          if (
            Math.abs(current.s - satExtreme) >= 0.01 ||
            Math.abs(current.l - lightExtreme) >= 0.01
          ) {
            notes.push(
              `extreme contrast l:${current.l.toFixed(3)}->${lightExtreme.toFixed(3)} s:${current.s.toFixed(3)}->${satExtreme.toFixed(3)}`,
            );
            current = { ...current, s: satExtreme, l: lightExtreme };
            updated = true;
            break;
          }
        }
      }
    }

    if (
      !updated &&
      (backgroundDelta < CANTON_CONTRAST_CONFIG.minBackgroundDeltaE ||
        backgroundLightnessDiff < CANTON_CONTRAST_CONFIG.minBackgroundLightness)
    ) {
      const desiredOffsets = [
        CANTON_CONTRAST_CONFIG.minBackgroundLightness + 0.03,
        CANTON_CONTRAST_CONFIG.minBackgroundLightness + 0.07,
      ];
      const candidateLightness = new Set<number>();
      for (const offset of desiredOffsets) {
        candidateLightness.add(
          clamp(BACKGROUND_HSL.l + offset, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
        );
        candidateLightness.add(
          clamp(BACKGROUND_HSL.l - offset, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
        );
      }
      candidateLightness.add(SAFE_LIGHTNESS_MIN);
      candidateLightness.add(SAFE_LIGHTNESS_MAX);

      const viable = Array.from(candidateLightness)
        .filter(
          (value) =>
            Math.abs(value - BACKGROUND_HSL.l) >=
              CANTON_CONTRAST_CONFIG.minBackgroundLightness - 0.002 &&
            Math.abs(value - current.l) >= 0.002,
        )
        .sort((a, b) => Math.abs(a - current.l) - Math.abs(b - current.l));

      if (viable.length > 0) {
        const proposedL = viable[0];
        notes.push(`background lightness ${current.l.toFixed(3)} -> ${proposedL.toFixed(3)}`);
        current = { ...current, l: proposedL };
        updated = true;
      } else {
        const direction = current.l <= BACKGROUND_HSL.l ? 1 : -1;
        const proposedS = clamp(
          current.s + direction * 0.1,
          SAFE_SATURATION_MIN,
          SAFE_SATURATION_MAX,
        );
        if (Math.abs(proposedS - current.s) >= 0.002) {
          notes.push(`background saturation ${current.s.toFixed(3)} -> ${proposedS.toFixed(3)}`);
          current = { ...current, s: proposedS };
          updated = true;
        }
      }
    }

    if (!updated) {
      break;
    }
  }

  return current;
}

function enforceUniqueness(
  initial: HslColor,
  neighbors: ShadeRecord[],
  used: Set<string>,
  notes: string[],
): HslColor {
  let candidate = initial;
  let rgba = hslToRgba(candidate);
  let key = colorKey(rgba);

  for (let attempt = 0; attempt < 12; attempt++) {
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }

    const lightDirection = attempt % 2 === 0 ? 1 : -1;
    const satDirection = attempt % 3 === 0 ? -1 : 1;
    const lightAdjustment = 0.02 + attempt * 0.01;
    const satAdjustment = 0.018 + attempt * 0.009;
    const proposed: HslColor = {
      ...candidate,
      l: clamp(candidate.l + lightDirection * lightAdjustment, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
      s: clamp(candidate.s + satDirection * satAdjustment, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
    };
    notes.push(
      `uniqueness adjust l:${candidate.l.toFixed(3)}->${proposed.l.toFixed(3)} s:${candidate.s.toFixed(3)}->${proposed.s.toFixed(3)}`,
    );
    candidate = refineShade(proposed, neighbors, notes);
    rgba = hslToRgba(candidate);
    key = colorKey(rgba);
  }

  while (used.has(key)) {
    const bump = 0.015 * (used.size + 1);
    const proposed: HslColor = {
      ...candidate,
      l: clamp(candidate.l + bump, SAFE_LIGHTNESS_MIN, SAFE_LIGHTNESS_MAX),
      s: clamp(candidate.s - bump * 0.6, SAFE_SATURATION_MIN, SAFE_SATURATION_MAX),
    };
    notes.push(
      `uniqueness fallback l:${candidate.l.toFixed(3)}->${proposed.l.toFixed(3)} s:${candidate.s.toFixed(3)}->${proposed.s.toFixed(3)}`,
    );
    candidate = refineShade(proposed, neighbors, notes);
    rgba = hslToRgba(candidate);
    key = colorKey(rgba);
  }

  used.add(key);
  return candidate;
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
  const uniqueSet = new Set(uniqueCantons);
  const adjacency = options.adjacency ?? new Map<string, Set<string>>();
  const rng = createSeededRng(`${options.seed ?? 'default'}::${nationId}`);

  const prioritized = uniqueCantons
    .slice()
    .sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b));

  const order = shuffleWithRng(prioritized, rng);

  const baseHsl = rgbaToHsl(baseColor);
  const palette = buildShadePalette(order.length, { ...baseHsl, a: baseColor.a }, rng);
  const available = palette.map((hsl, index) => ({ index, hsl }));

  const shades: Record<string, RgbaColor> = {};
  const usedKeys = new Set<string>();
  const shadeRecords = new Map<string, ShadeRecord>();
  const adjustmentNotes: Record<string, string[]> = {};

  for (const cantonId of order) {
    const neighbors = Array.from(adjacency.get(cantonId) ?? [])
      .filter((neighbor) => uniqueSet.has(neighbor))
      .sort();
    const neighborRecords = neighbors
      .map((neighborId) => shadeRecords.get(neighborId))
      .filter((record): record is ShadeRecord => Boolean(record));

    let candidateIndex = available.findIndex((candidate) =>
      candidateMeetsConstraints(candidate.hsl, neighborRecords),
    );
    if (candidateIndex === -1) {
      candidateIndex = 0;
    }

    const [candidate] = available.splice(candidateIndex, 1);
    const notes: string[] = [];
    let refined = refineShade(candidate.hsl, neighborRecords, notes);
    refined = enforceUniqueness(refined, neighborRecords, usedKeys, notes);

    const record = toShadeRecord({ ...refined, a: baseColor.a });
    shadeRecords.set(cantonId, record);
    shades[cantonId] = record.rgba;
    adjustmentNotes[cantonId] = notes;
  }

  const logPayload = {
    nationId,
    baseColor,
    cantonCount: uniqueCantons.length,
    shades: order.map((id) => ({
      cantonId: id,
      color: shades[id],
      adjustments: adjustmentNotes[id] ?? [],
    })),
  };

  console.log('[mapColors] canton palette', logPayload);

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
