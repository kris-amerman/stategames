import { test, expect } from 'bun:test';
import { GameStateManager } from '../game-state/manager';
import { GameService } from '../game-state/service';
import { submitPlan } from './submitPlan';
import { getPlan } from './getPlan';
import { TurnManager } from '../turn/manager';

// Integration-style test verifying plan submission and one-turn lag

test('plan API stores plan and executes with one-turn lag', async () => {
  const gameId = 'plan-test';
  const joinCode = 'JOIN';
  const players = ['p1'];
  const biomes = new Uint8Array([1]);
  const game = GameStateManager.createCompleteGame(gameId, joinCode, players, 'small', biomes, 1);
  game.state.status = 'in_progress';
  game.state.currentPlayer = 'p1';
  game.state.economy.resources.gold = 100;
  await GameService.saveGame(game);
  await GameService.saveGameMap(gameId, game.map);

  const plan = { budgets: { military: 10, welfare: 0, sectorOM: {} }, policies: { welfare: { education: 1, healthcare: 1 } }, slotPriorities: {} } as any;
  const req = new Request('http://test', { method: 'POST', body: JSON.stringify({ playerId: 'p1', plan }), headers: { 'Content-Type': 'application/json' } });
  const res = await submitPlan(gameId, req);
  expect(res.status).toBe(200);

  const getRes = await getPlan(gameId);
  expect(getRes.status).toBe(200);
  const body = await getRes.json();
  expect(body.plan.budgets.military).toBe(10);

  const state = await GameService.getGameState(gameId);
  TurnManager.advanceTurn(state!); // first advance: plan not executed yet
  expect(state!.economy.resources.gold).toBe(100);
  // queue empty plan to avoid further deductions
  TurnManager.submitPlan(state!, { budgets: { military: 0, welfare: 0, sectorOM: {} } });
  TurnManager.advanceTurn(state!); // second advance: plan executes
  expect(state!.economy.resources.gold).toBe(90);
});
