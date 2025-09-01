import { test, expect } from 'bun:test';
import { createGame, fallback } from '../server/src/routes';

// simple integration test verifying CORS preflight and world generation
const PORT = 3123;

function startTestServer() {
  return Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/api/games/create' && req.method === 'POST') {
        return createGame(req);
      }
      return fallback(req);
    },
  });
}

test('client and server integrate on game creation', async () => {
  const server = startTestServer();

  // Preflight request should advertise custom headers
  const preflight = await fetch(`http://localhost:${PORT}/api/games/create`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'X-Nation-Count, Content-Type, X-Cell-Count, X-Map-Size',
    },
  });
  expect(preflight.status).toBe(200);
  expect(preflight.headers.get('Access-Control-Allow-Headers') || '').toContain('X-Nation-Count');

  // Create game request with biome data
  const cellCount = 833;
  const biomes = new Uint8Array(cellCount).fill(1);
  const res = await fetch(`http://localhost:${PORT}/api/games/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Cell-Count': String(cellCount),
      'X-Map-Size': 'small',
      'X-Nation-Count': '2',
    },
    body: biomes,
  });
  expect(res.status).toBe(201);
  const body = await res.text();
  const data = JSON.parse(body);
  expect(data.players.length).toBe(2);
  expect(Object.keys(data.game.state.cellOwnership).length).toBeGreaterThan(0);

  server.stop();
});
