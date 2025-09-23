import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import { setupWebSocketHandler } from '../websocket';
import { gameRooms, socketToGame } from '../index';

test('joining player receives full game data on websocket connect', async () => {
  // create a small world and join a second player
  const cellCount = 16;
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2, 8);
  const joinCode = 'J' + Math.random().toString(36).slice(2, 7).toUpperCase();
  await GameService.createGame(gameId, joinCode, 'small', cellCount, 2, biomes);
  const joinRes = await GameService.joinGame(joinCode);
  if (!joinRes) throw new Error('join failed');

  const events: any[] = [];
  const fakeWs = {
    remoteAddress: 'test-client',
    send: (message: string) => {
      events.push(JSON.parse(message));
    },
  } as any;

  setupWebSocketHandler(fakeWs, JSON.stringify({
    event: 'add_to_room',
    data: { gameId, playerName: joinRes.playerName, isCreator: false },
  }));

  await Bun.sleep(50);

  const fullGame = events.find(e => e.event === 'full_game');
  expect(fullGame).toBeDefined();
  expect(fullGame.data.game.meta.gameId).toBe(gameId);
  expect(fullGame.data.game.state.status).toBe('waiting');
  // ensure some territory was assigned in world generation
  expect(Object.keys(fullGame.data.game.state.cellOwnership).length).toBeGreaterThan(0);

  socketToGame.delete(fakeWs);
  gameRooms.delete(gameId);
});

