import { expect, test } from 'bun:test';
import { createGame } from './createGame';

// Test that calling the createGame route generates a world with requested nation count

test('createGame route generates world and waits for players', async () => {
  const cellCount = 4;
  const biomes = new Uint8Array([1,1,1,7]);
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
  expect(data.players.length).toBe(1);
  expect(data.game.meta.nationCount).toBe(2);
  expect(data.game.state.status).toBe('waiting');
  // Deep ocean cell (index 3) should remain unclaimed
  expect(data.game.state.cellOwnership['3']).toBeUndefined();
  // Ensure some territory assigned
  expect(Object.keys(data.game.state.cellOwnership).length).toBeGreaterThan(0);
});
