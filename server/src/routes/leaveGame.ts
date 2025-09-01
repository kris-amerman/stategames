// server/src/routes/leaveGame.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";

export async function leaveGame(gameId: string, req: Request) {
  try {
    const { playerId } = await req.json();
    if (!playerId) {
      return new Response(JSON.stringify({ error: "playerId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const game = await GameService.leaveGame(gameId, playerId);
    if (!game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    return new Response(JSON.stringify({ ok: true, players: game.meta.players }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err:any) {
    const msg = err?.message || "Internal server error";
    const status = msg === 'Player not in game' ? 400 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
