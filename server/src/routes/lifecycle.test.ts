import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import type { TurnPlan } from '../types';
import { submitPlan } from './submitPlan';
import { advanceTurn } from './advanceTurn';
import { getTurnSummary } from './getTurnSummary';
import { leaveGame } from './leaveGame';
import { endGame } from './endGame';
import { getGameState } from './getGameState';

async function setupGame() {
  const cellCount = 833;
  // Provide land biomes so world generation assigns territory
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  await GameService.createGame(gameId, joinCode, 'small', cellCount, 2, biomes);
  return { gameId, joinCode };
}

test('plan submission gating and turn advancement', async () => {
  const { gameId } = await setupGame();
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } };
  const req1 = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  const res1 = await submitPlan(gameId, req1);
  expect(res1.status).toBe(200);
  const req2 = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  const res2 = await submitPlan(gameId, req2);
  expect(res2.status).toBe(409);
  const advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1' }) });
  const advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(200);
  const stateRes = await getGameState(gameId);
  const state = await stateRes.json();
  expect(state.turnNumber).toBe(2);
  expect(state.currentPlayer).toBe('player2');
  const summaryRes = await getTurnSummary(gameId);
  const summary = await summaryRes.json();
  expect(Array.isArray(summary.log)).toBe(true);
  const leaveReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player2' }) });
  const leaveRes = await leaveGame(gameId, leaveReq);
  expect(leaveRes.status).toBe(200);
  const endRes = await endGame(gameId);
  expect(endRes.status).toBe(200);
  const finalState = await GameService.getGameState(gameId);
  expect(finalState?.status).toBe('finished');
});
