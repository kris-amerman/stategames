import { expect, test } from 'bun:test';
import { createGame } from './createGame';

// Test that calling the createGame route generates a world with requested nation count

test('createGame route generates world immediately', async () => {
  const cellCount = 100;
  const biomes = new Uint8Array(cellCount).fill(1);
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Cell-Count': cellCount.toString(),
      'X-Map-Size': 'small',
      'X-Nation-Count': '2'
    },
    body: biomes
  });

  const res = await createGame(req);
  expect(res.status).toBe(201);
  const data = await res.json();
  expect(data.players.length).toBe(2);
  // Ensure some territory assigned
  expect(Object.keys(data.game.state.cellOwnership).length).toBeGreaterThan(0);
});
