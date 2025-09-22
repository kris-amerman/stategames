// server/src/index.ts
import { createGame, fallback, getMesh, joinGame, root, startGame, loadGame, getGameState, submitPlan, advanceTurn, getTurnSummary, leaveGame, endGame, getEconomy, getBudget, getLabor, getLogistics, getEnergy, getSuitability, getDevelopment, getInfrastructure, getFinance, getTrade, getWelfare } from "./routes";
import { setupWebSocketHandler } from "./websocket";
import { ENDPOINTS, PORT } from "./constants";
import { encode } from "./serialization";
import type { ServerWebSocket } from "bun";
import type { GameState, Game, GameStateUpdate } from "./types";

// WebSocket state management
export const gameRooms = new Map<string, Set<ServerWebSocket<any>>>();
export const socketToGame = new Map<ServerWebSocket<any>, { gameId: string, playerName: string }>();
// Track a monotonically increasing sequence number per game for ordering
export const gameSequences = new Map<string, number>();

/**
 * Server definition with integrated WebSocket support
 */
export const server = Bun.serve({
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
    },

    "/api/games/:gameId/state": {
      GET: async req => getGameState(req.params.gameId)
    },

    "/api/games/:gameId/economy": {
      GET: async req => getEconomy(req.params.gameId)
    },

    "/api/games/:gameId/budget": {
      GET: async req => getBudget(req.params.gameId)
    },

    "/api/games/:gameId/labor": {
      GET: async req => getLabor(req.params.gameId)
    },

    "/api/games/:gameId/logistics": {
      GET: async req => getLogistics(req.params.gameId)
    },

    "/api/games/:gameId/energy": {
      GET: async req => getEnergy(req.params.gameId)
    },

    "/api/games/:gameId/suitability": {
      GET: async req => getSuitability(req.params.gameId)
    },

    "/api/games/:gameId/development": {
      GET: async req => getDevelopment(req.params.gameId)
    },

    "/api/games/:gameId/infrastructure": {
      GET: async req => getInfrastructure(req.params.gameId)
    },

    "/api/games/:gameId/finance": {
      GET: async req => getFinance(req.params.gameId)
    },

    "/api/games/:gameId/trade": {
      GET: async req => getTrade(req.params.gameId)
    },

    "/api/games/:gameId/welfare": {
      GET: async req => getWelfare(req.params.gameId)
    },

    "/api/games/:gameId/plan": {
      POST: async req => submitPlan(req.params.gameId, req)
    },

    "/api/games/:gameId/advance": {
      POST: async req => advanceTurn(req.params.gameId, req)
    },

    "/api/games/:gameId/summary": {
      GET: async req => getTurnSummary(req.params.gameId)
    },

    "/api/games/:gameId/leave": {
      POST: async req => leaveGame(req.params.gameId, req)
    },

    "/api/games/:gameId/end": {
      POST: async req => endGame(req.params.gameId)
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
export function nextSeq(gameId: string): number {
  const n = (gameSequences.get(gameId) || 0) + 1;
  gameSequences.set(gameId, n);
  return n;
}

export function broadcastToRoom(gameId: string, messageType: string, data: any) {
  const room = gameRooms.get(gameId);
  if (room) {
    const message = { event: messageType, data };
    const messageString = encode(message);
    room.forEach(ws => {
      try {
        ws.send(messageString);
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
    newPlayer,
    seq: nextSeq(gameId)
  });
}

export function broadcastGameStarted(gameId: string, game: Game) {
  console.log(`Broadcasting game_started for game ${gameId}`);
  broadcastToRoom(gameId, 'full_game', { game, gameId, seq: nextSeq(gameId) });
}

export function broadcastGameStateUpdate(gameId: string, gameState: GameState, lastAction?: any) {
  console.log(`Broadcasting game state update for game ${gameId}`);

  const update: GameStateUpdate & { seq: number } = {
    gameId,
    state: gameState,
    lastAction,
    seq: nextSeq(gameId)
  };

  broadcastToRoom(gameId, 'game_update', update);
}

import type { StateChangeEvent } from './events';

export function broadcastStateChanges(gameId: string, events: StateChangeEvent[]) {
  for (const ev of events) {
    broadcastToRoom(gameId, 'state_change', { ...ev, gameId, seq: nextSeq(gameId) });
  }
}

export function broadcastPlanSubmitted(gameId: string, playerId: string) {
  broadcastToRoom(gameId, 'plan_submitted', { gameId, playerId, seq: nextSeq(gameId) });
}

export function broadcastTurnCompleted(
  gameId: string,
  gameState: GameState,
  nextPlayer: string,
  events: StateChangeEvent[]
) {
  broadcastToRoom(gameId, 'turn_complete', {
    gameId,
    turnNumber: gameState.turnNumber,
    nextPlayer,
    summary: gameState.turnSummary,
    events,
    seq: nextSeq(gameId)
  });
}

console.log(`Server running`);
console.log('PORT environment variable:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('HTTP and WebSocket server listening on:', PORT);
console.log("\nAvailable endpoints:");
ENDPOINTS.forEach((e) => console.log(`    ${e}`));
