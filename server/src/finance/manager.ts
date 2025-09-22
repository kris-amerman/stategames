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
    finance.defaulted = false;

    // record inputs in summary
    finance.summary.revenues = input.revenues;
    finance.summary.expenditures = input.expenditures;
    finance.summary.netBorrowing = 0;
    finance.summary.interest = 0;

    // Step 1: apply revenues and expenditures
    economy.resources.gold += input.revenues - input.expenditures;

    // Step 2 & 3: auto-borrow if needed and update debt
    finance.summary.netBorrowing += this.autoBorrow(economy);

    // Step 4: apply interest tick
    const interest = finance.debt * finance.interestRate;
    finance.summary.interest = interest;

    // Add interest to debt, respecting credit limit
    const availableForInterest = finance.creditLimit - finance.debt;
    if (interest > availableForInterest) {
      finance.debt = finance.creditLimit;
      finance.defaulted = true;
    } else {
      finance.debt += interest;
    }

    // Deduct interest from treasury
    economy.resources.gold -= interest;

    // Borrow again if interest payment caused deficit
    finance.summary.netBorrowing += this.autoBorrow(economy);

    // Step 5: credit limit check and enforce cap
    if (finance.debt >= finance.creditLimit && economy.resources.gold < 0) {
      // debt already capped; treasury remains negative in default
      finance.defaulted = true;
    }

    // Step 6: debt stress tier flags
    finance.debtStress = DEBT_STRESS_TIERS.map((t) => finance.debt >= t);

    finance.summary.defaulted = finance.defaulted;
  }

  /** Borrow automatically to cover treasury shortfalls. */
  private static autoBorrow(economy: EconomyState): number {
    const finance = economy.finance;
    if (economy.resources.gold >= 0) return 0;
    const needed = -economy.resources.gold;
    const available = finance.creditLimit - finance.debt;
    const borrow = Math.max(0, Math.min(needed, available));
    finance.debt += borrow;
    economy.resources.gold += borrow;
    if (borrow < needed) {
      finance.defaulted = true;
    }
    return borrow;
  }
}
