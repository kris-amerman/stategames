// server/src/logistics/manager.ts
import type {
  EconomyState,
  SectorType,
} from '../types';

// === Constants ===

/** LP generated per active logistics slot. */
export const LP_PER_SLOT = 10;

/** Per-sector LP operating cost per funded slot. */
export const OPERATING_LP_COST: Record<SectorType, number> = {
  agriculture: 0.5,
  extraction: 1.5,
  manufacturing: 2.0,
  defense: 2.0,
  luxury: 1.0,
  finance: 0.1,
  research: 0.2,
  logistics: 0,
  energy: 0,
};

export type Mode = 'rail' | 'sea' | 'air';

interface ModeParams {
  costPerHop: number;
  sameTurnThreshold: number; // max hops for same-turn delivery
}

export const DOMESTIC_MODE_PARAMS: Record<Mode, ModeParams> = {
  sea: { costPerHop: 0.05, sameTurnThreshold: 2 },
  rail: { costPerHop: 0.1, sameTurnThreshold: 3 },
  air: { costPerHop: 0.25, sameTurnThreshold: Infinity }, // always same-turn
};

export type Gateway = 'port' | 'rail' | 'air';

interface GatewayParams {
  costPerHop: number;
  fxPerUnit: number;
}

export const GATEWAY_PARAMS: Record<Gateway, GatewayParams> = {
  port: { costPerHop: 0.1, fxPerUnit: 0.05 },
  rail: { costPerHop: 0.2, fxPerUnit: 0.1 },
  air: { costPerHop: 0.5, fxPerUnit: 0.2 },
};

// Essentials First priority list
export const ESSENTIAL_SECTOR_PRIORITY: SectorType[] = [
  'agriculture',
  'defense',
  'manufacturing',
  'research',
  'luxury',
  'extraction',
  'finance',
];

// === Types ===

export interface LPState {
  supply: number;
  demand_operating: number;
  demand_domestic: number;
  demand_international: number;
  lp_ratio: number;
}

export interface NetworkNode {
  connected: boolean;
  hops: number;
  capacity_per_turn: number;
}

export interface ShippingPlan {
  imports_by_good: Record<string, number>;
  exports_by_good: Record<string, number>;
}

export interface GoodAllocation {
  planned: number;
  after_lp_ratio: number;
}

export interface ModeAllocation {
  units_planned: number;
  units_after_lp_ratio: number;
  same_turn: boolean;
  queued_next_turn: number;
  imports: Record<string, GoodAllocation>;
  exports: Record<string, GoodAllocation>;
}

export interface GatewayAllocation {
  units_planned: number;
  units_after_lp_ratio: number;
  queued_next_turn: number;
  fx_cost: number;
  imports: Record<string, GoodAllocation>;
  exports: Record<string, GoodAllocation>;
}

export interface LogisticsContext {
  /** Network data per canton and mode */
  networks: Record<string, Partial<Record<Mode, NetworkNode>>>;
  /** Shipping plans per canton */
  domesticPlans: Record<string, ShippingPlan>;
  /** International shipping plans per gateway */
  internationalPlans: Partial<Record<Gateway, ShippingPlan>>;
  /** Capacity per international gateway */
  gatewayCapacities?: Partial<Record<Gateway, number>>;
  /** Optional Essentials First toggle */
  essentialsFirst?: boolean;
  /** Optional custom priority list */
  priorityList?: SectorType[];
}

export interface LogisticsResult {
  lp: LPState;
  operatingAllocations: Record<
    SectorType,
    { planned: number; after_lp: number }
  >;
  domesticAllocations: Record<string, Partial<Record<Mode, ModeAllocation>>>;
  internationalAllocations: Partial<Record<Gateway, GatewayAllocation>>;
}

// === Helper Functions ===

function sum(obj: Record<string, number>): number {
  return Object.values(obj).reduce((s, n) => s + n, 0);
}

function clonePlan(plan?: ShippingPlan): ShippingPlan {
  return {
    imports_by_good: { ...(plan?.imports_by_good ?? {}) },
    exports_by_good: { ...(plan?.exports_by_good ?? {}) },
  };
}

// === Manager ===

/**
 * Scaffolding logistics manager handling LP accounting and shipment allocation.
 */
export class LogisticsManager {
  static run(state: EconomyState, ctx: LogisticsContext): LogisticsResult {
    const lp: LPState = {
      supply: 0,
      demand_operating: 0,
      demand_domestic: 0,
      demand_international: 0,
      lp_ratio: 1,
    };

    // === LP Supply ===
    let logisticsSlots = 0;
    for (const canton of Object.values(state.cantons)) {
      logisticsSlots += canton.sectors.logistics?.funded ?? 0;
    }
    lp.supply = logisticsSlots * LP_PER_SLOT;

    // === Operating Demand ===
    const operatingAllocations: Record<
      SectorType,
      { planned: number; after_lp: number }
    > = {} as any;

    for (const canton of Object.values(state.cantons)) {
      for (const [sector, secState] of Object.entries(canton.sectors) as [
        SectorType,
        any,
      ][]) {
        const cost = (OPERATING_LP_COST[sector] ?? 0) * (secState.funded ?? 0);
        if (cost <= 0) continue;
        lp.demand_operating += cost;
        const alloc = (operatingAllocations[sector] ||= {
          planned: 0,
          after_lp: 0,
        });
        alloc.planned += cost;
      }
    }

    // === Domestic Shipping ===
    const domesticAllocations: Record<
      string,
      Partial<Record<Mode, ModeAllocation>>
    > = {};

    for (const [cantonId, plan] of Object.entries(ctx.domesticPlans)) {
      const networks = ctx.networks[cantonId] ?? {};
      const planCopy = clonePlan(plan);
      const modes: Mode[] = ['rail', 'sea', 'air'];
      // filter connected modes
      const connectedModes = modes.filter((m) => networks[m]?.connected);
      // sort by cost per hop; tie break Rail > Sea > Air
      connectedModes.sort((a, b) => {
        const costA =
          DOMESTIC_MODE_PARAMS[a].costPerHop * (networks[a]!.hops ?? 0);
        const costB =
          DOMESTIC_MODE_PARAMS[b].costPerHop * (networks[b]!.hops ?? 0);
        if (costA === costB) {
          const order = { rail: 0, sea: 1, air: 2 } as Record<Mode, number>;
          return order[a] - order[b];
        }
        return costA - costB;
      });

      for (const mode of connectedModes) {
        const node = networks[mode]!;
        const params = DOMESTIC_MODE_PARAMS[mode];
        const alloc: ModeAllocation = {
          units_planned: 0,
          units_after_lp_ratio: 0,
          same_turn: node.hops <= params.sameTurnThreshold,
          queued_next_turn: 0,
          imports: {},
          exports: {},
        };

        let capacity = node.capacity_per_turn;

        // Imports first
        const totalImports = sum(planCopy.imports_by_good);
        const importAlloc = Math.min(totalImports, capacity);
        if (importAlloc > 0) {
          for (const [good, qty] of Object.entries(planCopy.imports_by_good)) {
            const share = qty / totalImports;
            const shipped = importAlloc * share;
            alloc.imports[good] = { planned: shipped, after_lp_ratio: 0 };
            planCopy.imports_by_good[good] -= shipped;
          }
          capacity -= importAlloc;
          alloc.units_planned += importAlloc;
          lp.demand_domestic += importAlloc * params.costPerHop * node.hops;
        }

        // Exports next
        const totalExports = sum(planCopy.exports_by_good);
        const exportAlloc = Math.min(totalExports, capacity);
        if (exportAlloc > 0) {
          for (const [good, qty] of Object.entries(planCopy.exports_by_good)) {
            const share = qty / totalExports;
            const shipped = exportAlloc * share;
            alloc.exports[good] = { planned: shipped, after_lp_ratio: 0 };
            planCopy.exports_by_good[good] -= shipped;
          }
          alloc.units_planned += exportAlloc;
          lp.demand_domestic += exportAlloc * params.costPerHop * node.hops;
        }

        if (!alloc.units_planned) continue; // nothing shipped
        domesticAllocations[cantonId] = domesticAllocations[cantonId] || {};
        domesticAllocations[cantonId][mode] = alloc;
      }
    }

    // === International Shipping ===
    const internationalAllocations: Partial<Record<Gateway, GatewayAllocation>> = {};
    for (const [gateway, plan] of Object.entries(ctx.internationalPlans)) {
      const params = GATEWAY_PARAMS[gateway as Gateway];
      const planCopy = clonePlan(plan);
      let capacity = ctx.gatewayCapacities?.[gateway as Gateway] ?? Infinity;

      const alloc: GatewayAllocation = {
        units_planned: 0,
        units_after_lp_ratio: 0,
        queued_next_turn: 0,
        fx_cost: 0,
        imports: {},
        exports: {},
      };

      // Imports first
      const totalImports = sum(planCopy.imports_by_good);
      const importAlloc = Math.min(totalImports, capacity);
      if (importAlloc > 0) {
        for (const [good, qty] of Object.entries(planCopy.imports_by_good)) {
          const share = qty / totalImports;
          const shipped = importAlloc * share;
          alloc.imports[good] = { planned: shipped, after_lp_ratio: 0 };
          planCopy.imports_by_good[good] -= shipped;
        }
        capacity -= importAlloc;
        alloc.units_planned += importAlloc;
        lp.demand_international += importAlloc * params.costPerHop; // assume 1 hop
        alloc.fx_cost += importAlloc * params.fxPerUnit;
      }

      // Exports next
      const totalExports = sum(planCopy.exports_by_good);
      const exportAlloc = Math.min(totalExports, capacity);
      if (exportAlloc > 0) {
        for (const [good, qty] of Object.entries(planCopy.exports_by_good)) {
          const share = qty / totalExports;
          const shipped = exportAlloc * share;
          alloc.exports[good] = { planned: shipped, after_lp_ratio: 0 };
          planCopy.exports_by_good[good] -= shipped;
        }
        alloc.units_planned += exportAlloc;
        lp.demand_international += exportAlloc * params.costPerHop;
        alloc.fx_cost += exportAlloc * params.fxPerUnit;
      }

      if (!alloc.units_planned) continue;
      internationalAllocations[gateway as Gateway] = alloc;
    }

    const totalDemand =
      lp.demand_operating + lp.demand_domestic + lp.demand_international;
    lp.lp_ratio = totalDemand > 0 ? Math.min(1, lp.supply / totalDemand) : 1;

    const essentials = ctx.essentialsFirst ?? false;
    const priorityList = ctx.priorityList ?? ESSENTIAL_SECTOR_PRIORITY;

    if (!essentials) {
      const ratio = lp.lp_ratio;
      // Apply uniform ratio
      for (const alloc of Object.values(operatingAllocations)) {
        alloc.after_lp = alloc.planned * ratio;
      }
      for (const allocs of Object.values(domesticAllocations)) {
        for (const alloc of Object.values(allocs)) {
          alloc.units_after_lp_ratio = alloc.units_planned * ratio;
          alloc.queued_next_turn = alloc.same_turn
            ? 0
            : alloc.units_after_lp_ratio;
          for (const g of Object.values(alloc.imports)) {
            g.after_lp_ratio = g.planned * ratio;
          }
          for (const g of Object.values(alloc.exports)) {
            g.after_lp_ratio = g.planned * ratio;
          }
        }
      }
      for (const alloc of Object.values(internationalAllocations)) {
        alloc.units_after_lp_ratio = alloc.units_planned * ratio;
        alloc.queued_next_turn = alloc.units_after_lp_ratio; // always next turn
        alloc.fx_cost *= ratio;
        for (const g of Object.values(alloc.imports)) {
          g.after_lp_ratio = g.planned * ratio;
        }
        for (const g of Object.values(alloc.exports)) {
          g.after_lp_ratio = g.planned * ratio;
        }
      }
    } else {
      // Essentials-first allocation
      let supplyRemaining = lp.supply;
      const prioritizedDemand = priorityList.reduce(
        (sum, sector) => sum + (operatingAllocations[sector]?.planned ?? 0),
        0,
      );

      if (supplyRemaining <= prioritizedDemand) {
        // allocate sequentially until supply exhausted
        for (const sector of priorityList) {
          const alloc = operatingAllocations[sector];
          if (!alloc) continue;
          if (supplyRemaining >= alloc.planned) {
            alloc.after_lp = alloc.planned;
            supplyRemaining -= alloc.planned;
          } else {
            alloc.after_lp = supplyRemaining;
            supplyRemaining = 0;
            break;
          }
        }
        // all other sectors and shipping get zero
        for (const [sector, alloc] of Object.entries(operatingAllocations)) {
          if (!priorityList.includes(sector as SectorType)) {
            alloc.after_lp = 0;
          }
        }
        for (const allocs of Object.values(domesticAllocations)) {
          for (const alloc of Object.values(allocs)) {
            alloc.units_after_lp_ratio = 0;
            alloc.queued_next_turn = alloc.same_turn ? 0 : 0;
            for (const g of Object.values(alloc.imports)) g.after_lp_ratio = 0;
            for (const g of Object.values(alloc.exports)) g.after_lp_ratio = 0;
          }
        }
        for (const alloc of Object.values(internationalAllocations)) {
          alloc.units_after_lp_ratio = 0;
          alloc.queued_next_turn = 0;
          alloc.fx_cost = 0;
          for (const g of Object.values(alloc.imports)) g.after_lp_ratio = 0;
          for (const g of Object.values(alloc.exports)) g.after_lp_ratio = 0;
        }
      } else {
        // prioritized sectors get full
        for (const sector of priorityList) {
          const alloc = operatingAllocations[sector];
          if (alloc) {
            alloc.after_lp = alloc.planned;
          }
        }
        supplyRemaining -= prioritizedDemand;
        const remainingDemand = totalDemand - prioritizedDemand;
        const ratio = remainingDemand > 0 ? Math.min(1, supplyRemaining / remainingDemand) : 1;
        for (const [sector, alloc] of Object.entries(operatingAllocations)) {
          if (!priorityList.includes(sector as SectorType)) {
            alloc.after_lp = (alloc.planned ?? 0) * ratio;
          }
        }
        for (const allocs of Object.values(domesticAllocations)) {
          for (const alloc of Object.values(allocs)) {
            alloc.units_after_lp_ratio = alloc.units_planned * ratio;
            alloc.queued_next_turn = alloc.same_turn
              ? 0
              : alloc.units_after_lp_ratio;
            for (const g of Object.values(alloc.imports)) {
              g.after_lp_ratio = g.planned * ratio;
            }
            for (const g of Object.values(alloc.exports)) {
              g.after_lp_ratio = g.planned * ratio;
            }
          }
        }
        for (const alloc of Object.values(internationalAllocations)) {
          alloc.units_after_lp_ratio = alloc.units_planned * ratio;
          alloc.queued_next_turn = alloc.units_after_lp_ratio;
          alloc.fx_cost *= ratio;
          for (const g of Object.values(alloc.imports)) g.after_lp_ratio = g.planned * ratio;
          for (const g of Object.values(alloc.exports)) g.after_lp_ratio = g.planned * ratio;
        }
      }
    }

    console.log(
      `Logistics: supply=${lp.supply} demand=${
        lp.demand_operating + lp.demand_domestic + lp.demand_international
      } ratio=${lp.lp_ratio}`,
    );

    return {
      lp,
      operatingAllocations,
      domesticAllocations,
      internationalAllocations,
    };
  }
}

