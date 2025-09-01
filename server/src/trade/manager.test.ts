import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import type { EconomyState } from '../types';
import { TradeManager } from './manager';
import { GATEWAY_PARAMS } from '../logistics/manager';

function createState(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'C1');
  // generous logistics supply by default
  state.cantons.C1.sectors.logistics = { capacity: 10, funded: 10, idle: 0 } as any;
  return state;
}

// Helper for domestic network
function makeNetwork(connected: boolean, hops: number, capacity: number) {
  return { connected, hops, capacity_per_turn: capacity };
}

// 1. Gateways & capacity scaling
// covers all gateways

test('gateway capacities scale with capital UL', () => {
  const state = createState();
  state.resources.fx = 1000;
  const result = TradeManager.run(state, {
    capitalUL: 2,
    lastFinanceOutput: 0,
    orders: {
      imports: [
        { good: 'food', quantity: 50, price: 1, tariff: 0, gateway: 'port' },
        { good: 'materials', quantity: 50, price: 1, tariff: 0, gateway: 'rail' },
        { good: 'luxury', quantity: 50, price: 1, tariff: 0, gateway: 'air' },
      ],
      exports: [],
    },
  });
  expect(result.logistics.internationalAllocations.port?.units_after_lp_ratio).toBeCloseTo(40);
  expect(result.logistics.internationalAllocations.rail?.units_after_lp_ratio).toBeCloseTo(30);
  expect(result.logistics.internationalAllocations.air?.units_after_lp_ratio).toBeCloseTo(20);
  expect(state.trade.pendingImports.food).toBeCloseTo(40);
  expect(state.trade.pendingImports.materials).toBeCloseTo(30);
  expect(state.trade.pendingImports.luxury).toBeCloseTo(20);
});

// 2. LP usage, freight costs, and shared LP pool with domestic shipping

test('international trade uses same LP pool and records freight FX', () => {
  const state = createState();
  state.resources.fx = 1000;
  // limit logistics supply to 10 LP (1 slot)
  state.cantons.C1.sectors.logistics = { capacity: 1, funded: 1, idle: 0 } as any;
  const result = TradeManager.run(state, {
    capitalUL: 5,
    lastFinanceOutput: 0,
    networks: { C1: { rail: makeNetwork(true, 1, 100) } },
    domesticPlans: { C1: { imports_by_good: { food: 80 }, exports_by_good: {} } },
    orders: {
      imports: [
        { good: 'materials', quantity: 80, price: 1, tariff: 0, gateway: 'port' },
      ],
      exports: [],
    },
  });
  const ratio = 10 / (8 + 8); // supply / (domestic + international demand)
  expect(result.logistics.lp.lp_ratio).toBeCloseTo(ratio);
  expect(result.logistics.domesticAllocations.C1.rail?.units_after_lp_ratio).toBeCloseTo(80 * ratio);
  expect(result.logistics.internationalAllocations.port?.units_after_lp_ratio).toBeCloseTo(80 * ratio);
  const expectedFreight = (80 * ratio) * GATEWAY_PARAMS.port.fxPerUnit;
  expect(result.freight_fx).toBeCloseTo(expectedFreight);
  expect(result.logistics.lp.demand_international).toBeCloseTo(80 * GATEWAY_PARAMS.port.costPerHop);
});

// 3. Tariffs, exports, and next-turn arrivals

test('imports apply tariffs and exports earn FX, arrivals next turn', () => {
  const state = createState();
  state.resources.fx = 200;
  const result = TradeManager.run(state, {
    capitalUL: 5,
    lastFinanceOutput: 0,
    orders: {
      imports: [
        { good: 'food', quantity: 10, price: 5, tariff: 0.3, gateway: 'port' },
        { good: 'materials', quantity: 5, price: 4, tariff: 0, gateway: 'rail' },
      ],
      exports: [
        { good: 'luxury', quantity: 3, price: 10, gateway: 'air' },
      ],
    },
  });
  // Tariff gold 30% of 10*5 =15
  expect(result.tariff_gold).toBeCloseTo(15);
  // FX spent: imports + freight
  const freight = 10 * GATEWAY_PARAMS.port.fxPerUnit + 5 * GATEWAY_PARAMS.rail.fxPerUnit;
  expect(result.fx_spent).toBeCloseTo(10 * 5 + 5 * 4 + freight);
  // FX earned from exports
  expect(result.fx_earned).toBeCloseTo(3 * 10);
  // Pending imports reflect tariff friction
  expect(state.trade.pendingImports.food).toBeCloseTo(10 * (1 - 0.3));
  expect(state.trade.pendingImports.materials).toBeCloseTo(5);
  // Goods not yet added
  expect(state.resources.food).toBe(0);
  TradeManager.applyPending(state);
  expect(state.resources.food).toBeCloseTo(10 * (1 - 0.3));
});

// 4. FX insufficiency auto-scales imports

test('imports auto-scale when FX insufficient', () => {
  const state = createState();
  state.resources.fx = 30; // insufficient for 10 units at 5 FX + freight
  const result = TradeManager.run(state, {
    capitalUL: 5,
    lastFinanceOutput: 0,
    orders: {
      imports: [
        { good: 'food', quantity: 10, price: 5, tariff: 0, gateway: 'port' },
      ],
      exports: [],
    },
  });
  expect(state.resources.fx).toBeCloseTo(0);
  const totalCost = 10 * 5 + 10 * GATEWAY_PARAMS.port.fxPerUnit;
  const ratio = 30 / totalCost;
  expect(state.trade.pendingImports.food).toBeCloseTo(10 * ratio);
});

// 5. Swaps enforce cap and fee

test('FX swaps apply fee and cap', () => {
  const state = createState();
  state.resources.gold = 100;
  const result = TradeManager.run(state, {
    capitalUL: 1,
    lastFinanceOutput: 30, // cap 60
    swap: { from: 'gold', amount: 80 },
    orders: { imports: [], exports: [] },
  });
  expect(state.resources.gold).toBeCloseTo(40); // spent 60
  expect(state.resources.fx).toBeCloseTo(54); // 60 - 6 fee
  // Now swap back FX->Gold without cap issue
  state.resources.fx = 100;
  TradeManager.run(state, {
    capitalUL: 1,
    lastFinanceOutput: 100, // cap 200
    swap: { from: 'fx', amount: 50 },
    orders: { imports: [], exports: [] },
  });
  expect(state.resources.fx).toBeCloseTo(50);
  expect(state.resources.gold).toBeCloseTo(40 + 45);
});

// 6. Determinism

test('trade outcomes deterministic for identical inputs', () => {
  const state1 = createState();
  state1.resources.fx = 100;
  const state2: EconomyState = JSON.parse(JSON.stringify(state1));
  const input = {
    capitalUL: 3,
    lastFinanceOutput: 0,
    orders: {
      imports: [
        { good: 'food', quantity: 10, price: 2, tariff: 0.1, gateway: 'port' },
      ],
      exports: [],
    },
  } as const;
  const res1 = TradeManager.run(state1, JSON.parse(JSON.stringify(input)));
  const res2 = TradeManager.run(state2, JSON.parse(JSON.stringify(input)));
  expect(res1).toEqual(res2);
  expect(state1.resources).toEqual(state2.resources);
  expect(state1.trade).toEqual(state2.trade);
});

// 7. Zero FX prevents imports and tariffs
test('no FX means no imports, tariffs, or freight', () => {
  const state = createState();
  state.resources.fx = 0;
  const result = TradeManager.run(state, {
    capitalUL: 5,
    lastFinanceOutput: 0,
    orders: {
      imports: [
        { good: 'food', quantity: 10, price: 2, tariff: 0.3, gateway: 'port' },
      ],
      exports: [],
    },
  });
  expect(result.fx_spent).toBe(0);
  expect(result.tariff_gold).toBe(0);
  expect(result.freight_fx).toBe(0);
  expect(state.trade.pendingImports.food).toBe(0);
});

// 8. Gateway hops scale LP demand for international shipping
test('international hops multiply LP demand', () => {
  const state = createState();
  state.resources.fx = 1000;
  const result = TradeManager.run(state, {
    capitalUL: 5,
    lastFinanceOutput: 0,
    gatewayHops: { rail: 3 },
    orders: {
      imports: [
        { good: 'materials', quantity: 10, price: 1, tariff: 0, gateway: 'rail' },
      ],
      exports: [],
    },
  });
  const expected = 10 * GATEWAY_PARAMS.rail.costPerHop * 3;
  expect(result.logistics.lp.demand_international).toBeCloseTo(expected);
});

