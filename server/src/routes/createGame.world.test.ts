import { expect, test } from 'bun:test';
import { createGame } from './createGame';
import { MAX_NATIONS } from '../constants';
import { defaultNationInputs } from '../test-utils/nations';

// Test that calling the createGame route generates a world with requested nation count

test('createGame route generates world and waits for players', async () => {
  const cellCount = 4;
  const biomes = new Uint8Array([1,1,1,7]);
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapSize: 'small',
      cellCount,
      biomes: Array.from(biomes),
      nations: defaultNationInputs(2),
    }),
  });

  const res = await createGame(req);
  expect(res.status).toBe(201);
  const data = await res.json();
  expect(data.players.length).toBe(1);
  expect(data.game.meta.nationCount).toBe(2);
  expect(data.game.state.status).toBe('waiting');
  expect(data.game.state.currentPlayer).toBeNull();
  expect(data.game.state.turnNumber).toBe(0);
  // Deep ocean cell (index 3) should remain unclaimed
  expect(data.game.state.cellOwnership['3']).toBeUndefined();
  // Ensure some territory assigned
  expect(Object.keys(data.game.state.cellOwnership).length).toBeGreaterThan(0);
});

test('rejects nation counts above maximum', async () => {
  const cellCount = 1;
  const biomes = new Uint8Array([1]);
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapSize: 'small',
      cellCount,
      biomes: Array.from(biomes),
      nations: defaultNationInputs(MAX_NATIONS + 1),
    }),
  });

  const res = await createGame(req);
  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toBe('Invalid nation count');
  expect(data.max).toBe(MAX_NATIONS);
});

test('returns field level errors for invalid nation entries', async () => {
  const cellCount = 4;
  const biomes = new Uint8Array([1, 1, 1, 1]);
  const nations = [
    { name: ' ', preset: '' },
    { name: 'Duplicate', preset: 'Industrializing Exporter' },
    { name: 'duplicate', preset: 'Agrarian Surplus' },
  ];

  const req = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapSize: 'small',
      cellCount,
      biomes: Array.from(biomes),
      nations,
    }),
  });

  const res = await createGame(req);
  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toBe('Invalid nation configuration');
  expect(data.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ index: 0, field: 'name', message: 'Name is required' }),
      expect.objectContaining({ index: 0, field: 'preset', message: 'Preset must be selected' }),
      expect.objectContaining({ index: 2, field: 'name', message: 'Name must be unique' }),
      expect.objectContaining({ index: 1, field: 'name', message: 'Name must be unique' }),
    ]),
  );
});
