import { expect, test, describe } from 'bun:test';
import { EconomyManager } from '../economy';
import { DevelopmentManager, SECTOR_SLOTS_BY_UL, LABOR_BY_UL, SUITABILITY_BY_UL } from './manager';
import type { EconomyState } from '../types';

function setup(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'c1');
  return state;
}

// 1. UL domain & meter

test('UL and development meter stay within bounds', () => {
  const state = setup();
  // push meter to trigger UL increase
  DevelopmentManager.run(state, { c1: { baseRoll: 5, cap: 4 } });
  expect(state.cantons.c1.development).toBe(0);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(2);
  // apply next turn and ensure UL capped at 12
  state.cantons.c1.urbanizationLevel = 12;
  state.cantons.c1.nextUrbanizationLevel = 12;
  DevelopmentManager.run(state, { c1: { baseRoll: 6, cap: 6 } });
  expect(state.cantons.c1.development).toBe(4);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(12);
  // negative roll cannot drop meter below 0
  state.cantons.c1.development = 3;
  DevelopmentManager.run(state, { c1: { baseRoll: -10 } });
  expect(state.cantons.c1.development).toBe(0);
});

// 2. Dev roll aggregation and cap

test('development roll aggregates modifiers and respects cap', () => {
  const state = setup();
  DevelopmentManager.run(state, { c1: { baseRoll: 3, modifiers: [2, -1], cap: 3 } });
  expect(state.cantons.c1.development).toBe(3);
});

// 3. UL increase with remainder and lag

test('meter rollover increases UL next turn with remainder carried', () => {
  const state = setup();
  state.cantons.c1.development = 2;
  DevelopmentManager.run(state, { c1: { baseRoll: 5, cap: 5 } });
  expect(state.cantons.c1.development).toBe(3); // 2 + 5 =7 -> -4 =3
  expect(state.cantons.c1.urbanizationLevel).toBe(1);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(2);
  DevelopmentManager.applyPending(state);
  expect(state.cantons.c1.urbanizationLevel).toBe(2);
  expect(state.cantons.c1.development).toBe(3);
});

// 4. UL decrease via decay flags

describe('decay flags lower UL by one', () => {
  const flags = ['siege', 'energy', 'food', 'catastrophe'] as const;
  for (const flag of flags) {
    test(`decay via ${flag}`, () => {
      const state = setup();
      state.cantons.c1.urbanizationLevel = 5;
      DevelopmentManager.run(state, { c1: { baseRoll: 1, decayFlags: { [flag]: true } } });
      expect(state.cantons.c1.nextUrbanizationLevel).toBe(4);
      expect(state.cantons.c1.development).toBe(0);
    });
  }
});

// 5. Handoff hooks

test('UL effect hooks are exposed', () => {
  expect(SECTOR_SLOTS_BY_UL[1]).toBeDefined();
  expect(SECTOR_SLOTS_BY_UL[12]).toBeDefined();
  expect(LABOR_BY_UL[1]).toBeDefined();
  expect(LABOR_BY_UL[12]).toBeDefined();
  expect(SUITABILITY_BY_UL[1]).toBeDefined();
  expect(SUITABILITY_BY_UL[12]).toBeDefined();
});

// 6. Determinism

test('running with same inputs is deterministic', () => {
  const make = () => {
    const s = setup();
    DevelopmentManager.run(s, { c1: { baseRoll: 4, modifiers: [1], cap: 5 } });
    return JSON.stringify(s);
  };
  const first = make();
  const second = make();
  expect(second).toBe(first);
});
