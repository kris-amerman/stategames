// server/src/routes/submitPlan.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import { TurnManager } from "../turn";
import type { TurnPlan } from "../types";

function validatePlan(plan: TurnPlan, gameState: any): string | null {
  // Budgets validation
  const econ = gameState.economy;
  const budgets = plan.budgets;
  if (budgets) {
    const military = budgets.military ?? 0;
    const welfare = budgets.welfare ?? 0;
    let total = military + welfare;
    for (const v of Object.values(budgets.sectorOM || {})) {
      if (typeof v !== 'number' || v < 0) return 'Invalid sectorOM budget';
      total += v;
    }
    if (total > econ.resources.gold) return 'Budget exceeds available gold';
  }
  // Policies - national infrastructure uniqueness
  const policies: any = plan.policies || {};
  if (policies.nationalPort && gameState.economy.infrastructure.national.port) {
    return 'National port already exists';
  }
  if (policies.nationalAirport && gameState.economy.infrastructure.national.airport) {
    return 'National airport already exists';
  }
  if (policies.nationalRailHub && gameState.economy.infrastructure.national.rail) {
    return 'National rail hub already exists';
  }
  // Trade orders FX check
  if (plan.tradeOrders) {
    let fx = 0;
    for (const order of Object.values(plan.tradeOrders)) {
      const spent = (order as any).fxSpent || 0;
      fx += typeof spent === 'number' ? spent : 0;
    }
    if (fx > econ.resources.fx) return 'Trade orders exceed available FX';
  }
  return null;
}

export async function submitPlan(gameId: string, req: Request) {
  try {
    const body = await req.json();
    const { playerId, plan } = body;
    if (!playerId || !plan) {
      return new Response(JSON.stringify({ error: "playerId and plan required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const gameState = await GameService.getGameState(gameId);
    if (!gameState) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (gameState.status !== 'in_progress') {
      return new Response(JSON.stringify({ error: "Game not in progress" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (gameState.currentPlayer !== playerId) {
      return new Response(JSON.stringify({ error: "Not your turn" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (gameState.planSubmittedBy) {
      return new Response(JSON.stringify({ error: "Plan already submitted" }), {
        status: 409,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const err = validatePlan(plan, gameState);
    if (err) {
      return new Response(JSON.stringify({ error: err }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    TurnManager.submitPlan(gameState, plan);
    gameState.planSubmittedBy = playerId;
    await GameService.saveGameState(gameState, gameId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('submit plan error', err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
