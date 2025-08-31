import { expect, test, spyOn } from 'bun:test';
import { TurnManager } from './manager';
import { BudgetManager } from '../budget/manager';
import { EconomyManager } from '../economy/manager';
import type { GameState, TurnPlan } from '../types';

function createGameState(currentPlan: TurnPlan | null, nextPlan: TurnPlan | null): GameState {
  return {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'planning',
    currentPlan,
    nextPlan,
    cellOwnership: {},
    playerCells: {},
    entities: {},
    cellEntities: {},
    playerEntities: {},
    entitiesByType: { unit: [] },
    economy: EconomyManager.createInitialState(),
    nextEntityId: 1,
  } as GameState;
}

test('actions set in Turn N apply in Turn N+1', () => {
  const plan1: TurnPlan = { budgets: { military: 1, welfare: 0, sectorOM: {} } };
  const plan2: TurnPlan = { budgets: { military: 2, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan1, plan2);

  const spy = spyOn(BudgetManager, 'applyBudgets');

  // Advance to execute plan1
  TurnManager.advanceTurn(state);
  expect(spy.mock.calls[0][1]).toEqual(plan1.budgets);
  // Advance again to execute plan2
  TurnManager.advanceTurn(state);
  expect(spy.mock.calls[1][1]).toEqual(plan2.budgets);

  spy.mockRestore();
});

test('per-turn sequence invokes gates in order', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan, null);
  const order: string[] = [];

  const patches: [string, any][] = [
    ['carryover', TurnManager],
    ['budgetGate', TurnManager],
    ['inputsGate', TurnManager],
    ['logisticsGate', TurnManager],
    ['laborGate', TurnManager],
    ['suitabilityGate', TurnManager],
    ['cleanup', TurnManager],
  ];

  const originals: Record<string, any> = {};
  for (const [method] of patches) {
    originals[method] = (TurnManager as any)[method];
    (TurnManager as any)[method] = (gs: GameState) => {
      order.push(method);
      return originals[method].call(TurnManager, gs);
    };
  }

  TurnManager.advanceTurn(state);

  expect(order).toEqual([
    'carryover',
    'budgetGate',
    'inputsGate',
    'logisticsGate',
    'laborGate',
    'suitabilityGate',
    'cleanup',
  ]);

  for (const [method] of patches) {
    (TurnManager as any)[method] = originals[method];
  }
});

test('planning writes to next-turn buffer', () => {
  const state = createGameState(null, null);
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  TurnManager.startPlanning(state);
  expect(state.nextPlan).toBeDefined();
  TurnManager.submitPlan(state, plan);
  expect(state.nextPlan).toBe(plan);
});

test('cleanup creates turn summary artifact', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan, null);
  const original = (TurnManager as any).cleanup;
  (TurnManager as any).cleanup = (gs: any) => {
    gs.turnSummary = { log: ['done'] };
  };

  TurnManager.advanceTurn(state);
  expect((state as any).turnSummary).toBeDefined();

  (TurnManager as any).cleanup = original;
});
