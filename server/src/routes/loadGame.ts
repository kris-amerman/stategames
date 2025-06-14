// server/src/routes/loadGame.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import { encode } from '../serialization';

/**
 * Return the game for a given gameId.
 */
export async function loadGame(gameId: string) {
  try {
    if (!gameId) {
      return new Response(JSON.stringify({ error: "Game ID required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Get game
    const game = await GameService.getGame(gameId);

    if (!game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    if (game.state.status !== "in_progress") {
      return new Response(
        JSON.stringify({
          error: "Game data only available for games in progress",
          status: game.state.status,
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Return complete game as JSON
    const gameData = encode(game);
    return new Response(gameData, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error("Get game error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
}