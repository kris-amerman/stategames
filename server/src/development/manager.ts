import type { EconomyState, DecayFlags, LaborPool, SectorType } from '../types';

/** Placeholder mapping of sector slot capacity by Urbanization Level. */
export const SECTOR_SLOTS_BY_UL: Record<number, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [i + 1, (i + 1) * 10]),
);

/** Placeholder labor generation mix by Urbanization Level. */
export const LABOR_BY_UL: Record<number, LaborPool> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [
    i + 1,
    {
      general: (i + 1) * 5,
      skilled: Math.floor((i + 1) * 1.5),
      specialist: Math.floor((i + 1) / 2),
    },
  ]),
);

/** Placeholder suitability modifiers by Urbanization Level and sector. */
export const SUITABILITY_BY_UL: Record<number, Partial<Record<SectorType, number>>> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [i + 1, {}]),
);

export interface DevelopmentInput {
  baseRoll: number;
  modifiers?: number[];
  cap?: number;
  decayFlags?: DecayFlags;
}

/** Handles Development meter progress and Urbanization Level changes. */
export class DevelopmentManager {
  /** Apply development rolls and decay flags for all cantons. */
  static run(economy: EconomyState, inputs: Record<string, DevelopmentInput>): void {
    for (const [id, canton] of Object.entries(economy.cantons)) {
      const input = inputs[id] ?? { baseRoll: 0 };
      const mods = input.modifiers?.reduce((a, b) => a + b, 0) ?? 0;
      let gain = input.baseRoll + mods;
      if (typeof input.cap === 'number') gain = Math.min(gain, input.cap);
      let meter = canton.development + gain;
      if (meter < 0) meter = 0;
      let nextUL = canton.urbanizationLevel;
      const flags = input.decayFlags;
      const decays = flags && (flags.siege || flags.energy || flags.food || flags.catastrophe);
      if (decays) {
        nextUL = Math.max(1, nextUL - 1);
        meter = 0;
      } else if (meter >= 4 && nextUL < 12) {
        meter -= 4;
        nextUL += 1;
      }
      if (meter > 4) meter = 4;
      canton.development = meter;
      canton.nextUrbanizationLevel = nextUL;
    }
  }

  /** Apply any Urbanization Level changes that take effect this turn. */
  static applyPending(economy: EconomyState): void {
    for (const canton of Object.values(economy.cantons)) {
      if (canton.nextUrbanizationLevel !== undefined) {
        canton.urbanizationLevel = Math.max(1, Math.min(12, canton.nextUrbanizationLevel));
      }
    }
  }
}

