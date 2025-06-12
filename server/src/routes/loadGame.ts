// Not being used for anything right now, but will be used (probably) when loading a game that you have already created/joined in the past
import { CORS_HEADERS } from "..";
import { GameService } from "../game-state";

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

    // Get game state
    const gameState = await GameService.getGameState(gameId);

    if (!gameState) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Create territory mapping
    const territoryData: { [cellId: string]: string } = {};
    for (const [playerId, cells] of gameState.playerCells.entries()) {
      for (const cellId of cells) {
        territoryData[cellId.toString()] = playerId;
      }
    }

    // Base response data
    const responseData: any = {
      gameId: gameState.gameId,
      joinCode: gameState.joinCode,
      status: gameState.status,
      createdAt: gameState.createdAt,
      startedAt: gameState.startedAt,
      mapSize: gameState.mapSize,
      cellCount: gameState.cellCount,
      players: gameState.players,
      currentPlayer: gameState.currentPlayer,
      turnNumber: gameState.turnNumber,
      territoryData,
    };

    if (gameState.status !== "in_progress") {
      return new Response(
        JSON.stringify({
          error: "Terrain data only available for games in progress",
          status: gameState.status,
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

    // Load terrain data
    const terrainData = await GameService.loadTerrainData(gameId);

    if (!terrainData) {
      return new Response(JSON.stringify({ error: "Terrain data not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Convert terrain data to base64 for JSON transmission
    const terrainBase64 = Buffer.from(terrainData).toString("base64");
    responseData.terrain = terrainBase64;

    return new Response(JSON.stringify(responseData), {
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
