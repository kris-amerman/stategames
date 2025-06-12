// server/src/index.ts
import { createGame, fallback, getMesh, joinGame, root, startGame, loadGame } from "./routes";
import { setupWebSocketHandler } from "./websocket";
import { ENDPOINTS, PORT } from "./constants";
import { encode } from '@msgpack/msgpack';
import type { ServerWebSocket } from "bun";
import type { GameState, Game, GameStateUpdate } from "./types";

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

    "/api/mesh/:sizeParam": {
      GET: async req => getMesh(req.params.sizeParam)
    },
    
    "/api/games/create": {
      POST: async req => createGame(req)
    },

    "/api/games/:joinCode/join": {
      POST: async req => joinGame(req.params.joinCode)
    },

    "/api/games/:gameId/start": {
      POST: async req => startGame(req.params.gameId)
    },

    "/api/games/:gameId/load": {
      GET: async req => loadGame(req.params.gameId)
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
export function broadcastToRoom(gameId: string, messageType: string, data: any) {
  const room = gameRooms.get(gameId);
  if (room) {
    const message = { type: messageType, data };
    const binaryMessage = encode(message);
    room.forEach(ws => {
      try {
        ws.send(binaryMessage);
      } catch (error) {
        console.error('Failed to send message to WebSocket:', error);
      }
    });
  }
}

export function broadcastPlayerJoined(gameId: string, players: string[], newPlayer: string) {
  console.log(`Broadcasting player_joined for ${newPlayer} in game ${gameId}`);
  broadcastToRoom(gameId, 'PLAYER_JOINED', {
    gameId,
    players,
    newPlayer
  });
}

export function broadcastGameStarted(gameId: string, game: Game) {
  console.log(`Broadcasting game_started for game ${gameId}`);
  broadcastToRoom(gameId, 'FULL_GAME', game);
}

export function broadcastGameStateUpdate(gameId: string, gameState: GameState, lastAction?: any) {
  console.log(`Broadcasting game state update for game ${gameId}`);
  
  const update: GameStateUpdate = {
    gameId,
    state: gameState,
    lastAction
  };
  
  broadcastToRoom(gameId, 'GAME_UPDATE', update);
}

console.log(`Server running`);
console.log('PORT environment variable:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('HTTP and WebSocket server listening on:', PORT);
console.log("\nAvailable endpoints:");
ENDPOINTS.forEach((e) => console.log(`    ${e}`));