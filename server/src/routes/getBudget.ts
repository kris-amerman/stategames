// server/src/routes/getBudget.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import type { BudgetPools } from "../types";

const EMPTY_BUDGET: BudgetPools = { military: 0, welfare: 0, sectorOM: {} };

export async function getBudget(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const budgets = state.nextPlan?.budgets || EMPTY_BUDGET;
    return new Response(JSON.stringify(budgets), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get budget error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
