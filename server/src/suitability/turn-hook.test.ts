import { expect, test } from 'bun:test';
import { TurnManager } from '../turn/manager';
import { EconomyManager } from '../economy';
import { LaborManager } from '../labor/manager';
import { SuitabilityManager } from './manager';
import type { GameState, TurnPlan } from '../types';

function createGameState(plan: TurnPlan | null): GameState {
  return {
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
    economy: EconomyManager.createInitialState(),
    nextEntityId: 1,
  } as GameState;
}

test('suitability gate runs after labor gate', () => {
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const state = createGameState(plan);
  const order: string[] = [];
  const laborOriginal = LaborManager.run;
  const suitOriginal = SuitabilityManager.run;
  LaborManager.run = ((econ: any, plan?: any) => {
    order.push('labor');
    return laborOriginal.call(LaborManager, econ, plan);
  }) as any;
  SuitabilityManager.run = ((econ: any) => {
    order.push('suit');
    return suitOriginal.call(SuitabilityManager, econ);
  }) as any;
  TurnManager.advanceTurn(state);
  expect(order).toEqual(['labor', 'suit']);
  LaborManager.run = laborOriginal as any;
  SuitabilityManager.run = suitOriginal as any;
});
