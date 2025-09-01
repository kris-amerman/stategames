// server/src/routes/getLogistics.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import type { LogisticsResult } from "../logistics/manager";

const EMPTY_LOGISTICS: LogisticsResult = {
  lp: {
    supply: 0,
    demand_operating: 0,
    demand_domestic: 0,
    demand_international: 0,
    lp_ratio: 1,
  },
  operatingAllocations: {},
  domesticAllocations: {},
  internationalAllocations: {},
};

export async function getLogistics(gameId: string) {
  try {
    const state = await GameService.getGameState(gameId);
    if (!state) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const logistics = (state as any).lastLogistics || EMPTY_LOGISTICS;
    return new Response(JSON.stringify(logistics), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("get logistics error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
