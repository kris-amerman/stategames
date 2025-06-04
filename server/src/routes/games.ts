// server/src/routes/games.ts - Updated with enhanced game state
import { CORS_HEADERS } from "..";
import { broadcastPlayerJoined } from "../websocket";
import { GameService } from "../game-state/service";
import type { MapSize } from "../game-state/types";
import pako from 'pako';

export async function createGame(req: Request) {
  try {
    // Get cell count and map size from headers
    const cellCount = parseInt(req.headers.get("x-cell-count") || "0");
    const mapSizeHeader = req.headers.get("x-map-size") as MapSize || "xl";

    // Validate inputs
    if (!cellCount || cellCount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid cell count" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    const validMapSizes: MapSize[] = ["small", "medium", "large", "xl"];
    if (!validMapSizes.includes(mapSizeHeader)) {
      return new Response(JSON.stringify({ 
        error: "Invalid map size",
        validSizes: validMapSizes,
        received: mapSizeHeader 
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Read and validate terrain data
    const arrayBuffer = await req.arrayBuffer();
    let biomes: Uint8Array;

    // Check if data is compressed
    const contentEncoding = req.headers.get("content-encoding");
    if (contentEncoding === "gzip") {
      const compressedData = new Uint8Array(arrayBuffer);
      biomes = pako.ungzip(compressedData);
    } else {
      biomes = new Uint8Array(arrayBuffer);
    }

    // Validate terrain data
    if (biomes.length !== cellCount) {
      return new Response(
        JSON.stringify({ 
          error: "Biome data length mismatch",
          expected: cellCount,
          received: biomes.length 
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

    // Generate game ID and join code
    const gameId = GameService.generateGameId();
    const joinCode = GameService.generateJoinCode();

    // Create game state using the enhanced system
    const gameState = await GameService.createGame(
      gameId,
      joinCode,
      mapSizeHeader,
      cellCount,
      "player1" // Creator is always player1
    );

    // Save terrain data
    await GameService.saveTerrainData(gameId, biomes);

    console.log(`Created game ${gameId} with join code ${joinCode} (${mapSizeHeader}, ${cellCount} cells)`);

    return new Response(
      JSON.stringify({
        gameId: gameState.gameId,
        joinCode: gameState.joinCode,
        status: "created",
        mapSize: gameState.mapSize,
        cellCount: gameState.cellCount,
        players: gameState.players,
        currentPlayer: gameState.currentPlayer,
        turnNumber: gameState.turnNumber,
      }),
      {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      }
    );
  } catch (error) {
    console.error("Game creation error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
}

export async function joinGame(req: Request) {
  try {
    // Extract join code from URL path
    const url = new URL(req.url);
    const joinCode = url.pathname.split('/')[3]; // /api/games/:joinCode/join
    
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

    console.log(`Player ${playerName} joined game ${gameState.gameId} (${gameState.players.length} total players)`);

    // Broadcast to other players in the game room
    const { io } = await import('../index');
    broadcastPlayerJoined(io, gameState.gameId, gameState.players, playerName);

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
    if (error.message.includes("no longer accepting players") || 
        error.message.includes("Failed to add player")) {
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

export async function startGame(req: Request) {
  try {
    // Extract game ID from URL path
    const url = new URL(req.url);
    const gameId = url.pathname.split('/')[3]; // /api/games/:gameId/start
    
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

    console.log(`Game ${gameId} started with ${gameState.players.length} players`);

    // Load terrain data for the WebSocket broadcast
    const terrainData = await GameService.loadTerrainData(gameId);
    
    if (!terrainData) {
      throw new Error('Terrain data not found');
    }

    // Broadcast to all players in the game room via WebSocket
    const { io } = await import('../index');
    
    // Create territory summary for broadcast
    const territoryStats = Array.from(gameState.playerCells.entries()).map(([playerId, cells]) => ({
      playerId,
      cellCount: cells.size,
    }));

    // Create detailed territory data for rendering
    const territoryDataMapping: { [cellId: string]: string } = {};
    for (const [playerId, cells] of gameState.playerCells.entries()) {
      for (const cellId of cells) {
        territoryDataMapping[cellId.toString()] = playerId;
      }
    }

    // Convert terrain data to base64 for JSON transmission
    const terrainBase64 = Buffer.from(terrainData).toString('base64');
    
    // Send complete game data in the WebSocket event
    io.to(gameId).emit('game_started', { 
      gameId: gameState.gameId,
      status: gameState.status,
      players: gameState.players,
      currentPlayer: gameState.currentPlayer,
      turnNumber: gameState.turnNumber,
      
      // Map information
      mapSize: gameState.mapSize,
      cellCount: gameState.cellCount,
      
      // Complete terrain data
      terrain: terrainBase64,
      
      // Territory information
      territoryData: territoryDataMapping,
      territoryStats,
      
      // Timestamps
      startedAt: gameState.startedAt,
    });

    return new Response(
      JSON.stringify({
        success: true,
        gameId: gameState.gameId,
        status: gameState.status,
        players: gameState.players,
        currentPlayer: gameState.currentPlayer,
        turnNumber: gameState.turnNumber,
        startedAt: gameState.startedAt,
        mapSize: gameState.mapSize,
        cellCount: gameState.cellCount,
        territoryStats, // Include territory stats in response
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
    if (error.message.includes("Game cannot be started") || 
        error.message.includes("Not enough players") ||
        error.message.includes("Failed to initialize game territories")) {
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

export async function getGame(req: Request) {
  try {
    // Extract game ID from URL path
    const url = new URL(req.url);
    const gameId = url.pathname.split('/')[3]; // /api/games/:gameId
    
    if (!gameId) {
      return new Response(JSON.stringify({ error: "Game ID required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Check if terrain data is requested
    const includeTerrain = url.searchParams.get('include') === 'terrain';

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

    // Create territory summary
    const territoryStats = Array.from(gameState.playerCells.entries()).map(([playerId, cells]) => ({
      playerId,
      cellCount: cells.size,
    }));

    // Create entity summary
    const entityStats = Array.from(gameState.playerEntities.entries()).map(([playerId, entityIds]) => ({
      playerId,
      entityCount: entityIds.size,
    }));

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
      territoryStats,
      entityStats,
    };

    // Include terrain data if requested and game is in progress
    if (includeTerrain) {
      if (gameState.status !== "in_progress") {
        return new Response(JSON.stringify({ 
          error: "Terrain data only available for games in progress",
          status: gameState.status 
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        });
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
      const terrainBase64 = Buffer.from(terrainData).toString('base64');
      responseData.terrain = terrainBase64;
    }

    return new Response(
      JSON.stringify(responseData),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      }
    );

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