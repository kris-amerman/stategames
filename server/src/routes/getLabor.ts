// server/src/routes/getLabor.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";

export async function getLabor(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const econ = state.economy;
    const cantons: any = {};
    for (const [id, c] of Object.entries(econ.cantons)) {
      cantons[id] = {
        labor: c.labor,
        laborDemand: c.laborDemand,
        laborAssigned: c.laborAssigned,
        shortages: c.shortages,
      };
    }
    const laborState = {
      national: econ.resources.labor,
      cantons,
    };
    return new Response(JSON.stringify(laborState), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get labor error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
