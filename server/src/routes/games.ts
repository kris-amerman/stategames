import { CORS_HEADERS } from "..";
import { broadcastPlayerJoined } from "../websocket";
import pako from 'pako';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

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
    
    // Search through in-memory games first
    for (const [id, state] of gameStates.entries()) {
      if (state.joinCode === joinCode.toUpperCase()) {
        gameState = state;
        gameId = id;
        break;
      }
    }

    // If not in memory, search through filesystem
    // TODO: Replace with proper RDBMS lookup when we migrate to database
    if (!gameState) {
      console.log(`Game with join code ${joinCode} not found in memory, searching filesystem...`);
      
      try {
        if (existsSync('maps')) {
          const files = readdirSync('maps').filter(f => f.endsWith('.state.json'));
          
          for (const file of files) {
            const filePath = join('maps', file);
            const fileContent = await readFile(filePath, 'utf-8');
            const savedGameState = JSON.parse(fileContent);
            
            if (savedGameState.joinCode === joinCode.toUpperCase()) {
              gameState = savedGameState;
              gameId = savedGameState.gameId;
              
              // Load back into memory for future requests
              gameStates.set(gameId, gameState);
              console.log(`✅ Loaded game ${gameId} from filesystem into memory`);
              break;
            }
          }
        }
      } catch (fsError) {
        console.error('Error searching filesystem for games:', fsError);
      }
    }

    if (!gameState) {
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
    // Dynamic import to avoid circular dependency - this happens because 
    // routes/games.ts imports from index.ts, and index.ts imports from routes/games.ts
    // TODO fix the import
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

    // Find game in memory
    const gameState = gameStates.get(gameId);
    
    if (!gameState) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Check if game is in waiting state
    if (gameState.status !== "waiting") {
      return new Response(JSON.stringify({ 
        error: "Game cannot be started",
        currentStatus: gameState.status 
      }), {
        status: 409, // Conflict
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Check if enough players (minimum 2)
    if (gameState.players.length < 2) {
      return new Response(JSON.stringify({ 
        error: "Not enough players to start game",
        currentPlayers: gameState.players.length,
        minimumRequired: 2
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    // Update game state to in_progress
    gameState.status = "in_progress";
    gameState.startedAt = new Date().toISOString();

    // Update in memory and persist
    gameStates.set(gameId, gameState);
    await writeFile(`maps/${gameId}.state.json`, JSON.stringify(gameState, null, 2));

    console.log(`Game ${gameId} started with ${gameState.players.length} players`);

    // Broadcast to all players in the game room via WebSocket
    const { io } = await import('../index');
    io.to(gameId).emit('game_started', { 
      gameId,
      status: 'in_progress',
      players: gameState.players 
    });

    return new Response(
      JSON.stringify({
        success: true,
        gameId,
        status: "in_progress",
        players: gameState.players,
        startedAt: gameState.startedAt
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
    console.error("Start game error:", error);
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