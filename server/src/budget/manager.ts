// server/src/budget/manager.ts
import type {
  EconomyState,
  SectorType,
  BudgetPools,
  RetoolOrder,
} from '../types';

// Gold cost to operate one slot of each sector for a turn.
export const OM_COST_PER_SLOT: Record<SectorType, number> = {
  agriculture: 1,
  extraction: 1,
  manufacturing: 1,
  defense: 1,
  luxury: 1,
  finance: 1,
  research: 1,
  logistics: 1,
  energy: 1,
};

const IDLE_TAX_RATE = 0.25;
export const RETOOL_COST_PER_SLOT = 8;
export const RETOOL_TURNS = 2;

/**
 * Manages budget allocation and slot funding.
 * Only implements scaffolding and placeholder hooks for other systems.
 */
export class BudgetManager {
  /**
   * Placeholder hook functions that downstream systems can override.
   * They are invoked during recordFunding in the order: inputs -> labor -> modifiers.
   */
  static hooks: {
    inputs: (state: EconomyState, cantonId: string, sector: SectorType) => void;
    labor: (state: EconomyState, cantonId: string, sector: SectorType) => void;
    modifiers: (state: EconomyState, cantonId: string, sector: SectorType) => void;
  } = {
    inputs: () => {},
    labor: () => {},
    modifiers: () => {},
  };
  /**
   * Apply this turn's budget plan to the economy state.
   * Funds sector O&M slots and charges idle costs.
   */
  static applyBudgets(state: EconomyState, budgets: BudgetPools): void {
    // Military and welfare pools are simply deducted for now.
    state.resources.gold -= budgets.military;
    state.resources.gold -= budgets.welfare;

    for (const sector of Object.keys(budgets.sectorOM) as SectorType[]) {
      const sectorBudget = budgets.sectorOM[sector] ?? 0;
      this.fundSector(state, sector, sectorBudget);
    }
  }

  /**
   * Fund slots for a single sector across all cantons using suitability
   * prioritization and largest remainder for fractional allocation.
   */
  private static fundSector(state: EconomyState, sector: SectorType, budget: number): void {
    const costPer = OM_COST_PER_SLOT[sector];
    if (costPer <= 0) return;

    // Gather capacity and suitability info for cantons that have this sector.
    const entries: Array<{
      id: string;
      capacity: number;
      suitability: number;
      funded: number;
      remainder: number;
    }> = [];

    for (const [cantonId, canton] of Object.entries(state.cantons)) {
      const sectorState = canton.sectors[sector];
      const suitability = canton.suitability[sector] ?? 0;
      if (!sectorState || sectorState.capacity <= 0) continue;
      entries.push({
        id: cantonId,
        capacity: sectorState.capacity,
        suitability,
        funded: 0,
        remainder: 0,
      });
    }

    const totalCapacity = entries.reduce((sum, e) => sum + e.capacity, 0);
    if (totalCapacity === 0) return;

    const maxFundableSlots = Math.floor(budget / costPer);
    const slotsToFund = Math.min(maxFundableSlots, totalCapacity);

    // Sort by suitability descending for baseline allocation.
    entries.sort((a, b) => b.suitability - a.suitability);

    if (slotsToFund >= totalCapacity) {
      for (const e of entries) {
        e.funded = e.capacity;
        this.recordFunding(state, e.id, sector, e.capacity, 0, costPer);
      }
      return;
    }

    // Proportional allocation with largest remainder.
    for (const e of entries) {
      const ideal = (e.capacity / totalCapacity) * slotsToFund;
      e.funded = Math.floor(ideal);
      e.remainder = ideal - e.funded;
    }

    let allocated = entries.reduce((sum, e) => sum + e.funded, 0);
    const remaining = slotsToFund - allocated;
    if (remaining > 0) {
      // Distribute remaining slots by remainder, breaking ties by suitability.
      entries
        .sort((a, b) => {
          if (b.remainder === a.remainder) {
            return b.suitability - a.suitability;
          }
          return b.remainder - a.remainder;
        })
        .slice(0, remaining)
        .forEach((e) => {
          e.funded += 1;
        });
    }

    // Record funding and idle costs.
    for (const e of entries) {
      const idle = e.capacity - e.funded;
      this.recordFunding(state, e.id, sector, e.funded, idle, costPer);
    }
  }

  private static recordFunding(
    state: EconomyState,
    cantonId: string,
    sector: SectorType,
    funded: number,
    idle: number,
    costPer: number,
  ): void {
    const canton = state.cantons[cantonId];
    const sectorState = canton.sectors[sector];
    sectorState.funded = funded;
    sectorState.idle = idle;
    sectorState.utilization = 0;

    const activeCost = funded * costPer;
    const idleCost = idle * costPer * IDLE_TAX_RATE;
    state.resources.gold -= activeCost + idleCost;

    // Hook order for downstream systems.
    // 1. Non-labor inputs gate
    BudgetManager.hooks.inputs(state, cantonId, sector);
    // 2. Labor gate
    BudgetManager.hooks.labor(state, cantonId, sector);
    // 3. Modifiers & output
    BudgetManager.hooks.modifiers(state, cantonId, sector);
  }

  /** Schedule a retool operation. */
  static scheduleRetool(state: EconomyState, order: Omit<RetoolOrder, 'turns_remaining'>): void {
    const canton = state.cantons[order.canton];
    const fromState = canton.sectors[order.sector_from];
    if (!fromState || fromState.capacity < order.slots) return;

    fromState.capacity -= order.slots;
    state.retoolQueue.push({ ...order, turns_remaining: RETOOL_TURNS });
    state.resources.gold -= order.slots * RETOOL_COST_PER_SLOT;
  }

  /** Advance retool timers and activate completed slots. */
  static advanceRetools(state: EconomyState): void {
    const remaining: RetoolOrder[] = [];
    for (const order of state.retoolQueue) {
      order.turns_remaining -= 1;
      if (order.turns_remaining > 0) {
        remaining.push(order);
        continue;
      }
      const canton = state.cantons[order.canton];
      const toState = (canton.sectors[order.sector_to] ||= {
        capacity: 0,
        funded: 0,
        idle: 0,
        utilization: 0,
      });
      toState.capacity += order.slots;
    }
    state.retoolQueue = remaining;
  }
}
