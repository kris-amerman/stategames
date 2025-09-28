import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import type { TurnPlan } from '../types';
import { submitPlan } from './submitPlan';
import { advanceTurn } from './advanceTurn';
import { getTurnSummary } from './getTurnSummary';
import { leaveGame } from './leaveGame';
import { endGame } from './endGame';
import { getGameState } from './getGameState';
import { TurnManager } from '../turn';
import { totalLabor, EDUCATION_TIERS, HEALTHCARE_TIERS } from '../welfare/manager';
import { defaultNationInputs } from '../test-utils/nations';

async function setupGame() {
  const cellCount = 833;
  // Provide land biomes so world generation assigns territory
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  const nations = defaultNationInputs(2);
  await GameService.createGame(gameId, joinCode, 'small', cellCount, nations, biomes);
  await GameService.joinGame(joinCode);
  await GameService.startGame(gameId);
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

test('submitted planner payload persists and executes next turn', async () => {
  const { gameId } = await setupGame();
  const state = await GameService.getGameState(gameId);
  expect(state).not.toBeNull();
  if (!state) return;
  state.economy.resources.gold = 1000;
  await GameService.saveGameState(state, gameId);

  const plan: TurnPlan = {
    budgets: { military: 30, welfare: 0, sectorOM: {} },
    policies: { welfare: { education: 1, healthcare: 1 } },
    slotPriorities: { agriculture: 0 },
    allocationMode: 'pro-rata',
    sectorPriority: ['agriculture'],
  };

  const submitReq = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: 'player1', plan }),
  });
  const submitRes = await submitPlan(gameId, submitReq);
  expect(submitRes.status).toBe(200);

  const updated = await GameService.getGameState(gameId);
  expect(updated?.nextPlan?.allocationMode).toBe('pro-rata');
  expect(updated?.nextPlan?.sectorPriority).toEqual(['agriculture']);
  expect(updated?.nextPlan?.policies?.welfare?.education).toBe(1);

  // Execute turns directly with manager to check one-turn lag
  const execState = updated!;
  const goldBefore = execState.economy.resources.gold;
  TurnManager.advanceTurn(execState); // move plan into currentPlan
  const goldAfterFirst = execState.economy.resources.gold;
  TurnManager.advanceTurn(execState); // execute plan
  const goldAfterSecond = execState.economy.resources.gold;
  const labor = totalLabor(execState.economy);
  const welfareCost = labor * (EDUCATION_TIERS[1].cost + HEALTHCARE_TIERS[1].cost);
  const firstDelta = goldBefore - goldAfterFirst;
  const secondDelta = goldAfterFirst - goldAfterSecond;
  expect(secondDelta).toBeGreaterThan(firstDelta);
  expect(secondDelta).toBeGreaterThanOrEqual(30);
  expect(secondDelta).toBeGreaterThanOrEqual(welfareCost);
});
