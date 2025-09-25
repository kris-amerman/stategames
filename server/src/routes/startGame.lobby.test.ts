import { expect, test } from 'bun:test';
import { createGame } from './createGame';
import { startGame } from './startGame';
import { GameService } from '../game-state';
import { defaultNationInputs } from '../test-utils/nations';

// verify that game cannot start until required players have joined

test('startGame requires all nation slots filled', async () => {
  const biomes = new Uint8Array([1,1,1,7]);
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapSize: 'small',
      cellCount: 4,
      biomes: Array.from(biomes),
      nations: defaultNationInputs(2),
    }),
  });

  const res = await createGame(req);
  const data = await res.json();

  const gameId = data.gameId;
  const joinCode = data.joinCode;

  const preState = await GameService.getGameState(gameId);
  expect(preState?.currentPlayer).toBeNull();
  expect(preState?.turnNumber).toBe(0);
  const startRes1 = await startGame(gameId);
  expect(startRes1.status).toBe(400);

  await GameService.joinGame(joinCode);
  const startRes2 = await startGame(gameId);
  expect(startRes2.status).toBe(200);

  const state = await GameService.getGameState(gameId);
  expect(state?.status).toBe('in_progress');
  expect(state?.currentPlayer).toBe('player1');
  expect(state?.turnNumber).toBe(1);
});
