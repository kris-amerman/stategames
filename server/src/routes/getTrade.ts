// server/src/routes/getTrade.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";

export async function getTrade(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    return new Response(JSON.stringify(state.economy.trade), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get trade error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
