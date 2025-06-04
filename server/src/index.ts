// src/index.ts - Updated with WebSocket support
import { createGame, fallback, getGame, health, joinGame, mesh, root, startGame } from "./routes";
import { setupWebSocket } from "./websocket";

// TODO move constants to a config
export const PORT = process.env.PORT || 3000;
export const WS_PORT = process.env.WS_PORT || 3001;
export const ENDPOINTS = [
  "GET /api/mesh/small",
  "GET /api/mesh/medium",
  "GET /api/mesh/large",
  "GET /api/mesh/xl",
  "POST /api/games",
  "POST /api/games/:joinCode/join",
  "POST /api/games/:gameId/start",
  "GET /api/games/:gameId",
  `WebSocket :${WS_PORT}/socket.io/`,
  "GET /health",
];
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cell-Count, Content-Encoding, X-Map-Size",
};

/**
 * Server definition
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
      GET: async req => getGame(req)  // Single consolidated endpoint
    }
    
  },
  async fetch(req) {
    return fallback(req);
  },
});

// Set up WebSocket server on separate port
const io = setupWebSocket(Number(WS_PORT));

// Make io available to routes that need it
export { io };

console.log(`Server running`);
console.log('PORT environment variable:', process.env.PORT);
console.log('Server will listen on:', PORT);
console.log('WebSocket server will listen on:', WS_PORT);
console.log("\nAvailable endpoints:");
ENDPOINTS.forEach((e) => console.log(`    ${e}`));