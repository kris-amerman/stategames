import { broadcastGameStarted, CORS_HEADERS } from "..";
import { GameService, type GameState } from "../game-state";

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
    const gameState = await GameService.startGame(gameId);

    if (!gameState) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    console.log(
      `Game ${gameId} started with ${gameState.players.length} players`
    );

    // Load terrain data for the WebSocket broadcast
    const terrainData = await GameService.loadTerrainData(gameId);

    if (!terrainData) {
      throw new Error("Terrain data not found");
    }

    // Create detailed territory data for rendering
    const territoryDataMapping: { [cellId: string]: string } = {};
    for (const [playerId, cells] of gameState.playerCells.entries()) {
      for (const cellId of cells) {
        territoryDataMapping[cellId.toString()] = playerId;
      }
    }

    // Convert terrain data to base64 for JSON transmission
    const terrainBase64 = Buffer.from(terrainData).toString("base64");

    // Send complete game data via WebSocket
    const gameData = {
      gameId: gameState.gameId,
      status: gameState.status,
      players: gameState.players,
      currentPlayer: gameState.currentPlayer,
      turnNumber: gameState.turnNumber,

      // Map information
      mapSize: gameState.mapSize,

      // Complete terrain data
      terrain: terrainBase64,

      // Territory information
      territoryData: territoryDataMapping,

      // Entity information
      entities: Object.fromEntries(
        Array.from(gameState.entities.entries()).map(([entityId, entity]) => [
          entityId.toString(),
          {
            id: entity.id,
            type: entity.type,
            owner: entity.owner,
            cellId: entity.cellId,
            data: entity.data
          }
        ])
      ),
    };

    broadcastGameStarted(gameId, gameData);

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
