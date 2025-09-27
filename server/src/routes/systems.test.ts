import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import type { TurnPlan } from '../types';
import { submitPlan } from './submitPlan';
import { advanceTurn } from './advanceTurn';
import { getEconomy } from './getEconomy';
import { getBudget } from './getBudget';
import { getLabor } from './getLabor';
import { getLogistics } from './getLogistics';
import { getEnergy } from './getEnergy';
import { getSuitability } from './getSuitability';
import { getDevelopment } from './getDevelopment';
import { getInfrastructure } from './getInfrastructure';
import { getFinance } from './getFinance';
import { getTrade } from './getTrade';
import { getWelfare } from './getWelfare';
import { defaultNationInputs } from '../test-utils/nations';

async function setupGame() {
  const cellCount = 833;
  // Populate biomes with land so all cells are claimable
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  const nations = defaultNationInputs(2);
  await GameService.createGame(gameId, joinCode, 'small', cellCount, nations, biomes);
  await GameService.joinGame(joinCode);
  await GameService.startGame(gameId);
  return { gameId };
}

test('system retrieval endpoints return deterministic data', async () => {
  const { gameId } = await setupGame();

  // Economy
  const econRes = await getEconomy(gameId);
  expect(econRes.status).toBe(200);
  const econ = await econRes.json();
  expect(econ).toHaveProperty('resources');

  // Budget default
  let budgetRes = await getBudget(gameId);
  let budget = await budgetRes.json();
  expect(budget).toEqual({ military: 0, welfare: 0, sectorOM: {} });

  // Submit plan with budgets within available gold
  const gold: number = econ.resources.gold;
  const plan: TurnPlan = { budgets: { military: Math.min(1, gold), welfare: 0, sectorOM: {} } };
  const req = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan }) });
  const res = await submitPlan(gameId, req);
  expect(res.status).toBe(200);
  budgetRes = await getBudget(gameId);
  budget = await budgetRes.json();
  expect(budget.military).toBe(plan.budgets!.military);

  // Advance turn to generate system outputs
  const advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1' }) });
  const advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(200);

  const labor = await (await getLabor(gameId)).json();
  expect(labor).toHaveProperty('national');

  const logistics = await (await getLogistics(gameId)).json();
  expect(logistics).toHaveProperty('lp');

  const energy = await (await getEnergy(gameId)).json();
  expect(energy).toHaveProperty('state');

  const suitability = await (await getSuitability(gameId)).json();
  expect(suitability).toHaveProperty('cantons');

  const development = await (await getDevelopment(gameId)).json();
  expect(development).toHaveProperty('cantons');

  const infrastructure = await (await getInfrastructure(gameId)).json();
  expect(infrastructure).toHaveProperty('infrastructure');

  const finance = await (await getFinance(gameId)).json();
  expect(finance).toHaveProperty('debt');

  const trade = await (await getTrade(gameId)).json();
  expect(trade).toHaveProperty('pendingImports');

  const welfare = await (await getWelfare(gameId)).json();
  expect(welfare).toHaveProperty('current');
});
