import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { WelfareManager, EDUCATION_TIERS, HEALTHCARE_TIERS, SOCIAL_SUPPORT_COST } from './manager';
import type { EconomyState, LaborPool } from '../types';

function setupState(labor: LaborPool = { general: 50, skilled: 20, specialist: 10 }): EconomyState {
  const state = EconomyManager.createInitialState();
  EconomyManager.addCanton(state, 'A');
  state.cantons['A'].labor = { ...labor };
  state.resources.gold = 1000;
  return state;
}

// --- Slider and lag behaviour ---

test('sliders clamp to ±1 change per turn', () => {
  const state = setupState();
  WelfareManager.applyPolicies(state, { education: 2, healthcare: 2 });
  expect(state.welfare.next.education).toBe(1);
  expect(state.welfare.next.healthcare).toBe(1);
});

test('policy effects apply next turn', () => {
  const state = setupState();
  WelfareManager.applyPolicies(state, { education: 1 });
  // still tier 0 until pending applied
  expect(state.welfare.current.education).toBe(0);
  expect(WelfareManager.getModifiers(state).research).toBe(0);
  WelfareManager.applyPending(state);
  expect(state.welfare.current.education).toBe(1);
  expect(WelfareManager.getModifiers(state).research).toBeCloseTo(0.05);
});

// --- Costing ---

test('welfare cost scales with labor and includes social support', () => {
  const state = setupState({ general: 40, skilled: 30, specialist: 30 });
  state.welfare.current = { education: 1, healthcare: 2, socialSupport: 3 };
  const cost = WelfareManager.applyPolicies(state, {
    education: 2,
    healthcare: 3,
    socialSupport: 4,
  });
  const L = 100; // total labor
  const expected =
    L *
    (EDUCATION_TIERS[2].cost +
      HEALTHCARE_TIERS[3].cost +
      SOCIAL_SUPPORT_COST[4]);
  expect(cost).toBeCloseTo(expected);
  expect(state.resources.gold).toBeCloseTo(1000 - expected);
});

// --- Education effects ---

test('education tier tables match specification', () => {
  const laborShifts = [0, 10, 20, 30, 40];
  const research = [0, 0.05, 0.1, 0.15, 0.2];
  const dev = [-1, 0, 1, 2, 3];
  for (let i = 0; i < EDUCATION_TIERS.length; i++) {
    expect(EDUCATION_TIERS[i].laborShift).toBe(laborShifts[i]);
    expect(EDUCATION_TIERS[i].research).toBeCloseTo(research[i]);
    expect(EDUCATION_TIERS[i].devRoll).toBe(dev[i]);
  }
});

test('labor mix shift splits 2:1 and caps/floors classes', () => {
  const base: LaborPool = { general: 100, skilled: 0, specialist: 0 };
  const shifted = WelfareManager.applyLaborMixShift(base, 10);
  expect(shifted.general).toBe(90);
  expect(shifted.skilled + shifted.specialist).toBe(10);
  const cappedBase: LaborPool = { general: 5, skilled: 88, specialist: 7 };
  const capped = WelfareManager.applyLaborMixShift(cappedBase, 40);
  expect(capped.general).toBe(0); // floored
  expect(capped.skilled).toBe(90); // capped
});

// --- Healthcare effects ---

test('healthcare tier tables match specification', () => {
  const happiness = [-1, -0.5, 0, 0.5, 1];
  const dev = [-1, 0, 1, 1, 2];
  for (let i = 0; i < HEALTHCARE_TIERS.length; i++) {
    expect(HEALTHCARE_TIERS[i].happiness).toBe(happiness[i]);
    expect(HEALTHCARE_TIERS[i].devRoll).toBe(dev[i]);
  }
});

// --- Stacking & determinism ---

test('education and healthcare modifiers stack additively', () => {
  const state = setupState();
  state.welfare.current = { education: 2, healthcare: 3, socialSupport: 0 };
  const mods = WelfareManager.getModifiers(state);
  expect(mods.devRoll).toBe(EDUCATION_TIERS[2].devRoll + HEALTHCARE_TIERS[3].devRoll);
  expect(mods.research).toBeCloseTo(EDUCATION_TIERS[2].research);
  expect(mods.happinessPerLabor).toBeCloseTo(HEALTHCARE_TIERS[3].happiness);
});

test('identical inputs yield identical cost and modifiers', () => {
  const s1 = setupState();
  const s2 = setupState();
  const policies = { education: 1, healthcare: 2, socialSupport: 1 };
  const c1 = WelfareManager.applyPolicies(s1, policies);
  const c2 = WelfareManager.applyPolicies(s2, policies);
  expect(c1).toBe(c2);
  WelfareManager.applyPending(s1);
  WelfareManager.applyPending(s2);
  const m1 = WelfareManager.getModifiers(s1);
  const m2 = WelfareManager.getModifiers(s2);
  expect(m1).toEqual(m2);
});
