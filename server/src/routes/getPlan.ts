// server/src/routes/getPlan.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import type { TurnPlan } from "../types";

const EMPTY_PLAN: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} }, policies: {}, slotPriorities: {}, tradeOrders: {}, projects: {} } as any;

export async function getPlan(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const plan = state.nextPlan || EMPTY_PLAN;
    const welfare = state.economy?.welfare?.next;
    return new Response(JSON.stringify({ plan, welfare }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get plan error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
