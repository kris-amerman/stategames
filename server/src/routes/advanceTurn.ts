// server/src/routes/advanceTurn.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import { TurnManager } from "../turn";

export async function advanceTurn(gameId: string, req: Request) {
  try {
    const { playerId } = await req.json();
    if (!playerId) {
      return new Response(JSON.stringify({ error: "playerId required" }), {
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
    if (gameState.planSubmittedBy !== playerId) {
      return new Response(JSON.stringify({ error: "Plan not submitted by player" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    // determine next player from meta
    const meta = await GameService.getGameMeta(gameId);
    const players = meta?.players || [];
    const currentIdx = players.indexOf(gameState.currentPlayer);
    const nextPlayer = players[(currentIdx + 1) % players.length] || gameState.currentPlayer;

    TurnManager.advanceTurn(gameState);
    gameState.currentPlayer = nextPlayer;

    await GameService.saveGameState(gameState, gameId);
    return new Response(JSON.stringify({ ok: true, nextPlayer }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('advance turn error', err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
