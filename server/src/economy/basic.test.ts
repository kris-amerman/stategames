import { expect, test } from 'bun:test';
import {
  EconomyManager,
  SECTOR_DEFINITIONS,
} from './manager';
import { BudgetManager } from '../budget/manager';
import { TurnManager } from '../turn/manager';
import { SuitabilityManager } from '../suitability/manager';
import type { GameState } from '../types';

function gameState(): GameState {
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

// --- Registry tests ---

test('canonical resources exist and are distinct', () => {
  const state = EconomyManager.createInitialState();
  expect(Object.keys(state.resources).sort()).toEqual([
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

test('all sectors registered', () => {
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

// --- Data table lookups ---

test('base outputs and slot requirements loaded from data', () => {
  const agOut = EconomyManager.getBaseOutput('agriculture');
  expect(agOut.food).toBe(1);
  const mReq = EconomyManager.getSlotRequirements('manufacturing');
  expect(mReq.inputs.materials).toBe(1);
  expect(mReq.energy).toBe(2);
});

// --- LP non-stockpile ---

test('logistics points do not stockpile across turns', () => {
  const state = gameState();
  state.economy.resources.logistics = 5;
  state.currentPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  TurnManager.advanceTurn(state);
  expect(state.economy.resources.logistics).toBe(0);
});

// --- Capacity, utilization, active vs idle ---

test('funding sets active and idle slots and tracks utilization', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.resources.gold = 10;
  state.cantons.A.sectors.agriculture = { capacity: 3, funded: 0, idle: 0 } as any;
  const budgets = { military: 0, welfare: 0, sectorOM: { agriculture: 2 } };
  BudgetManager.applyBudgets(state, budgets);
  const ag = state.cantons.A.sectors.agriculture;
  expect(ag.funded).toBe(2);
  expect(ag.idle).toBe(1);
  expect(state.resources.gold).toBeCloseTo(10 - (2 + 0.25));
});

// --- Turn execution and utilization tracking ---

test('utilization never exceeds capacity and produces base output', () => {
  const gs = gameState();
  const econ = gs.economy;
  EconomyManager.addCanton(econ, 'A');
  econ.resources.gold = 100;
  econ.resources.coal = 100;
  econ.cantons.A.sectors.agriculture = { capacity: 3, funded: 0, idle: 0 } as any;
  econ.cantons.A.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
  econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
  gs.currentPlan = {
    budgets: { military: 0, welfare: 0, sectorOM: { agriculture: 3, logistics: 1 } },
  };
  // reset suitability modifiers to neutral to avoid cross-test contamination
  SuitabilityManager.setGeographyModifiers({});
  SuitabilityManager.setUrbanizationModifiers({});
  TurnManager.advanceTurn(gs);
  const ag = econ.cantons.A.sectors.agriculture;
  expect(ag.utilization).toBeLessThanOrEqual(ag.capacity);
  expect(ag.utilization).toBe(3);
  expect(econ.resources.food).toBe(3);
});

// --- Retool exclusion ---

test('retooling slots are unavailable until completion', () => {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons.A.sectors.agriculture = { capacity: 2, funded: 0, idle: 0 } as any;
  BudgetManager.scheduleRetool(state, {
    canton: 'A',
    sector_from: 'agriculture',
    sector_to: 'manufacturing',
    slots: 1,
  });
  // capacity reduced immediately
  expect(state.cantons.A.sectors.agriculture.capacity).toBe(1);
  // advance one turn - not yet completed
  BudgetManager.advanceRetools(state);
  expect(state.cantons.A.sectors.manufacturing).toBeUndefined();
  // advance second turn - now available
  BudgetManager.advanceRetools(state);
  expect(state.cantons.A.sectors.manufacturing?.capacity).toBe(1);
});

// --- Turn boundary isolation ---

test('next turn plan does not affect current execution', () => {
  const gs = gameState();
  EconomyManager.addCanton(gs.economy, 'A');
  gs.economy.cantons.A.sectors.agriculture = { capacity: 1, funded: 0, idle: 0 } as any;
  gs.economy.resources.gold = 5;
  gs.nextPlan = { budgets: { military: 0, welfare: 0, sectorOM: { agriculture: 1 } } };
  TurnManager.advanceTurn(gs); // no current plan yet
  expect(gs.economy.resources.gold).toBe(5); // unchanged
  // now plan becomes currentPlan
  gs.currentPlan!.budgets!.sectorOM.agriculture = 1;
  TurnManager.advanceTurn(gs); // executes
  expect(gs.economy.resources.gold).toBeCloseTo(5 - 1 - 0); // one slot funded, no idle
});

// --- Determinism ---

test('identical inputs yield identical outcomes', () => {
  function runOnce() {
    const gs = gameState();
    const econ = gs.economy;
    EconomyManager.addCanton(econ, 'A');
    econ.resources.gold = 100;
    econ.cantons.A.sectors.agriculture = { capacity: 2, funded: 0, idle: 0 } as any;
    econ.cantons.A.sectors.logistics = { capacity: 1, funded: 0, idle: 0 } as any;
    econ.energy.plants.push({ canton: 'A', type: 'coal', status: 'active' });
    gs.currentPlan = {
      budgets: { military: 0, welfare: 0, sectorOM: { agriculture: 2, logistics: 1 } },
    };
    TurnManager.advanceTurn(gs);
    return JSON.stringify(gs.economy);
  }
  const a = runOnce();
  const b = runOnce();
  expect(a).toBe(b);
});
