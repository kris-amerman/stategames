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

// Stub labor supply by urbanization level.
const LABOR_SUPPLY_BY_UL: Record<number, LaborPool> = {
  1: { general: 5, skilled: 1, specialist: 0 },
  2: { general: 10, skilled: 3, specialist: 1 },
  3: { general: 15, skilled: 5, specialist: 2 },
};

const emptyPool = (): LaborPool => ({ general: 0, skilled: 0, specialist: 0 });

export class LaborManager {
  /** Generate labor pools for each canton based on urbanization level. */
  static generate(economy: EconomyState): void {
    for (const canton of Object.values(economy.cantons)) {
      const base = LABOR_SUPPLY_BY_UL[canton.urbanizationLevel] || emptyPool();
      canton.labor = { ...base };
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
    const priorities = (plan?.slotPriorities || {}) as Partial<Record<SectorType, number>>;

    for (const [cantonId, canton] of Object.entries(economy.cantons)) {
      const available: LaborPool = {
        general: Math.floor(canton.labor.general * canton.lai),
        skilled: Math.floor(canton.labor.skilled * canton.lai),
        specialist: Math.floor(canton.labor.specialist * canton.lai),
      };

      const entries: Array<{
        sector: SectorType;
        demand: LaborPool;
        priority: number;
        suitability: number;
      }> = [];

      for (const [sectorKey, sectorState] of Object.entries(canton.sectors) as [SectorType, any][]) {
        if (!sectorState || sectorState.funded <= 0) continue;
        const laborType = SECTOR_LABOR_TYPES[sectorKey];
        const demand = emptyPool();
        demand[laborType] = sectorState.funded;
        canton.laborDemand[sectorKey] = { ...demand };
        entries.push({
          sector: sectorKey,
          demand,
          priority: priorities[sectorKey] ?? 0,
          suitability: canton.suitability[sectorKey] ?? 0,
        });
      }

      // Sort by plan priority then suitability.
      entries.sort((a, b) => {
        if (a.priority === b.priority) return b.suitability - a.suitability;
        return a.priority - b.priority;
      });

      for (const entry of entries) {
        const assigned = emptyPool();
        (Object.keys(available) as (keyof LaborPool)[]).forEach((type) => {
          const need = entry.demand[type];
          const give = Math.min(available[type], need);
          assigned[type] = give;
          available[type] -= give;
        });
        canton.laborAssigned[entry.sector] = assigned;
      }

      // leftover labor is discarded (no stockpiling).
      canton.labor = available;
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
