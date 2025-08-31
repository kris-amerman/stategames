// server/src/energy/manager.ts
import type {
  EconomyState,
  SectorType,
  PlantRegistryEntry,
  PlantType,
  PlantAttributes,
} from '../types';

// === Plant Definitions ===
export const PLANT_ATTRIBUTES: Record<PlantType, PlantAttributes> = {
  coal: { fuelType: 'coal', baseOutput: 10, oAndMCost: 1, rcf: false },
  gas: { fuelType: 'oil', baseOutput: 10, oAndMCost: 1, rcf: false },
  oilPeaker: { fuelType: 'oil', baseOutput: 5, oAndMCost: 1, rcf: false },
  nuclear: { fuelType: 'uranium', baseOutput: 20, oAndMCost: 2, rcf: false },
  hydro: { fuelType: null, baseOutput: 8, oAndMCost: 1, rcf: false },
  wind: { fuelType: null, baseOutput: 6, oAndMCost: 1, rcf: true },
  solar: { fuelType: null, baseOutput: 5, oAndMCost: 1, rcf: true },
};

/** Renewable capacity factor applied to wind and solar generation. */
export const RENEWABLE_CAPACITY_FACTOR = 0.6;

// === Per-sector energy demand (stub values) ===
export const ENERGY_PER_SLOT: Record<SectorType, number> = {
  agriculture: 1,
  extraction: 1,
  manufacturing: 2,
  defense: 2,
  luxury: 1,
  finance: 0,
  research: 1,
  logistics: 1,
  energy: 0,
};

export interface EnergyContext {
  essentialsFirst?: boolean;
  priorityList?: SectorType[];
}

function sum(obj: Record<string, number>): number {
  return Object.values(obj).reduce((s, n) => s + n, 0);
}

/**
 * Scaffolding energy manager handling supply, demand and brownouts.
 */
export class EnergyManager {
  static run(state: EconomyState, ctx: EnergyContext = {}): void {
    const plants = state.energy.plants as PlantRegistryEntry[];
    let supply = 0;
    for (const plant of plants) {
      if (plant.status !== 'active') continue;
      const attrs = PLANT_ATTRIBUTES[plant.type];
      if (!attrs) continue;
      const output = attrs.baseOutput * (attrs.rcf ? RENEWABLE_CAPACITY_FACTOR : 1);
      supply += output;
    }

    const demandBySector: Partial<Record<SectorType, number>> = {};
    for (const canton of Object.values(state.cantons)) {
      for (const [sectorKey, secState] of Object.entries(canton.sectors) as [
        SectorType,
        any,
      ][]) {
        if (!secState || secState.funded <= 0) continue;
        const costPer = ENERGY_PER_SLOT[sectorKey] ?? 0;
        if (costPer <= 0) continue;
        demandBySector[sectorKey] =
          (demandBySector[sectorKey] ?? 0) + secState.funded * costPer;
      }
    }

    const totalDemand = sum(demandBySector as Record<string, number>);
    const ratioOverall = totalDemand > 0 ? Math.min(1, supply / totalDemand) : 1;

    state.energy.state = { supply, demand: totalDemand, ratio: ratioOverall };
    state.energy.demandBySector = demandBySector;
    state.energy.brownouts = [];

    if (totalDemand <= supply) return; // no brownouts

    const sectorRatios: Partial<Record<SectorType, number>> = {};
    if (ctx.essentialsFirst) {
      const priorities = ctx.priorityList ?? [
        'agriculture',
        'defense',
        'manufacturing',
      ];
      let remainingSupply = supply;
      const prioritized = new Set(priorities);
      for (const sector of priorities) {
        const d = demandBySector[sector] ?? 0;
        const alloc = Math.min(remainingSupply, d);
        sectorRatios[sector] = d > 0 ? alloc / d : 1;
        remainingSupply -= alloc;
      }
      const otherSectors = (Object.keys(demandBySector) as SectorType[]).filter(
        (s) => !prioritized.has(s),
      );
      const remainingDemand = otherSectors.reduce(
        (s, sec) => s + (demandBySector[sec] ?? 0),
        0,
      );
      const ratioOthers =
        remainingDemand > 0 ? Math.min(1, remainingSupply / remainingDemand) : 1;
      for (const sec of otherSectors) {
        sectorRatios[sec] = ratioOthers;
      }
    } else {
      for (const sec of Object.keys(demandBySector) as SectorType[]) {
        sectorRatios[sec] = ratioOverall;
      }
    }

    for (const [cantonId, canton] of Object.entries(state.cantons)) {
      for (const [sectorKey, secState] of Object.entries(canton.sectors) as [
        SectorType,
        any,
      ][]) {
        if (!secState || secState.funded <= 0) continue;
        const ratio = sectorRatios[sectorKey];
        if (ratio === undefined || ratio >= 1) continue;
        const before = secState.funded;
        const after = Math.floor(before * ratio);
        secState.funded = after;
        state.energy.brownouts.push({
          canton: cantonId,
          sector: sectorKey,
          before,
          after,
        });
        console.log(
          `Brownout: ${cantonId} ${sectorKey} ${before} -> ${after} (ratio ${ratio})`,
        );
      }
    }
  }
}

