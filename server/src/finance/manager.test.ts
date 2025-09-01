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
 test('auto-borrowing covers treasury shortfalls exactly', () => {
  const eco = createEconomy();
  eco.finance.interestRate = 0;
  FinanceManager.run(eco, { revenues: 0, expenditures: 50 });
  expect(eco.resources.gold).toBe(0);
  expect(eco.finance.debt).toBe(50);
  expect(eco.finance.summary.netBorrowing).toBe(50);
});

// 3. Borrowing increases debt immediately
 test('borrowing increases existing debt', () => {
  const eco = createEconomy();
  eco.finance.interestRate = 0;
  eco.finance.debt = 20;
  FinanceManager.run(eco, { revenues: 0, expenditures: 30 });
  expect(eco.finance.debt).toBe(50);
});

// 4. Interest application with secondary borrow
 test('interest tick applies after borrowing and may trigger second borrow', () => {
  const eco = createEconomy();
  eco.finance.interestRate = 0.1;
  FinanceManager.run(eco, { revenues: 0, expenditures: 50 });
  expect(eco.resources.gold).toBe(0);
  // borrow 50, interest 5, borrow 5 more -> 60 total debt
  expect(eco.finance.debt).toBe(60);
  expect(eco.finance.summary.netBorrowing).toBe(55);
  expect(eco.finance.summary.interest).toBeCloseTo(5);
});

// 5. Exact credit limit hit
 test('borrowing up to the credit limit does not default', () => {
  const eco = createEconomy();
  eco.finance.creditLimit = 100;
  eco.finance.debt = 90;
  eco.finance.interestRate = 0;
  FinanceManager.run(eco, { revenues: 0, expenditures: 10 });
  expect(eco.finance.debt).toBe(100);
  expect(eco.finance.defaulted).toBeFalse();
});

// 6. Credit limit exceeded
 test('attempting to borrow beyond the credit limit defaults and leaves negative treasury', () => {
  const eco = createEconomy();
  eco.finance.creditLimit = 100;
  eco.finance.debt = 90;
  eco.finance.interestRate = 0;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.debt).toBe(100);
  expect(eco.resources.gold).toBe(-10);
  expect(eco.finance.defaulted).toBeTrue();
});

// 7. Interest pushing over credit limit
 test('interest that would exceed the credit limit caps debt and defaults', () => {
  const eco = createEconomy();
  eco.finance.creditLimit = 1000;
  eco.finance.debt = 995;
  eco.finance.interestRate = 0.05;
  FinanceManager.run(eco, { revenues: 0, expenditures: 0 });
  expect(eco.finance.debt).toBe(1000);
  expect(eco.resources.gold).toBeCloseTo(-49.75);
  expect(eco.finance.defaulted).toBeTrue();
});

// 8. Debt stress flags
 test('debt stress tiers flag when thresholds crossed', () => {
  const eco = createEconomy();
  FinanceManager.run(eco, { revenues: 0, expenditures: 60 });
  expect(eco.finance.debtStress).toEqual([true, false, false]);
  eco.finance.debt = 90;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.debtStress).toEqual([true, true, false]);
  eco.finance.debt = 190;
  FinanceManager.run(eco, { revenues: 0, expenditures: 20 });
  expect(eco.finance.debtStress).toEqual([true, true, true]);
});

// 9. Sequencing with development
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

// 10. Determinism
 test('finance resolution is deterministic', () => {
  const a = createEconomy();
  const b = createEconomy();
  FinanceManager.run(a, { revenues: 10, expenditures: 40 });
  FinanceManager.run(b, { revenues: 10, expenditures: 40 });
  expect(a.resources.gold).toBe(b.resources.gold);
  expect(a.finance.debt).toBe(b.finance.debt);
  expect(a.finance.defaulted).toBe(b.finance.defaulted);
  expect(a.finance.debtStress).toEqual(b.finance.debtStress);
  expect(a.finance.summary).toEqual(b.finance.summary);
});

// 11. Coverage surplus case
 test('handles surplus treasury without borrowing', () => {
  const eco = createEconomy();
  eco.resources.gold = 100;
  FinanceManager.run(eco, { revenues: 50, expenditures: 20 });
  expect(eco.finance.debt).toBe(0);
  expect(eco.finance.summary.netBorrowing).toBe(0);
});

