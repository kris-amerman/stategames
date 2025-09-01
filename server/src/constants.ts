// server/src/constants.ts
import type { MapSize } from './types';

export const MAP_SIZES: MapSize[] = ["small", "medium", "large", "xl"];

export const MAX_BIOME_ID = 14;

export const PORT = process.env.PORT || 3000;

export const ENDPOINTS = [
  "GET /",
  "GET /api/mesh/:sizeParam",
  "POST /api/games/create",
  "POST /api/games/:joinCode/join",
  "POST /api/games/:gameId/start",
  "GET /api/games/:gameId/load",
  "GET /api/games/:gameId/state",
  "GET /api/games/:gameId/economy",
  "GET /api/games/:gameId/budget",
  "GET /api/games/:gameId/labor",
  "GET /api/games/:gameId/logistics",
  "GET /api/games/:gameId/energy",
  "GET /api/games/:gameId/suitability",
  "GET /api/games/:gameId/development",
  "GET /api/games/:gameId/infrastructure",
  "GET /api/games/:gameId/finance",
  "GET /api/games/:gameId/trade",
  "GET /api/games/:gameId/welfare",
  "POST /api/games/:gameId/plan",
  "POST /api/games/:gameId/advance",
  "GET /api/games/:gameId/summary",
  "POST /api/games/:gameId/leave",
  "POST /api/games/:gameId/end",
  `WebSocket :${PORT}/ws`,
];

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cell-Count, Content-Encoding, X-Map-Size, X-Nation-Count",
};

export const MESH_CONFIG = {
  width: 960,
  height: 600,
  radiusOptions: {
    small: 20,
    medium: 15,
    large: 10,
    xl: 5,
  },
};

export const MESH_DATA_DIR = "meshes";
