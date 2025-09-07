import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import type { TurnPlan } from '../types';
import { submitPlan } from './submitPlan';
import { getPlan } from './getPlan';
import { advanceTurn } from './advanceTurn';
import { getGameState } from './getGameState';

async function setupGame() {
  const cellCount = 16;
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  await GameService.createGame(gameId, joinCode, 'small', cellCount, 2, biomes);
  await GameService.joinGame(joinCode);
  await GameService.startGame(gameId);
  const state = await GameService.getGameState(gameId);
  if (state) {
    state.economy.resources.gold = 100;
    await GameService.saveGameState(state, gameId);
  }
  return { gameId };
}

test('getPlan returns next-turn plan and plan executes next turn', async () => {
  const { gameId } = await setupGame();
  const plan: TurnPlan = { budgets: { military: 5, welfare: 0, sectorOM: {} } } as any;
  const req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  const res = await submitPlan(gameId, req);
  expect(res.status).toBe(200);

  const getRes = await getPlan(gameId);
  expect(getRes.status).toBe(200);
  const fetched = await getRes.json();
  expect(fetched.budgets.military).toBe(5);

  const beforeState = await (await getGameState(gameId)).json();
  expect(beforeState.currentPlan).toBeNull();
  expect(beforeState.nextPlan.budgets.military).toBe(5);

  const advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1' }) });
  await advanceTurn(gameId, advReq);

  const afterState = await (await getGameState(gameId)).json();
  expect(afterState.currentPlan.budgets.military).toBe(5);
});
