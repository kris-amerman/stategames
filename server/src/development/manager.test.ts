import { expect, test, describe } from 'bun:test';
import { EconomyManager } from '../economy';
import { DevelopmentManager, SECTOR_SLOTS_BY_UL, LABOR_BY_UL, SUITABILITY_BY_UL } from './manager';
import { LaborManager } from '../labor/manager';
import type { EconomyState } from '../types';

function setup(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'c1');
  return state;
}

// 1. Meter advance, rollover, and bounds

test('meter advances with gain and rollover carries remainder within bounds', () => {
  const state = setup();
  // no modifiers
  DevelopmentManager.run(state, { c1: { baseRoll: 2 } });
  expect(state.cantons.c1.development).toBe(2);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(1);
  // rollover with remainder
  state.cantons.c1.development = 2;
  DevelopmentManager.run(state, { c1: { baseRoll: 3 } });
  expect(state.cantons.c1.development).toBe(1); // 2 + 3 =5 -> +1 UL -> remainder 1
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(2);
  // UL capped at 12 and meter clamped
  state.cantons.c1.urbanizationLevel = 12;
  state.cantons.c1.nextUrbanizationLevel = 12;
  state.cantons.c1.development = 3;
  DevelopmentManager.run(state, { c1: { baseRoll: 6 } });
  expect(state.cantons.c1.development).toBe(4);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(12);
});

// 2. Modifiers aggregation including negatives

test('development roll aggregates modifiers and negatives floor to zero', () => {
  const state = setup();
  DevelopmentManager.run(state, { c1: { baseRoll: 2, modifiers: [2, -1] } });
  expect(state.cantons.c1.development).toBe(3);
  state.cantons.c1.development = 1;
  DevelopmentManager.run(state, { c1: { baseRoll: 1, modifiers: [-5] } });
  expect(state.cantons.c1.development).toBe(1);
});

// 3. Cap enforcement

test('per-turn cap limits development gain', () => {
  const state = setup();
  DevelopmentManager.run(state, { c1: { baseRoll: 6, modifiers: [3], cap: 2 } });
  expect(state.cantons.c1.development).toBe(2);
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(1);
});

// 4. UL increase timing and next-turn effects

test('UL increases take effect next turn and update labor', () => {
  const state = setup();
  LaborManager.generate(state);
  const before = state.cantons.c1.labor.general;
  DevelopmentManager.run(state, { c1: { baseRoll: 4 } }); // gain 4 -> nextUL 2
  LaborManager.generate(state);
  const sameTurn = state.cantons.c1.labor.general;
  expect(sameTurn).toBe(before);
  DevelopmentManager.applyPending(state);
  LaborManager.generate(state);
  const after = state.cantons.c1.labor.general;
  expect(after).toBeGreaterThan(before);
});

// 5. Decay flags trigger UL decrease

describe('decay flags lower UL by one and reset meter', () => {
  const flags = ['siege', 'energy', 'food', 'catastrophe'] as const;
  for (const flag of flags) {
    test(flag, () => {
      const state = setup();
      state.cantons.c1.urbanizationLevel = 5;
      state.cantons.c1.development = 3;
      DevelopmentManager.run(state, { c1: { baseRoll: 6, decayFlags: { [flag]: true } } });
      expect(state.cantons.c1.nextUrbanizationLevel).toBe(4);
      expect(state.cantons.c1.development).toBe(0);
    });
  }
  test('UL cannot drop below 1', () => {
    const state = setup();
    DevelopmentManager.run(state, { c1: { baseRoll: 3, decayFlags: { energy: true } } });
    expect(state.cantons.c1.nextUrbanizationLevel).toBe(1);
    expect(state.cantons.c1.development).toBe(0);
  });
});

// 6. Single step rule

test('a canton changes UL by at most one step per turn', () => {
  const state = setup();
  state.cantons.c1.development = 3;
  DevelopmentManager.run(state, { c1: { baseRoll: 6, modifiers: [10] } });
  expect(state.cantons.c1.nextUrbanizationLevel).toBe(2);
  expect(state.cantons.c1.development).toBeLessThanOrEqual(3);
  const state2 = setup();
  state2.cantons.c1.urbanizationLevel = 2;
  state2.cantons.c1.development = 3;
  DevelopmentManager.run(state2, { c1: { baseRoll: 6, decayFlags: { food: true } } });
  expect(state2.cantons.c1.nextUrbanizationLevel).toBe(1);
  expect(state2.cantons.c1.development).toBe(0);
});

// 7. Determinism

test('running with identical inputs is deterministic', () => {
  const make = () => {
    const s = setup();
    DevelopmentManager.run(s, { c1: { baseRoll: 4, modifiers: [1], cap: 5 } });
    return JSON.stringify(s);
    };
  const first = make();
  const second = make();
  expect(second).toBe(first);
});

// 8. Handoff hooks exposed

test('UL effect hooks exist for full range', () => {
  expect(SECTOR_SLOTS_BY_UL[1]).toBeDefined();
  expect(SECTOR_SLOTS_BY_UL[12]).toBeDefined();
  expect(LABOR_BY_UL[1]).toBeDefined();
  expect(LABOR_BY_UL[12]).toBeDefined();
  expect(SUITABILITY_BY_UL[1]).toBeDefined();
  expect(SUITABILITY_BY_UL[12]).toBeDefined();
});
