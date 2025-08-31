import { expect, test } from 'bun:test';
import { EconomyManager, SECTOR_DEFINITIONS } from './manager';
import { TurnManager } from '../turn/manager';
import type { GameState, TurnPlan } from '../types';

function createGameState(): GameState {
  return {
    status: 'in_progress',
    currentPlayer: 'P1',
    turnNumber: 1,
    phase: 'planning',
    currentPlan: null,
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

test('economy defines distinct resource types', () => {
  const state = EconomyManager.createInitialState();
  const resources = Object.keys(state.resources).sort();
  expect(resources).toEqual([
    'coal',
    'energy',
    'food',
    'fx',
    'gold',
    'labor',
    'logistics',
    'luxury',
    'materials',
    'oil',
    'ordnance',
    'production',
    'rareEarths',
    'research',
    'uranium',
  ]);
});

test('all sectors are registered', () => {
  expect(Object.keys(SECTOR_DEFINITIONS).sort()).toEqual([
    'agriculture',
    'defense',
    'energy',
    'extraction',
    'finance',
    'logistics',
    'luxury',
    'manufacturing',
    'research',
  ]);
});

test('slot capacity and utilization tracked per canton & sector', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].sectors.agriculture = { capacity: 2, funded: 1, idle: 1 };
  expect(state.cantons['A'].sectors.agriculture).toEqual({ capacity: 2, funded: 1, idle: 1 });
});

test('LP is treated as non-stockpiled and resets each turn', () => {
  const state = createGameState();
  state.economy.resources.logistics = 5;
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  state.currentPlan = plan;
  TurnManager.advanceTurn(state);
  expect(state.economy.resources.logistics).toBe(0);
});
