import { expect, test } from 'bun:test';
import { TurnManager } from './manager';
import { EconomyManager } from '../economy/manager';
import { OM_COST_PER_SLOT } from '../budget/manager';
import type { GameState, TurnPlan } from '../types';

function baseGameState(plan: TurnPlan | null): GameState {
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

function setupCanton(state: GameState, id: string) {
  EconomyManager.addCanton(state.economy, id);
  state.economy.cantons[id].suitability.manufacturing = 1;
  state.economy.cantons[id].suitability.logistics = 1;
  state.economy.cantons[id].suitability.extraction = 1;
}

// logistics shortage with labor shortage and idle sector check
 test('logistics ratio and labor shortages recorded in turn summary', () => {
  const plan: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { manufacturing: 10 * OM_COST_PER_SLOT.manufacturing, logistics: 1 * OM_COST_PER_SLOT.logistics },
    },
  };
  const gs = baseGameState(plan);
  setupCanton(gs, 'C1');
  gs.economy.resources.gold = 100;
  gs.economy.resources.food = 0;
  gs.economy.resources.luxury = 0;
  gs.economy.cantons.C1.sectors.manufacturing = { capacity: 10, funded: 0, idle: 0 };
  gs.economy.cantons.C1.sectors.logistics = { capacity: 1, funded: 0, idle: 0 };
  gs.economy.cantons.C1.sectors.extraction = { capacity: 5, funded: 0, idle: 0 }; // idle sector
  gs.economy.energy.plants.push({ canton: 'C1', type: 'nuclear', status: 'active' });
  gs.economy.energy.plants.push({ canton: 'C1', type: 'nuclear', status: 'active' }); // ample supply

  TurnManager.advanceTurn(gs);

  expect(gs.economy.energy.state.ratio).toBe(1);
  expect(gs.economy.logistics?.lp_ratio).toBeLessThan(1);
  // idle extraction should not consume energy
  expect(gs.economy.energy.demandBySector.extraction).toBeUndefined();
  // labor assigned limited by supply
  expect(gs.economy.cantons.C1.laborAssigned.manufacturing?.skilled).toBe(1);
  expect(gs.economy.cantons.C1.shortages.food).toBe(true);
  expect(gs.turnSummary?.log.length).toBeGreaterThan(0);
});

// energy brownout scales funded slots
 test('energy brownouts scale funded slots', () => {
  const plan: TurnPlan = {
    budgets: {
      military: 0,
      welfare: 0,
      sectorOM: { manufacturing: 4 * OM_COST_PER_SLOT.manufacturing, logistics: 4 * OM_COST_PER_SLOT.logistics },
    },
  };
  const gs = baseGameState(plan);
  setupCanton(gs, 'C1');
  gs.economy.resources.gold = 100;
  gs.economy.resources.food = 0;
  gs.economy.resources.luxury = 0;
  gs.economy.cantons.C1.sectors.manufacturing = { capacity: 4, funded: 0, idle: 0 };
  gs.economy.cantons.C1.sectors.logistics = { capacity: 4, funded: 0, idle: 0 };
  gs.economy.energy.plants.push({ canton: 'C1', type: 'oilPeaker', status: 'active' }); // output 5 < demand 8

  TurnManager.advanceTurn(gs);

  expect(gs.economy.energy.state.ratio).toBeLessThan(1);
  expect(gs.economy.cantons.C1.sectors.manufacturing.funded).toBeLessThan(4);
  expect(gs.turnSummary?.log[0]).toContain('Energy supply');
});
