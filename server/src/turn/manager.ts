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
import { TradeManager, type TradeResult } from '../trade/manager';
import { SECTOR_DEFINITIONS } from '../economy/manager';

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
    gameState.planSubmittedBy = null;
    gameState.phase = 'planning';
    gameState.turnNumber += 1;
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

    // Gate 2 — Inputs (energy & recipes)
    this.inputsGate(gameState);

    // Gate 3 — Logistics (LP)
    this.logisticsGate(gameState);

    // Gate 4 — Labor
    this.laborGate(gameState);

    // Gate 5 — Suitability
    this.suitabilityGate(gameState);

    // Post-gate resolution steps
    this.multiplySiteFactors(gameState);
    this.resolveOutputAndConsumption(gameState);
    const trade = this.resolveTradeAndFX(gameState);
    this.resolveFinance(gameState, trade);
    this.resolveDevelopment(gameState);
    this.cleanup(gameState);
  }

  // === Turn Flow Steps (placeholders) ===

  private static carryover(gameState: GameState): void {
    // Apply arrivals and lagged policy effects from the previous turn.
    TradeManager.applyPending(gameState.economy);
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

  private static inputsGate(gameState: GameState): void {
    // Energy is the primary hard input at this stage. Recipe inputs are placeholders.
    EnergyManager.run(gameState.economy, {
      essentialsFirst: gameState.economy.energy.essentialsFirst,
    });
  }

  private static logisticsGate(gameState: GameState): void {
    const result = LogisticsManager.run(gameState.economy, {
      networks: {},
      domesticPlans: {},
      internationalPlans: {},
      gatewayCapacities: {},
    });
    // Apply LP ratio uniformly to funded slots (including logistics itself).
    const ratio = result.lp.lp_ratio ?? 1;
    if (ratio < 1) {
      for (const canton of Object.values(gameState.economy.cantons)) {
        for (const sector of Object.keys(canton.sectors) as any[]) {
          const secState = canton.sectors[sector];
          if (!secState || secState.funded <= 0) continue;
          secState.funded = Math.floor(secState.funded * ratio);
        }
      }
    }
    (gameState as any).lastLogistics = result;
  }

  private static laborGate(gameState: GameState): void {
    LaborManager.run(gameState.economy, gameState.currentPlan ?? undefined);
  }

  private static suitabilityGate(gameState: GameState): void {
    SuitabilityManager.run(gameState.economy);
  }

  private static multiplySiteFactors(_gameState: GameState): void {
    // Placeholder – suitability multipliers already cached in canton data.
  }

  private static resolveOutputAndConsumption(gameState: GameState): void {
    const econ = gameState.economy;
    for (const canton of Object.values(econ.cantons)) {
      for (const [sector, state] of Object.entries(canton.sectors)) {
        if (!state || state.funded <= 0) continue;
        state.utilization = state.funded;
        const def = SECTOR_DEFINITIONS[sector as keyof typeof SECTOR_DEFINITIONS];
        if (!def) continue;
        const mult = canton.suitabilityMultipliers[sector as any] ?? 1;
        for (const res of def.outputs) {
          econ.resources[res] += state.utilization * mult;
        }
      }
    }
  }

  private static resolveTradeAndFX(gameState: GameState): TradeResult {
    const result = TradeManager.run(gameState.economy, {
      orders: gameState.currentPlan?.tradeOrders || {},
      capitalUL: 1,
      lastFinanceOutput: 0,
    });
    return result;
  }

  private static resolveFinance(
    _gameState: GameState,
    trade: TradeResult,
  ): void {
    FinanceManager.run(_gameState.economy, {
      revenues: trade.fx_earned + trade.tariff_gold,
      expenditures: trade.fx_spent + trade.freight_fx,
    });
  }

  private static resolveDevelopment(gameState: GameState): void {
    const inputs: Record<string, any> = {};
    for (const id of Object.keys(gameState.economy.cantons)) {
      inputs[id] = { baseRoll: 0 };
    }
    DevelopmentManager.run(gameState.economy, inputs);
  }

  private static cleanup(gameState: GameState): void {
    // Advance retools at end so completions become usable next turn.
    BudgetManager.advanceRetools(gameState.economy);
    // Logistics points are non-stockpiled and reset each turn.
    gameState.economy.resources.logistics = 0;
    gameState.turnSummary = { log: ['turn complete'] } as any;
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

