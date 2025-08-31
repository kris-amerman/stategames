import { test, expect } from 'bun:test';
import { EconomyManager } from '../economy';
import { LaborManager } from './manager';
import type { EconomyState } from '../types';

function setup(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'c1');
  // provide plenty of consumables to avoid shortages unless we test for them
  state.resources.food = 100;
  state.resources.luxury = 100;
  return state;
}

// Labor generation and education shift

test('labor generation respects education shift and UL', () => {
  const state = setup();
  state.cantons.c1.urbanizationLevel = 2; // base: 10g 3s 1sp
  state.welfare.current.education = 4; // laborShift 40
  LaborManager.generate(state);
  const labor = state.cantons.c1.labor;
  expect(labor.general + labor.skilled + labor.specialist).toBe(14);
  // exact distribution after 40pt shift: 4,7,3
  expect(labor).toEqual({ general: 4, skilled: 7, specialist: 3 });
  // caps respected
  const total = labor.general + labor.skilled + labor.specialist;
  expect(labor.skilled / total <= 0.9).toBeTrue();
});

// Healthcare modifier

test('healthcare tier records happiness modifier', () => {
  const state = setup();
  state.welfare.current.healthcare = 4; // happiness +1
  LaborManager.generate(state);
  expect(state.cantons.c1.happiness).toBe(1);
});

// Assignment ordering and class requirements with unmet demand

test('assignment prioritizes suitability and respects labor classes', () => {
  const state = setup();
  state.cantons.c1.urbanizationLevel = 1; // 5g 1s
  state.cantons.c1.sectors = {
    agriculture: { capacity: 5, funded: 5, idle: 0 },
    extraction: { capacity: 3, funded: 3, idle: 0 },
  } as any;
  state.cantons.c1.suitability = { agriculture: 0.2, extraction: 0.8 };
  LaborManager.run(state);
  expect(state.cantons.c1.laborAssigned.agriculture?.general).toBe(5);
  expect(state.cantons.c1.laborAssigned.extraction?.skilled).toBe(1);
  // two extraction slots unmet
  expect(state.cantons.c1.sectors.extraction.funded).toBe(1);
  expect(state.cantons.c1.sectors.extraction.idle).toBe(2);
});

// LAI scaling

test('labor access index scales assigned labor', () => {
  const state = setup();
  state.cantons.c1.urbanizationLevel = 2; // 10 general supply
  state.cantons.c1.lai = 0.5;
  state.cantons.c1.sectors.agriculture = { capacity: 10, funded: 10, idle: 0 } as any;
  LaborManager.run(state);
  expect(state.cantons.c1.laborAssigned.agriculture?.general).toBe(5);
  expect(state.cantons.c1.sectors.agriculture.funded).toBe(5);
  expect(state.cantons.c1.sectors.agriculture.idle).toBe(5);
});

// Education effects only apply to new labor each turn and no stockpiling

test('education effects apply per turn and labor does not stockpile', () => {
  const state = setup();
  state.cantons.c1.urbanizationLevel = 1;
  state.welfare.current.education = 4;
  LaborManager.generate(state);
  const first = { ...state.cantons.c1.labor };
  state.welfare.current.education = 0; // revert
  LaborManager.generate(state);
  const second = state.cantons.c1.labor;
  expect(first).toEqual({ general: 3, skilled: 3, specialist: 0 });
  expect(second).toEqual({ general: 5, skilled: 1, specialist: 0 });
});

// Zero-labor canton and full healthcare tier

test('canton with zero UL produces no labor but still records happiness', () => {
  const state = setup();
  state.cantons.c1.urbanizationLevel = 0;
  state.welfare.current.healthcare = 4;
  LaborManager.generate(state);
  expect(state.cantons.c1.labor).toEqual({ general: 0, skilled: 0, specialist: 0 });
  expect(state.cantons.c1.happiness).toBe(1);
});
