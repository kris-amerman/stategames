import { describe, it, expect } from 'vitest';
import {
  calculateWelfareCost,
  evaluatePlannerWarnings,
  predictAffordableWelfare,
  createPlanPayloadForTest,
} from './planner';

describe('Nation Planner helpers', () => {
  it('calculates welfare costs per tier', () => {
    const result = calculateWelfareCost(100, 2, 3);
    expect(result.education).toBeCloseTo(50);
    expect(result.healthcare).toBeCloseTo(75);
    expect(result.total).toBeCloseTo(125);
  });

  it('predicts affordable welfare tiers when budget is constrained', () => {
    const affordable = predictAffordableWelfare(40, 100, 3, 3);
    expect(affordable.education).toBeLessThanOrEqual(3);
    expect(affordable.healthcare).toBeLessThanOrEqual(3);
    expect(affordable.education).toBe(0);
    expect(affordable.healthcare).toBe(1);
  });

  it('flags overspending and upkeep gaps', () => {
    const warnings = evaluatePlannerWarnings({
      projectedSpend: 120,
      availableGold: 100,
      militaryAllocation: 10,
      militaryUpkeep: 15,
      welfareBudget: 20,
      totalLabor: 100,
      educationTier: 2,
      healthcareTier: 2,
    });
    expect(warnings).toContain('Total planned spending exceeds treasury.');
    expect(warnings).toContain('Military funding is below upkeep and units may degrade.');
    expect(warnings).toContain('Welfare budget cannot sustain selected tiers; automatic downshift expected.');
  });

  it('creates plan payload with priorities', () => {
    const payload = createPlanPayloadForTest({
      mode: 'custom',
      sectorOrder: ['agriculture', 'research'],
      sectorAllocations: { agriculture: 10, research: 5 },
      militaryAllocation: 12,
      welfareBudget: 8,
      educationTier: 1,
      healthcareTier: 2,
    });
    expect(payload.budgets.military).toBe(12);
    expect(payload.budgets.sectorOM).toEqual({ agriculture: 10, research: 5 });
    expect(payload.slotPriorities).toEqual({ agriculture: 0, research: 1 });
    expect(payload.policies?.welfare.education).toBe(1);
    expect(payload.allocationMode).toBe('custom');
  });
});
