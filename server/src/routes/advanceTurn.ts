// server/src/routes/advanceTurn.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import { TurnManager } from "../turn";
import { broadcastTurnCompleted, broadcastStateChanges } from "../index";
import { collectStateChanges } from "../events";
import type { GameState } from "../types";

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
    const { state: updatedState, result } = await GameService.updateGameState(gameId, (state, game) => {
      const players = game.meta.players;
      const currentIdx = players.indexOf(state.currentPlayer!);
      const resolvedNextPlayer = players[(currentIdx + 1) % players.length] || state.currentPlayer!;
      const prevEconomy = structuredClone(state.economy);
      TurnManager.advanceTurn(state);
      state.currentPlayer = resolvedNextPlayer;
      const events = collectStateChanges(prevEconomy, state.economy);
      return { events, nextPlayer: resolvedNextPlayer };
    });

    const { events, nextPlayer: resolvedNextPlayer } = result;

    broadcastStateChanges(gameId, events);
    broadcastTurnCompleted(gameId, updatedState as unknown as GameState, resolvedNextPlayer, events);
    return new Response(JSON.stringify({ ok: true, nextPlayer: resolvedNextPlayer }), {
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
