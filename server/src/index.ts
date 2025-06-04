// src/index.ts - Bun server with native WebSocket support
import { createGame, fallback, getGame, health, joinGame, mesh, root, startGame } from "./routes";
import { setupWebSocketHandler } from "./websocket";
import type { ServerWebSocket } from "bun";

// TODO move constants to a config
export const PORT = process.env.PORT || 3000;
export const ENDPOINTS = [
  "GET /api/mesh/small",
  "GET /api/mesh/medium",
  "GET /api/mesh/large",
  "GET /api/mesh/xl",
  "POST /api/games",
  "POST /api/games/:joinCode/join",
  "POST /api/games/:gameId/start",
  "GET /api/games/:gameId",
  `WebSocket :${PORT}/ws`,
  "GET /health",
];
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cell-Count, Content-Encoding, X-Map-Size",
};

// WebSocket state management
export const gameRooms = new Map<string, Set<ServerWebSocket<any>>>();
export const socketToGame = new Map<ServerWebSocket<any>, { gameId: string, playerName: string }>();

/**
 * Server definition with integrated WebSocket support
 */
const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  
  routes: {
    "/": () => root(),
    "/health": () => health(),
    "/api/mesh/:sizeParam": req => mesh(req.params.sizeParam),
    
    "/api/games": {
      POST: async req => createGame(req)
    },

    "/api/games/:joinCode/join": {
      POST: async req => joinGame(req)
    },

    "/api/games/:gameId/start": {
      POST: async req => startGame(req)
    },

    "/api/games/:gameId": {
      GET: async req => getGame(req)
    }
  },

  // WebSocket upgrade handler
  websocket: {
    message: setupWebSocketHandler,
    open(ws) {
      console.log(`WebSocket client connected: ${ws.remoteAddress}`);
    },
    close(ws, code, message) {
      console.log(`WebSocket client disconnected: ${ws.remoteAddress}`);
      
      // Clean up tracking
      const socketInfo = socketToGame.get(ws);
      if (socketInfo) {
        const { gameId } = socketInfo;
        const room = gameRooms.get(gameId);
        if (room) {
          room.delete(ws);
          if (room.size === 0) {
            gameRooms.delete(gameId);
          }
        }
        socketToGame.delete(ws);
      }
    },
    drain(ws) {
      // Called when the socket is ready to receive more data
      console.log('WebSocket ready to receive more data');
    }
  },
  
  async fetch(req, server) {
    const url = new URL(req.url);
    
    // Handle WebSocket upgrade for /ws path
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) {
        return; // Successfully upgraded
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    
    return fallback(req);
  },
});

// Helper functions for WebSocket broadcasting
export function broadcastToRoom(gameId: string, event: string, data: any) {
  const room = gameRooms.get(gameId);
  if (room) {
    const message = JSON.stringify({ event, data });
    room.forEach(ws => {
      try {
        ws.send(message);
      } catch (error) {
        console.error('Failed to send message to WebSocket:', error);
      }
    });
  }
}

export function broadcastPlayerJoined(gameId: string, players: string[], newPlayer: string) {
  console.log(`Broadcasting player_joined for ${newPlayer} in game ${gameId}`);
  broadcastToRoom(gameId, 'player_joined', {
    gameId,
    players,
    newPlayer
  });
}

export function broadcastGameStateUpdate(gameId: string, status: string, players: string[]) {
  console.log(`Broadcasting game_state_update for game ${gameId}: ${status}`);
  broadcastToRoom(gameId, 'game_state_update', {
    gameId,
    status,
    players
  });
}

export function broadcastGameError(gameId: string, error: string) {
  console.log(`Broadcasting game_error for game ${gameId}: ${error}`);
  broadcastToRoom(gameId, 'game_error', {
    gameId,
    error
  });
}

export function broadcastGameStarted(gameId: string, gameData: any) {
  console.log(`Broadcasting game_started for game ${gameId}`);
  broadcastToRoom(gameId, 'game_started', gameData);
}

console.log(`Server running`);
console.log('PORT environment variable:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('HTTP and WebSocket server listening on:', PORT);
console.log("\nAvailable endpoints:");
ENDPOINTS.forEach((e) => console.log(`    ${e}`));