import { LABOR_BY_UL } from '../development/manager';
import { WelfareManager } from '../welfare/manager';
import type { EconomyState, LaborPool, SectorType, TurnPlan } from '../types';

// Mapping of which labor type each sector primarily uses.
export const SECTOR_LABOR_TYPES: Record<SectorType, keyof LaborPool> = {
  agriculture: 'general',
  extraction: 'skilled',
  manufacturing: 'skilled',
  defense: 'skilled',
  luxury: 'skilled',
  finance: 'specialist',
  research: 'specialist',
  logistics: 'general',
  energy: 'skilled',
};

const emptyPool = (): LaborPool => ({ general: 0, skilled: 0, specialist: 0 });

/** Utility to convert a labor pool in counts to percentages and apply mix shift. */
function applyEducation(pool: LaborPool, shift: number): LaborPool {
  if (shift <= 0) return { ...pool };
  const total = pool.general + pool.skilled + pool.specialist;
  if (total <= 0) return { ...pool };
  const perc = {
    general: (pool.general / total) * 100,
    skilled: (pool.skilled / total) * 100,
    specialist: (pool.specialist / total) * 100,
  };
  const shifted = WelfareManager.applyLaborMixShift(perc, shift);
  const general = Math.round((shifted.general / 100) * total);
  const skilled = Math.round((shifted.skilled / 100) * total);
  const specialist = total - general - skilled; // ensure sum
  return { general, skilled, specialist };
}

export class LaborManager {
  /** Generate labor pools for each canton based on urbanization level and welfare. */
  static generate(economy: EconomyState): void {
    const mods = WelfareManager.getModifiers(economy);
    for (const canton of Object.values(economy.cantons)) {
      const base = LABOR_BY_UL[canton.urbanizationLevel] || emptyPool();
      const pool = applyEducation(base, mods.laborShift);
      canton.labor = { ...pool };
      canton.happiness = mods.happinessPerLabor;
      canton.laborDemand = {};
      canton.laborAssigned = {};
      canton.consumption = {
        foodRequired: 0,
        foodProvided: 0,
        luxuryRequired: 0,
        luxuryProvided: 0,
      };
      canton.shortages = { food: false, luxury: false };
      if (canton.lai === undefined) canton.lai = 1;
    }
  }

  /** Assign labor to funded sector slots within each canton. */
  static assign(economy: EconomyState, plan?: TurnPlan): void {
    const planPriorities = (plan?.slotPriorities || {}) as Partial<Record<SectorType, number>>;

    for (const canton of Object.values(economy.cantons)) {
      const available: LaborPool = { ...canton.labor };

      const entries: Array<{ sector: SectorType; demand: LaborPool }> = [];
      for (const [sectorKey, sectorState] of Object.entries(canton.sectors) as [
        SectorType,
        any,
      ][]) {
        if (!sectorState || sectorState.funded <= 0) continue; // only funded slots
        const laborType = SECTOR_LABOR_TYPES[sectorKey];
        const demand = emptyPool();
        demand[laborType] = sectorState.funded;
        canton.laborDemand[sectorKey] = { ...demand };
        entries.push({ sector: sectorKey, demand });
      }

      // Sort by plan priority then suitability then sector name for determinism.
      entries.sort((a, b) => {
        const pa = planPriorities[a.sector] ?? 0;
        const pb = planPriorities[b.sector] ?? 0;
        if (pa !== pb) return pa - pb;
        const sa = canton.suitability[a.sector] ?? 0;
        const sb = canton.suitability[b.sector] ?? 0;
        if (sa !== sb) return sb - sa; // higher suitability first
        return a.sector.localeCompare(b.sector);
      });

      const assignedBefore: Record<SectorType, LaborPool> = {};
      for (const entry of entries) {
        const assigned = emptyPool();
        (Object.keys(available) as (keyof LaborPool)[]).forEach((type) => {
          const need = entry.demand[type];
          const give = Math.min(available[type], need);
          assigned[type] = give;
          available[type] -= give;
        });
        assignedBefore[entry.sector] = assigned;
      }

      // Apply LAI scaling and update sector funded/idle
      for (const entry of entries) {
        const assigned = assignedBefore[entry.sector];
        const effective: LaborPool = {
          general: Math.floor(assigned.general * canton.lai),
          skilled: Math.floor(assigned.skilled * canton.lai),
          specialist: Math.floor(assigned.specialist * canton.lai),
        };
        canton.laborAssigned[entry.sector] = effective;

        const demand = canton.laborDemand[entry.sector]!;
        const effectiveTotal =
          effective.general + effective.skilled + effective.specialist;
        const demandTotal = demand.general + demand.skilled + demand.specialist;
        const unmet = demandTotal - effectiveTotal;
        const sectorState = canton.sectors[entry.sector];
        if (sectorState) {
          sectorState.idle += unmet;
          sectorState.funded = effectiveTotal;
        }
      }

      // leftover labor is discarded (no stockpiling) - canton.labor already records supply
    }
  }

  /** Record food and luxury consumption for assigned labor. */
  static consume(economy: EconomyState): void {
    for (const canton of Object.values(economy.cantons)) {
      let totalAssigned = 0;
      for (const assigned of Object.values(canton.laborAssigned)) {
        totalAssigned += assigned.general + assigned.skilled + assigned.specialist;
      }
      canton.consumption.foodRequired = totalAssigned;
      canton.consumption.luxuryRequired = totalAssigned;

      const foodProvided = Math.min(economy.resources.food, totalAssigned);
      economy.resources.food -= foodProvided;
      canton.consumption.foodProvided = foodProvided;
      if (foodProvided < totalAssigned) canton.shortages.food = true;

      const luxuryProvided = Math.min(economy.resources.luxury, totalAssigned);
      economy.resources.luxury -= luxuryProvided;
      canton.consumption.luxuryProvided = luxuryProvided;
      if (luxuryProvided < totalAssigned) canton.shortages.luxury = true;
    }
  }

  static run(economy: EconomyState, plan?: TurnPlan): void {
    this.generate(economy);
    this.assign(economy, plan);
    this.consume(economy);
  }
}

