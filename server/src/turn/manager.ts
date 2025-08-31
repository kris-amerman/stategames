// server/src/turn/manager.ts
import type { GameState, TurnPlan } from '../types';
import { BudgetManager } from '../budget/manager';
import { LaborManager } from '../labor/manager';
import { LogisticsManager } from '../logistics/manager';
import { EnergyManager } from '../energy/manager';
import { SuitabilityManager } from '../suitability/manager';
import { DevelopmentManager } from '../development/manager';
import { FinanceManager } from '../finance/manager';
import { WelfareManager } from '../welfare/manager';

/**
 * Orchestrates the two-phase turn resolution with a one-turn lag.
 * Planning Phase: players define budgets, policies, and orders that will apply next turn.
 * Execution Phase: the previous turn's plan is resolved through the Five Gates sequence.
 */
export class TurnManager {

  /**
   * Advance the game by one turn.
   * Executes the current plan, shifts the next plan into place, and prepares planning for the following turn.
   */
  static advanceTurn(gameState: GameState): void {
    // Step 1: handle carryover effects from ongoing projects, stock updates, etc.
    this.carryover(gameState);

    // Step 2: execute last turn's plan through the gates and resolution steps.
    this.executeCurrentPlan(gameState);

    // Step 3: move the upcoming plan into the active slot and initialize a new planning container.
    gameState.currentPlan = gameState.nextPlan ?? null;
    gameState.nextPlan = this.createEmptyPlan();
    gameState.phase = 'planning';
  }

  /** Ensure a plan exists for players to modify during the planning phase. */
  static startPlanning(gameState: GameState): void {
    gameState.phase = 'planning';
    if (!gameState.nextPlan) {
      gameState.nextPlan = this.createEmptyPlan();
    }
  }

  /** Submit a plan that will execute on the following turn. */
  static submitPlan(gameState: GameState, plan: TurnPlan): void {
    gameState.nextPlan = plan;
  }

  /**
   * Run the execution phase for the plan scheduled for this turn.
   * The plan passes sequentially through the Five Gates before downstream systems resolve.
   */
  private static executeCurrentPlan(gameState: GameState): void {
    gameState.phase = 'execution';

    if (!gameState.currentPlan) {
      // Early turns may have no plan yet; nothing to execute.
      return;
    }

    // Gate 1 — Budget
    this.budgetGate(gameState);

    // Gate 2A — Inputs
    this.inputsGate(gameState);

    // Gate 2B — Energy
    this.energyGate(gameState);

    // Gate 2B — Logistics
    this.logisticsGate(gameState);

    // Gate 3 — Labor
    this.laborGate(gameState);

    // Gate 4 — Suitability
    this.suitabilityGate(gameState);

    // Post-gate resolution steps
    this.multiplySiteFactors(gameState);
    this.resolveOutputAndConsumption(gameState);
    this.resolveTradeAndFX(gameState);
    this.resolveFinance(gameState);
    this.resolveDevelopment(gameState);
    this.cleanup(gameState);
  }

  // === Turn Flow Steps (placeholders) ===

  private static carryover(gameState: GameState): void {
    // TODO: Projects advance, stock and rate updates.
    BudgetManager.advanceRetools(gameState.economy);
    DevelopmentManager.applyPending(gameState.economy);
    WelfareManager.applyPending(gameState.economy);
  }

  private static budgetGate(_gameState: GameState): void {
    if (!_gameState.currentPlan) return;
    const budgets = _gameState.currentPlan.budgets ?? {
      military: 0,
      welfare: 0,
      sectorOM: {},
    };
    BudgetManager.applyBudgets(_gameState.economy, budgets);
    WelfareManager.applyPolicies(
      _gameState.economy,
      _gameState.currentPlan.policies?.welfare,
    );
  }

  private static inputsGate(_gameState: GameState): void {
    // TODO: Apply energy and recipe input caps.
  }

  private static energyGate(gameState: GameState): void {
    EnergyManager.run(gameState.economy, {
      essentialsFirst: gameState.economy.energy.essentialsFirst,
    });
  }

  private static logisticsGate(_gameState: GameState): void {
    LogisticsManager.run(_gameState.economy, {
      networks: {},
      domesticPlans: {},
      internationalPlans: {},
      gatewayCapacities: {},
    });
  }

  private static laborGate(gameState: GameState): void {
    LaborManager.run(gameState.economy, gameState.currentPlan ?? undefined);
  }

  private static suitabilityGate(_gameState: GameState): void {
    SuitabilityManager.run(_gameState.economy);
  }

  private static multiplySiteFactors(_gameState: GameState): void {
    // TODO: Multiply suitability, tech, and welfare modifiers.
  }

  private static resolveOutputAndConsumption(_gameState: GameState): void {
    // TODO: Produce outputs and apply consumption and upkeep costs.
  }

  private static resolveTradeAndFX(_gameState: GameState): void {
    // TODO: Handle trade settlements and foreign exchange adjustments.
  }

  private static resolveFinance(_gameState: GameState): void {
    FinanceManager.run(_gameState.economy, { revenues: 0, expenditures: 0 });
  }

  private static resolveDevelopment(gameState: GameState): void {
    // TODO: Roll for development and update urbanization levels.
    DevelopmentManager.run(gameState.economy, {});
  }

  private static cleanup(_gameState: GameState): void {
    // TODO: Finalize turn, carry shortages, and prepare summary.
    // Logistics points are non-stockpiled and reset each turn.
    _gameState.economy.resources.logistics = 0;
  }

  private static createEmptyPlan(): TurnPlan {
    return {
      budgets: {},
      policies: {},
      slotPriorities: {},
      tradeOrders: {},
      projects: {},
    };
  }
}

