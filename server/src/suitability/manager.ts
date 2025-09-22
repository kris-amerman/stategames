import type {
  CantonEconomy,
  EconomyState,
  GeographyModifiers,
  SectorType,
  SuitabilityResult,
  TileType,
  UrbanizationModifiers,
} from '../types';

// Sectors that use suitability (energy handled elsewhere)
const SUITABILITY_SECTORS: SectorType[] = [
  'agriculture',
  'extraction',
  'manufacturing',
  'defense',
  'luxury',
  'finance',
  'research',
  'logistics',
];

/** Utility to encode tile shares for cache key */
function encodeShares(geo: Record<TileType, number>): string {
  return Object.entries(geo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

export class SuitabilityManager {
  private static geoModifiers: GeographyModifiers = {};
  private static ulModifiers: UrbanizationModifiers = {};

  // cache per canton: last UL, tile hash, results
  private static cache: Record<
    string,
    { ul: number; hash: string; results: Record<SectorType, SuitabilityResult> }
  > = {};

  /** Allow external injection of geography modifiers */
  static setGeographyModifiers(mods: GeographyModifiers): void {
    this.geoModifiers = mods;
    // invalidate cache entirely
    this.cache = {};
  }

  /** Allow external injection of urbanization level modifiers */
  static setUrbanizationModifiers(mods: UrbanizationModifiers): void {
    this.ulModifiers = mods;
    this.cache = {};
  }

  /** Retrieve suitability result for canton-sector pair from cache */
  static get(cantonId: string, sector: SectorType): SuitabilityResult | undefined {
    return this.cache[cantonId]?.results[sector];
  }

  /** Compute suitability for all cantons and sectors. */
  static run(economy: EconomyState): Record<string, Record<SectorType, SuitabilityResult>> {
    const output: Record<string, Record<SectorType, SuitabilityResult>> = {};

    for (const [cantonId, canton] of Object.entries(economy.cantons)) {
      const hash = encodeShares(canton.geography);
      const ul = canton.urbanizationLevel;
      let cached = this.cache[cantonId];
      if (cached && cached.hash === hash && cached.ul === ul) {
        output[cantonId] = cached.results;
      } else {
        const results: Record<SectorType, SuitabilityResult> = {} as any;
        for (const sector of SUITABILITY_SECTORS) {
          results[sector] = this.computeSector(canton, sector);
        }
        cached = { ul, hash, results };
        this.cache[cantonId] = cached;
        output[cantonId] = results;
      }

      // update canton caches for percent and multiplier
      for (const sector of SUITABILITY_SECTORS) {
        const res = cached.results[sector];
        canton.suitability[sector] = res.percent;
        canton.suitabilityMultipliers[sector] = res.multiplier;
      }
    }

    return output;
  }

  private static computeSector(canton: CantonEconomy, sector: SectorType): SuitabilityResult {
    const geoMods = this.geoModifiers[sector] || {};
    let tfpRaw = 0;
    let total = 0;
    for (const [tile, share] of Object.entries(canton.geography) as [TileType, number][]) {
      const mod = geoMods[tile] ?? 0;
      tfpRaw += share * mod;
      total += share;
    }
    if (total > 0 && Math.abs(total - 1) > 1e-6) {
      tfpRaw /= total; // normalize if shares don't sum to 1
    }
    const ulMod = this.ulModifiers[sector]?.[canton.urbanizationLevel] ?? 0;
    const combined = tfpRaw + ulMod;
    // round to nearest whole percent
    const rounded = Math.round(combined);
    // clamp
    const clamped = Math.min(Math.max(rounded, -60), 50);
    const multiplier = 1 + clamped / 100;
    return { percent: clamped, multiplier };
  }
}
