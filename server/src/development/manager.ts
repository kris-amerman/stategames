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

      // 1. Aggregate modifiers and apply cap
      const mods = input.modifiers?.reduce((a, b) => a + b, 0) ?? 0;
      let roll = input.baseRoll + mods;
      if (typeof input.cap === 'number') roll = Math.min(roll, input.cap);

      // Development gain cannot be negative
      const gain = Math.max(0, roll);

      // 2. Advance development meter
      let meter = canton.development + gain;
      let nextUL = canton.urbanizationLevel;

      // Clamp meter lower bound before evaluating changes
      if (meter < 0) meter = 0;

      // 3. Check decay flags first
      const flags = input.decayFlags;
      const decays = !!(
        flags && (flags.siege || flags.energy || flags.food || flags.catastrophe)
      );
      if (decays) {
        nextUL = Math.max(1, nextUL - 1);
        meter = 0; // losing a level resets progress
      } else if (meter >= 4 && nextUL < 12) {
        // 4. UL increase with single-step rule and remainder carry
        nextUL += 1;
        meter -= 4;
        if (meter > 3) meter = 3; // prevent double-step
      }

      // 5. Enforce meter bounds when UL cannot increase further
      if (nextUL === 12 && meter > 4) meter = 4;
      if (meter > 4) meter = 4;

      canton.development = meter;
      // Record UL for next turn (one-turn lag)
      canton.nextUrbanizationLevel = nextUL;
    }
  }

  /** Apply any Urbanization Level changes that take effect this turn. */
  static applyPending(economy: EconomyState): void {
    for (const canton of Object.values(economy.cantons)) {
      if (canton.nextUrbanizationLevel !== undefined) {
        canton.urbanizationLevel = Math.max(
          1,
          Math.min(12, canton.nextUrbanizationLevel),
        );
        // Reset next level marker so changes only apply once
        canton.nextUrbanizationLevel = canton.urbanizationLevel;
      }
    }
  }
}

