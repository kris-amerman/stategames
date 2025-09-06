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
  const cellCount = 4;
  const biomes = new Uint8Array([1,1,1,7]);
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
  expect(data.players.length).toBe(1);
  expect(data.game.meta.nationCount).toBe(2);
  expect(data.game.state.cellOwnership['3']).toBeUndefined();
  expect(Object.keys(data.game.state.cellOwnership).length).toBeGreaterThan(0);
  expect(data.game.state.status).toBe('waiting');
  expect(data.game.state.currentPlayer).toBeNull();
  expect(data.game.state.turnNumber).toBe(0);

  // Capital cell for player1 should start with airport and rail hub
  const playerId = data.players[0];
  const capital = data.game.state.playerCells[playerId][0];
  const cantonId = String(capital);
  expect(data.game.state.economy.infrastructure.airports[cantonId]).toBeDefined();
  expect(data.game.state.economy.infrastructure.railHubs[cantonId]).toBeDefined();

  server.stop();
});
