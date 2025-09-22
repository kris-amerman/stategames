import type { EconomyState, LaborPool, WelfarePolicies } from '../types';

export interface EducationTier {
  cost: number;
  laborShift: number;
  research: number;
  devRoll: number;
}

export interface HealthcareTier {
  cost: number;
  happiness: number;
  devRoll: number;
}

export const EDUCATION_TIERS: EducationTier[] = [
  { cost: 0,    laborShift: 0,  research: 0,    devRoll: -1 },
  { cost: 0.25, laborShift: 10, research: 0.05, devRoll: 0 },
  { cost: 0.5,  laborShift: 20, research: 0.10, devRoll: 1 },
  { cost: 0.75, laborShift: 30, research: 0.15, devRoll: 2 },
  { cost: 1,    laborShift: 40, research: 0.20, devRoll: 3 },
];

export const HEALTHCARE_TIERS: HealthcareTier[] = [
  { cost: 0,    happiness: -1,  devRoll: -1 },
  { cost: 0.25, happiness: -0.5, devRoll: 0 },
  { cost: 0.5,  happiness: 0,    devRoll: 1 },
  { cost: 0.75, happiness: 0.5,  devRoll: 1 },
  { cost: 1,    happiness: 1,    devRoll: 2 },
];

export const SOCIAL_SUPPORT_COST: number[] = [0, 0.25, 0.5, 0.75, 1];

function clampTier(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(4, Math.round(value)));
}

/**
 * Total national labor across all cantons.
 */
export function totalLabor(state: EconomyState): number {
  let total = 0;
  for (const canton of Object.values(state.cantons)) {
    const l = canton.labor;
    total += l.general + l.skilled + l.specialist;
  }
  return total;
}

export class WelfareManager {
  /** Apply policy sliders for this turn and charge welfare cost. */
  static applyPolicies(
    state: EconomyState,
    policies?: Partial<WelfarePolicies>,
  ): number {
    const current = state.welfare.current;
    const next = { ...current };

    if (policies) {
      for (const key of ['education', 'healthcare', 'socialSupport'] as const) {
        const desired = policies[key];
        if (typeof desired === 'number') {
          const clamped = clampTier(desired);
          const limited = Math.max(current[key] - 1, Math.min(current[key] + 1, clamped));
          next[key] = limited;
        }
      }
    }

    state.welfare.next = next;

    const L = totalLabor(state);
    const cost =
      L *
      (EDUCATION_TIERS[next.education].cost +
        HEALTHCARE_TIERS[next.healthcare].cost +
        SOCIAL_SUPPORT_COST[next.socialSupport]);

    state.resources.gold -= cost;
    return cost;
  }

  /** Move next-turn tiers into current active tiers. */
  static applyPending(state: EconomyState): void {
    state.welfare.current = { ...state.welfare.next };
  }

  /** Get combined welfare modifiers from active tiers. */
  static getModifiers(state: EconomyState) {
    const edu = EDUCATION_TIERS[state.welfare.current.education];
    const health = HEALTHCARE_TIERS[state.welfare.current.healthcare];
    return {
      laborShift: edu.laborShift,
      research: edu.research,
      devRoll: edu.devRoll + health.devRoll,
      happinessPerLabor: health.happiness,
    };
  }

  /** Apply an education labor mix shift to a labor pool (percentages). */
  static applyLaborMixShift(labor: LaborPool, points: number): LaborPool {
    const skilledAdd = Math.round((points * 2) / 3);
    const specialistAdd = points - skilledAdd;
    const general = Math.min(90, Math.max(0, labor.general - points));
    const skilled = Math.min(90, Math.max(0, labor.skilled + skilledAdd));
    const specialist = Math.min(90, Math.max(0, labor.specialist + specialistAdd));
    return { general, skilled, specialist };
  }
}
