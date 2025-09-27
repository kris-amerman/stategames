import { describe, expect, it } from 'vitest';
import { computeLastRoundSpendFromSnapshot } from './planner';

describe('computeLastRoundSpendFromSnapshot', () => {
  it('returns 0 on the first turn regardless of finance data', () => {
    const snapshot = { turnNumber: 1, economy: { finance: { summary: { expenditures: 123 } } } };
    const nation = {
      finance: {
        waterfall: { operations: 50, welfare: 20, military: 10, projects: 5, interest: 2 },
      },
    };

    expect(computeLastRoundSpendFromSnapshot(snapshot, nation, 999)).toBe(0);
  });

  it('sums waterfall components when available after the first turn', () => {
    const snapshot = { turnNumber: 2 };
    const nation = {
      finance: {
        waterfall: { operations: 80, welfare: 15, military: 25, projects: 10, interest: 5 },
      },
    };

    expect(computeLastRoundSpendFromSnapshot(snapshot, nation, 0)).toBe(135);
  });

  it('falls back to finance summary expenditures when waterfall is missing', () => {
    const snapshot = { turnNumber: 3, economy: { finance: { summary: { expenditures: 42 } } } };

    expect(computeLastRoundSpendFromSnapshot(snapshot, {}, 0)).toBe(42);
  });

  it('returns the previous value when no data is available', () => {
    const snapshot = { turnNumber: 4 };

    expect(computeLastRoundSpendFromSnapshot(snapshot, {}, 17)).toBe(17);
  });
});
