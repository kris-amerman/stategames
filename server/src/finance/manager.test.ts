import { test, expect, spyOn } from 'bun:test';
import { EconomyManager } from '../economy';
import { FinanceManager } from './manager';
import { TurnManager } from '../turn/manager';
import { DevelopmentManager } from '../development/manager';
import type { EconomyState, GameState, TurnPlan } from '../types';

function createEconomy(): EconomyState {
  const state = EconomyManager.createInitialState();
  state.finance.creditLimit = 500;
  state.finance.interestRate = 0.1;
  return state;
}

// 1. Treasury accounting
 test('treasury updates with revenues and expenditures', () => {
  const eco = createEconomy();
  eco.resources.gold = 100;
  FinanceManager.run(eco, { revenues: 50, expenditures: 30 });
  expect(eco.resources.gold).toBe(120);
  expect(eco.finance.debt).toBe(0);
});

// 2. Auto-borrowing
test('auto-borrowing covers treasury shortfalls', () => {
  const eco = createEconomy();
  eco.finance.interestRate = 0;
  FinanceManager.run(eco, { revenues: 0, expenditures: 50 });
  expect(eco.resources.gold).toBe(0);
  expect(eco.finance.debt).toBe(50);
});

// 3. Debt accumulation
test('borrowing increases debt immediately', () => {
  const eco = createEconomy();
  eco.finance.interestRate = 0;
  eco.finance.debt = 20;
  FinanceManager.run(eco, { revenues: 0, expenditures: 30 });
  expect(eco.finance.debt).toBe(50);
});

// 4. Interest application
 test('interest tick adds to debt and expenditures', () => {
  const eco = createEconomy();
  eco.resources.gold = 20;
  eco.finance.debt = 100;
  FinanceManager.run(eco, { revenues: 0, expenditures: 0 });
  expect(Math.round(eco.resources.gold)).toBe(10);
  expect(Math.round(eco.finance.debt)).toBe(110);
});

// 5. Credit limit enforcement
test('exceeding credit limit triggers default', () => {
  const eco = createEconomy();
  eco.finance.creditLimit = 100;
  eco.finance.debt = 90;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.defaulted).toBeTrue();
});

// Regression: interest shouldn't reduce debt when over the limit
test('interest over credit limit accumulates and defaults', () => {
  const eco = createEconomy();
  eco.finance.creditLimit = 1000;
  eco.finance.debt = 995; // interest will push this over the limit
  eco.finance.interestRate = 0.05;
  FinanceManager.run(eco, { revenues: 0, expenditures: 0 });
  expect(Math.round(eco.finance.debt)).toBe(1045);
  expect(eco.finance.defaulted).toBeTrue();
});

// 6. Debt stress flags
 test('debt stress tiers flag when thresholds crossed', () => {
  const eco = createEconomy();
  FinanceManager.run(eco, { revenues: 0, expenditures: 60 });
  expect(eco.finance.debtStress[0]).toBeTrue();
  eco.finance.debt = 90;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.debtStress[1]).toBeTrue();
  eco.finance.debt = 190;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.debtStress[2]).toBeTrue();
});

// 7. Sequencing with development
 test('finance resolves before development', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const gs: GameState = {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'planning',
    currentPlan: plan,
    nextPlan: null,
    cellOwnership: {},
    playerCells: {},
    entities: {},
    cellEntities: {},
    playerEntities: {},
    entitiesByType: { unit: [] },
    economy: createEconomy(),
    nextEntityId: 1,
  } as GameState;

  const order: string[] = [];
  const finSpy = spyOn(FinanceManager, 'run').mockImplementation((e, i) => {
    order.push('finance');
  });
  const devSpy = spyOn(DevelopmentManager, 'run').mockImplementation((e, i) => {
    order.push('development');
  });

  TurnManager.advanceTurn(gs);
  expect(order).toEqual(['finance', 'development']);

  finSpy.mockRestore();
  devSpy.mockRestore();
});

// 8. Determinism
 test('finance resolution is deterministic', () => {
  const a = createEconomy();
  const b = createEconomy();
  FinanceManager.run(a, { revenues: 10, expenditures: 40 });
  FinanceManager.run(b, { revenues: 10, expenditures: 40 });
  expect(a.resources.gold).toBe(b.resources.gold);
  expect(a.finance.debt).toBe(b.finance.debt);
  expect(a.finance.defaulted).toBe(b.finance.defaulted);
  expect(a.finance.debtStress).toEqual(b.finance.debtStress);
});

// 9. Coverage scenarios
 test('handles surplus treasury without borrowing', () => {
  const eco = createEconomy();
  eco.resources.gold = 100;
  FinanceManager.run(eco, { revenues: 50, expenditures: 20 });
  expect(eco.finance.debt).toBe(0);
});
