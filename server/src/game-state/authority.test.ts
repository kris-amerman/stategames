import { expect, test } from 'bun:test';
import { GameService } from './service';
import { meshService } from '../mesh-service';
import { defaultNationInputs } from '../test-utils/nations';
import { auditGameIntegrity } from './authority';

function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test('authoritative snapshots remain coherent for consumer views', async () => {
  const meshData = await meshService.getMeshData('small');
  const cellCount = meshData.cellCount;
  const biomes = new Uint8Array(cellCount).fill(1);
  const nations = defaultNationInputs(3);
  const gameId = uniqueId('auth');
  const join = uniqueId('J').toUpperCase().slice(0, 6);

  await GameService.createGame(gameId, join, 'small', cellCount, nations, biomes, 'authority-coherence');

  const game = await GameService.getGame(gameId);
  expect(game).not.toBeNull();
  if (!game) throw new Error('game missing');

  const coherenceIssues = auditGameIntegrity(game);
  expect(coherenceIssues).toEqual([]);

  const state = await GameService.getGameState(gameId);
  const meta = await GameService.getGameMeta(gameId);
  expect(state).not.toBeNull();
  expect(meta).not.toBeNull();
  if (!state || !meta) return;

  expect(game.state).toEqual(state);
  expect(game.meta.joinCode).toBe(meta.joinCode);
  expect(game.meta.nationCount).toBe(meta.nationCount);
});

test('deterministic seeds produce identical authoritative states', async () => {
  const meshData = await meshService.getMeshData('small');
  const cellCount = meshData.cellCount;
  const biomes = new Uint8Array(cellCount).fill(1);
  const nations = defaultNationInputs(2);
  const seed = 'determinism-check';

  const idOne = uniqueId('det1');
  const idTwo = uniqueId('det2');
  const joinOne = uniqueId('J').toUpperCase().slice(0, 6);
  const joinTwo = uniqueId('J').toUpperCase().slice(0, 6);

  await GameService.createGame(idOne, joinOne, 'small', cellCount, nations, biomes, seed);
  await GameService.createGame(idTwo, joinTwo, 'small', cellCount, nations, biomes, seed);

  const stateOne = await GameService.getGameState(idOne);
  const stateTwo = await GameService.getGameState(idTwo);
  expect(stateOne).not.toBeNull();
  expect(stateTwo).not.toBeNull();
  if (!stateOne || !stateTwo) return;
  expect(stateOne).toEqual(stateTwo);

  const metaOne = await GameService.getGameMeta(idOne);
  const metaTwo = await GameService.getGameMeta(idTwo);
  expect(metaOne?.nationCount).toBe(metaTwo?.nationCount);
  expect(metaOne?.seed).toBe(metaTwo?.seed);
  expect(metaOne?.players.length).toBe(metaTwo?.players.length);
});
