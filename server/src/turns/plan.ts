import type { TurnPlan } from '../types';

export function createEmptyPlan(): TurnPlan {
  return {
    budgets: {},
    policies: {},
    priorities: {}
  };
}
