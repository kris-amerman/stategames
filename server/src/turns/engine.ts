import type { GameState, PlayerId } from '../types';
import { createEmptyPlan } from './plan';
import { budgetGate, inputsGate, logisticsGate, laborGate, suitabilityGate } from './gates';

export class TurnEngine {
  static processTurn(state: GameState): void {
    state.phase = 'execution';
    this.executePlans(state);
    this.advancePlans(state);
    state.phase = 'planning';
    state.turnNumber += 1;
  }

  private static executePlans(state: GameState): void {
    for (const playerId of Object.keys(state.plans) as PlayerId[]) {
      const plan = state.plans[playerId].current;
      let ctx = { playerId, gameState: state, plan };
      ctx = budgetGate(ctx);
      ctx = inputsGate(ctx);
      ctx = logisticsGate(ctx);
      ctx = laborGate(ctx);
      ctx = suitabilityGate(ctx);
      // Placeholder for subsequent resolution steps
      // output & consumption
      // trade & FX
      // finance
      // development
    }
  }

  private static advancePlans(state: GameState): void {
    for (const playerId of Object.keys(state.plans) as PlayerId[]) {
      const plans = state.plans[playerId];
      plans.current = plans.next;
      plans.next = createEmptyPlan();
    }
  }
}
