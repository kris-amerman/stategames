// server/src/finance/manager.ts
import type { EconomyState } from '../types';

/** Debt stress tier thresholds. */
export const DEBT_STRESS_TIERS = [50, 100, 200];

export interface FinanceInput {
  revenues: number;
  expenditures: number;
}

/**
 * Handles treasury accounting, auto-borrowing, interest application,
 * credit limit enforcement, and debt stress flags.
 */
export class FinanceManager {
  /** Run the finance resolution sequence for the turn. */
  static run(economy: EconomyState, input: FinanceInput): void {
    const finance = economy.finance;
    // Step 1: apply revenues and expenditures
    economy.resources.gold += input.revenues - input.expenditures;

    // Step 2 & 3: auto-borrow if needed and update debt
    this.autoBorrow(economy);

    // Step 4: apply interest tick
    const interest = finance.debt * finance.interestRate;
    economy.resources.gold -= interest;
    finance.debt += interest;
    // Borrow again if interest payment caused deficit
    this.autoBorrow(economy);

    // Step 5: credit limit check
    if (finance.debt > finance.creditLimit) {
      finance.defaulted = true;
    }

    // Step 6: debt stress tier flags
    finance.debtStress = DEBT_STRESS_TIERS.map((t) => finance.debt >= t);
  }

  /** Borrow automatically to cover treasury shortfalls. */
  private static autoBorrow(economy: EconomyState): void {
    const finance = economy.finance;
    if (economy.resources.gold >= 0) return;
    const needed = -economy.resources.gold;
    const available = finance.creditLimit - finance.debt;
    const borrow = Math.min(needed, available);
    finance.debt += borrow;
    economy.resources.gold += borrow;
    if (economy.resources.gold < 0) {
      finance.defaulted = true;
    }
  }
}
