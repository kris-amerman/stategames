// server/src/trade/manager.ts
import type { EconomyState, ResourceType } from '../types';
import { LogisticsManager, GATEWAY_PARAMS, type Gateway, type ShippingPlan, type LogisticsResult } from '../logistics/manager';

export interface ImportOrder {
  good: ResourceType;
  quantity: number;
  price: number; // FX per unit
  tariff: number; // 0-1 fraction
  gateway: Gateway;
}

export interface ExportOrder {
  good: ResourceType;
  quantity: number;
  price: number; // FX per unit
  gateway: Gateway;
}

export interface TradeOrders {
  imports?: ImportOrder[];
  exports?: ExportOrder[];
}

export interface SwapOrder {
  from: 'gold' | 'fx';
  amount: number;
}

export interface TradeInput {
  orders: TradeOrders;
  capitalUL: number;
  lastFinanceOutput: number;
  swap?: SwapOrder;
  networks?: Record<string, any>;
  domesticPlans?: Record<string, ShippingPlan>;
}

export interface TradeResult {
  fx_spent: number;
  fx_earned: number;
  tariff_gold: number;
  freight_fx: number;
  logistics: LogisticsResult;
}

interface ImportSettlement {
  good: ResourceType;
  qty: number;
  price: number;
  tariff: number;
  gateway: Gateway;
}

interface ExportSettlement {
  good: ResourceType;
  qty: number;
  price: number;
  gateway: Gateway;
}

const GATEWAY_CAPACITY_PER_UL = {
  port: 20,
  rail: 15,
  air: 10,
} as const;

/**
 * Scaffolding manager for world market trade, tariffs, and FX swaps.
 */
export class TradeManager {
  static run(state: EconomyState, input: TradeInput): TradeResult {
    // === Swaps ===
    if (input.swap) {
      const cap = 2 * input.lastFinanceOutput;
      const fromPool = input.swap.from === 'gold' ? state.resources.gold : state.resources.fx;
      const amount = Math.min(input.swap.amount, cap, fromPool);
      const fee = amount * 0.1;
      const net = amount - fee;
      if (input.swap.from === 'gold') {
        state.resources.gold -= amount;
        state.resources.fx += net;
      } else {
        state.resources.fx -= amount;
        state.resources.gold += net;
      }
    }

    // === Build logistics plans ===
    const plans: Partial<Record<Gateway, ShippingPlan>> = {};
    const importMap: Partial<Record<Gateway, Record<ResourceType, ImportOrder>>> = {};
    const exportMap: Partial<Record<Gateway, Record<ResourceType, ExportOrder>>> = {};

    for (const order of input.orders.imports ?? []) {
      const plan = (plans[order.gateway] ||= { imports_by_good: {}, exports_by_good: {} });
      plan.imports_by_good[order.good] = (plan.imports_by_good[order.good] || 0) + order.quantity;
      (importMap[order.gateway] ||= {})[order.good] = order;
    }
    for (const order of input.orders.exports ?? []) {
      const plan = (plans[order.gateway] ||= { imports_by_good: {}, exports_by_good: {} });
      plan.exports_by_good[order.good] = (plan.exports_by_good[order.good] || 0) + order.quantity;
      (exportMap[order.gateway] ||= {})[order.good] = order;
    }

    const capacities: Partial<Record<Gateway, number>> = {
      port: input.capitalUL * GATEWAY_CAPACITY_PER_UL.port,
      rail: input.capitalUL * GATEWAY_CAPACITY_PER_UL.rail,
      air: input.capitalUL * GATEWAY_CAPACITY_PER_UL.air,
    };

    const logistics = LogisticsManager.run(state, {
      networks: input.networks ?? {},
      domesticPlans: input.domesticPlans ?? {},
      internationalPlans: plans,
      gatewayCapacities: capacities,
    });

    const imports: ImportSettlement[] = [];
    const exports: ExportSettlement[] = [];
    let freight_fx = 0;

    for (const [gateway, alloc] of Object.entries(logistics.internationalAllocations)) {
      const g = gateway as Gateway;
      const params = GATEWAY_PARAMS[g];
      const importOrders = importMap[g] || {};
      const exportOrders = exportMap[g] || {};
      let gatewayImportQty = 0;
      if (alloc.imports) {
        for (const [good, gAlloc] of Object.entries(alloc.imports)) {
          const qty = gAlloc.after_lp_ratio;
          if (qty <= 0) continue;
          const order = importOrders[good as ResourceType];
          if (!order) continue;
          imports.push({ good: good as ResourceType, qty, price: order.price, tariff: order.tariff, gateway: g });
          gatewayImportQty += qty;
        }
      }
      if (alloc.exports) {
        for (const [good, gAlloc] of Object.entries(alloc.exports)) {
          const qty = gAlloc.after_lp_ratio;
          if (qty <= 0) continue;
          const order = exportOrders[good as ResourceType];
          if (!order) continue;
          exports.push({ good: good as ResourceType, qty, price: order.price, gateway: g });
        }
      }
      freight_fx += gatewayImportQty * params.fxPerUnit;
    }

    // === FX payment for imports with auto-scaling ===
    const totalImportValue = imports.reduce((s, i) => s + i.qty * i.price, 0);
    let totalCost = totalImportValue + freight_fx;
    let ratio = 1;
    if (totalCost > 0 && state.resources.fx < totalCost) {
      ratio = state.resources.fx / totalCost;
      totalCost = state.resources.fx;
    }
    // Apply ratio to imports and freight
    for (const imp of imports) imp.qty *= ratio;
    freight_fx *= ratio;

    state.resources.fx -= totalCost;
    let fx_spent = totalCost;
    let tariff_gold = 0;
    for (const imp of imports) {
      const value = imp.qty * imp.price;
      const tariff = value * imp.tariff;
      tariff_gold += tariff;
      state.trade.pendingImports[imp.good] =
        (state.trade.pendingImports[imp.good] || 0) + imp.qty * (1 - imp.tariff);
    }
    state.resources.gold += tariff_gold;

    // === Exports ===
    let fx_earned = 0;
    for (const exp of exports) {
      const value = exp.qty * exp.price;
      fx_earned += value;
    }
    state.resources.fx += fx_earned;

    return { fx_spent, fx_earned, tariff_gold, freight_fx, logistics };
  }

  /** Apply pending imports/exports scheduled for this turn. */
  static applyPending(state: EconomyState): void {
    for (const [good, qty] of Object.entries(state.trade.pendingImports)) {
      state.resources[good as ResourceType] += qty;
    }
    for (const key of Object.keys(state.trade.pendingImports)) {
      delete state.trade.pendingImports[key as ResourceType];
    }
    for (const [good, qty] of Object.entries(state.trade.pendingExports)) {
      state.resources[good as ResourceType] += qty; // symmetry placeholder
    }
    for (const key of Object.keys(state.trade.pendingExports)) {
      delete state.trade.pendingExports[key as ResourceType];
    }
  }
}

