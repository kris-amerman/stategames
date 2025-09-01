import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import { submitPlan } from './submitPlan';
import { advanceTurn } from './advanceTurn';
import type { TurnPlan } from '../types';

async function setupGame() {
  const cellCount = 833;
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  await GameService.createGame(gameId, joinCode, 'small', cellCount, 2, biomes);
  return { gameId };
}

test('endpoints validate input and enforce turn order', async () => {
  const { gameId } = await setupGame();
  const plan: TurnPlan = { budgets: { military: 0, welfare: 0, sectorOM: {} } } as any;

  // Missing playerId and plan
  let req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
  let res = await submitPlan(gameId, req);
  expect(res.status).toBe(400);

  // Not current player's turn
  req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player2', plan }) });
  res = await submitPlan(gameId, req);
  expect(res.status).toBe(403);

  // Valid plan by player1
  req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  res = await submitPlan(gameId, req);
  expect(res.status).toBe(200);

  // Wrong player advancing
  let advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player2' }) });
  let advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(403);

  // Missing playerId advancing
  advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
  advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(400);

  // Correct player advances turn
  advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1' }) });
  advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(200);

  // Now player1 is no longer active
  req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  res = await submitPlan(gameId, req);
  expect(res.status).toBe(403);
});

