// server/src/routes/startGame.ts
import { CORS_HEADERS } from "../constants";
import { GameService } from "../game-state";
import { broadcastGameStarted } from "..";

/**
 * Given gameId, perform game initialization and broadcast game via WS.
 */
export async function startGame(gameId: string) {
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

    // Try to start the game using the service
    const game = await GameService.startGame(gameId);

    if (!game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    console.log(
      `Game ${gameId} started with ${game.meta.players.length} players`
    );

    // Broadcast complete game data via WebSocket
    broadcastGameStarted(gameId, game);

    return new Response(
      JSON.stringify({
        message: "success"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      }
    );
  } catch (error: any) {
    console.error("Start game error:", error);

    // Handle specific game service errors
    if (
      error.message.includes("Game cannot be started") ||
      error.message.includes("Not enough players") ||
      error.message.includes("Failed to initialize game territories")
    ) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
}