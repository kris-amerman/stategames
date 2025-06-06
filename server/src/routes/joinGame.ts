import { broadcastPlayerJoined, CORS_HEADERS } from "..";
import { GameService } from "../game-state";

export async function joinGame(joinCode: string) {
  try {
    if (!joinCode) {
      return new Response(JSON.stringify({ error: "Join code required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Try to join the game using the service
    const result = await GameService.joinGame(joinCode);

    if (!result) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    const { gameState, playerName } = result;

    console.log(
      `Player ${playerName} joined game ${gameState.gameId} (${gameState.players.length} total players)`
    );

    // Broadcast to other players in the game room
    broadcastPlayerJoined(gameState.gameId, gameState.players, playerName);

    return new Response(
      JSON.stringify({
        success: true,
        gameId: gameState.gameId,
        playerName,
        players: gameState.players,
        status: gameState.status,
        mapSize: gameState.mapSize,
        cellCount: gameState.cellCount,
        currentPlayer: gameState.currentPlayer,
        turnNumber: gameState.turnNumber,
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
    console.error("Join game error:", error);

    // Handle specific game service errors
    if (
      error.message.includes("no longer accepting players") ||
      error.message.includes("Failed to add player")
    ) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 409, // Conflict
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
