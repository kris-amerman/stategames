import { CORS_HEADERS } from "..";
import { broadcastPlayerJoined } from "../websocket";
import pako from 'pako';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// In-memory game state store (replace with database later)
const gameStates = new Map<string, any>();

export async function createGame(req: Request) {
  try {
    // Get cell count from header
    const cellCount = parseInt(req.headers.get("x-cell-count") || "0");

    if (!cellCount || cellCount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid cell count" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Read the binary data
    const arrayBuffer = await req.arrayBuffer();
    let biomes: Uint8Array;

    // Check if data is compressed
    const contentEncoding = req.headers.get("content-encoding");
    if (contentEncoding === "gzip") {
      // Decompress the data
      const compressedData = new Uint8Array(arrayBuffer);
      biomes = pako.ungzip(compressedData);
    } else {
      // Use data as-is
      biomes = new Uint8Array(arrayBuffer);
    }

    // Validate data
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
    const gameId = generateGameId();
    const joinCode = generateJoinCode();

    // Ensure maps directory exists
    if (!existsSync('maps')) {
      await mkdir('maps', { recursive: true });
    }

    // Persist terrain data
    await writeFile(`maps/${gameId}.terrain`, biomes);

    // Initialize game state
    const gameState = {
      gameId,
      joinCode,
      status: "waiting",
      players: ["player1"],
      cellCount,
      createdAt: new Date().toISOString()
    };

    // Store game state in memory and persist
    gameStates.set(gameId, gameState);
    await writeFile(`maps/${gameId}.state.json`, JSON.stringify(gameState, null, 2));

    console.log(`Created game ${gameId} with join code ${joinCode} (${cellCount} cells)`);

    return new Response(
      JSON.stringify({
        gameId,
        joinCode,
        status: "created",
        cellCount,
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

    // Find game by join code
    let gameState = null;
    let gameId = null;
    
    // Search through in-memory games
    for (const [id, state] of gameStates.entries()) {
      if (state.joinCode === joinCode.toUpperCase()) {
        gameState = state;
        gameId = id;
        break;
      }
    }

    // If not in memory, try to load from file system
    if (!gameState) {
      console.log(`Game with join code ${joinCode} not found in memory`);
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Check if game is still waiting
    if (gameState.status !== "waiting") {
      return new Response(JSON.stringify({ 
        error: "Game is no longer accepting players",
        status: gameState.status 
      }), {
        status: 409, // Conflict
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Generate new player name
    const playerNumber = gameState.players.length + 1;
    const newPlayerName = `player${playerNumber}`;

    // Add player to game
    gameState.players.push(newPlayerName);
    gameState.updatedAt = new Date().toISOString();

    // Update in memory and persist
    gameStates.set(gameId!, gameState);
    await writeFile(`maps/${gameId}.state.json`, JSON.stringify(gameState, null, 2));

    console.log(`Player ${newPlayerName} joined game ${gameId} (${gameState.players.length} total players)`);

    // Broadcast to other players in the game room
    // Import io dynamically to avoid circular dependency (TODO -- what does this mean and why dynamic import?)
    const { io } = await import('../index');
    broadcastPlayerJoined(io, gameId!, gameState.players, newPlayerName);

    return new Response(
      JSON.stringify({
        success: true,
        gameId,
        playerName: newPlayerName,
        players: gameState.players,
        status: gameState.status,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      }
    );

  } catch (error) {
    console.error("Join game error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
}

function generateGameId() {
  return Math.random().toString(36).substring(2, 15);
}

function generateJoinCode() {
  // Generate a 6-character alphanumeric join code
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}