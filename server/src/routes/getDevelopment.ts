// server/src/routes/getDevelopment.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";

export async function getDevelopment(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const cantons: any = {};
    for (const [id, c] of Object.entries(state.economy.cantons)) {
      cantons[id] = {
        urbanizationLevel: c.urbanizationLevel,
        development: c.development,
        nextUrbanizationLevel: c.nextUrbanizationLevel,
      };
    }
    return new Response(JSON.stringify({ cantons }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get development error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
