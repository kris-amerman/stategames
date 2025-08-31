import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy';
import { SuitabilityManager } from './manager';
import type { EconomyState, GeographyModifiers, UrbanizationModifiers, SectorType } from '../types';

function setupEconomy(): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'c1');
  return state;
}

const allSectors: SectorType[] = [
  'agriculture',
  'extraction',
  'manufacturing',
  'defense',
  'luxury',
  'finance',
  'research',
  'logistics',
];

function configureModifiers() {
  const geo: GeographyModifiers = {
    agriculture: { plains: 20, mountains: -10 },
    manufacturing: { plains: 15, mountains: -30 },
    // defaults for other sectors will be zero
  };
  const ul: UrbanizationModifiers = {
    agriculture: { 2: 5, 3: 10 },
    manufacturing: { 2: 3, 3: 6 },
  };
  SuitabilityManager.setGeographyModifiers(geo);
  SuitabilityManager.setUrbanizationModifiers(ul);
}

// 1. Suitability output structure

test('produces percent and multiplier for each sector', () => {
  const state = setupEconomy();
  configureModifiers();
  const results = SuitabilityManager.run(state);
  for (const sector of allSectors) {
    const res = results.c1[sector];
    expect(typeof res.percent).toBe('number');
    expect(typeof res.multiplier).toBe('number');
    expect(state.cantons.c1.suitability[sector]).toBe(res.percent);
    expect(state.cantons.c1.suitabilityMultipliers[sector]).toBe(res.multiplier);
  }
});

// 2. Weighted geography and UL modifier

test('geography shares and UL modifier contribute correctly', () => {
  const state = setupEconomy();
  configureModifiers();
  state.cantons.c1.geography = { plains: 0.6, mountains: 0.4 };
  state.cantons.c1.urbanizationLevel = 2;
  const res = SuitabilityManager.run(state).c1.agriculture;
  // 0.6*20 + 0.4*-10 = 8, + UL(5) = 13 -> rounded 13
  expect(res.percent).toBe(13);
  expect(res.multiplier).toBeCloseTo(1.13);
});

// 3. UL modifier applied once

test('changing UL changes suitability once', () => {
  const state = setupEconomy();
  configureModifiers();
  state.cantons.c1.geography = { plains: 1 };
  state.cantons.c1.urbanizationLevel = 2;
  const res2 = SuitabilityManager.run(state).c1.agriculture.percent;
  state.cantons.c1.urbanizationLevel = 3;
  const res3 = SuitabilityManager.run(state).c1.agriculture.percent;
  expect(res3 - res2).toBe(5); // difference between UL modifiers 10-5
});

// 4. Rounding before clamping

test('rounding occurs before clamping', () => {
  const state = setupEconomy();
  configureModifiers();
  state.cantons.c1.geography = { plains: 1 };
  state.cantons.c1.urbanizationLevel = 3; // geo 20 + ul 10 = 30
  // adjust geo modifier to produce 50.6 total: use temporary modifiers
  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: 40.6 } });
  SuitabilityManager.setUrbanizationModifiers({ agriculture: { 1: 10 } });
  state.cantons.c1.urbanizationLevel = 1;
  const res = SuitabilityManager.run(state).c1.agriculture;
  expect(res.percent).toBe(50); // 40.6 + 10 = 50.6 -> round 51 -> clamp 50
  expect(res.multiplier).toBe(1.5);
});

// 5. Clamping range

test('clamps to [-60,50]', () => {
  const state = setupEconomy();
  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: 200 }, manufacturing: { plains: -200 } });
  SuitabilityManager.setUrbanizationModifiers({});
  state.cantons.c1.geography = { plains: 1 };
  const resHigh = SuitabilityManager.run(state).c1.agriculture;
  expect(resHigh.percent).toBe(50);
  expect(resHigh.multiplier).toBe(1.5);
  const resLow = SuitabilityManager.run(state).c1.manufacturing;
  expect(resLow.percent).toBe(-60);
  expect(resLow.multiplier).toBe(0.4);
});

// 6. Cache stability and invalidation

test('cache stable until UL or geography changes', () => {
  const state = setupEconomy();
  SuitabilityManager.setGeographyModifiers({ agriculture: { plains: 10 } });
  SuitabilityManager.setUrbanizationModifiers({ agriculture: { 1: 0 } });
  const r1 = SuitabilityManager.run(state).c1.agriculture;
  const r2 = SuitabilityManager.run(state).c1.agriculture;
  // same object reference when cached
  expect(r2).toBe(r1);
  state.cantons.c1.urbanizationLevel = 2;
  const r3 = SuitabilityManager.run(state).c1.agriculture;
  expect(r3).not.toBe(r1);
  state.cantons.c1.urbanizationLevel = 2;
  state.cantons.c1.geography = { plains: 0.5, mountains: 0.5 };
  const r4 = SuitabilityManager.run(state).c1.agriculture;
  expect(r4).not.toBe(r3);
});
