import { expect, test } from 'bun:test';
import { GameService } from '../game-state';
import { submitPlan } from '../routes/submitPlan';
import { advanceTurn } from '../routes/advanceTurn';
import type { TurnPlan } from '../types';
import { server } from '../index';

const PORT = process.env.PORT || 3000;

async function setupGame() {
  const cellCount = 833;
  // Fill biomes with land to ensure world generation assigns territory
  const biomes = new Uint8Array(cellCount).fill(1);
  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  await GameService.createGame(gameId, joinCode, 'small', cellCount, 'player1', biomes);
  const join = await GameService.joinGame(joinCode);
  const player2 = join?.playerName || 'player2';
  await GameService.startGame(gameId);
  return { gameId, joinCode, player2 };
}

test('websocket turn flow emits ordered events and survives reconnect', async () => {
  const { gameId, player2 } = await setupGame();

  const ws1 = new WebSocket(`ws://localhost:${PORT}/ws`);
  const events1: any[] = [];
  ws1.onmessage = (e) => events1.push(JSON.parse(e.data));
  await new Promise(res => ws1.onopen = res);
  ws1.send(JSON.stringify({ event:'add_to_room', data:{ gameId, playerName:'player1', isCreator:true } }));
  await Bun.sleep(50);

  const emptyPlan: TurnPlan = { budgets:{ military:0, welfare:0, sectorOM:{} }, policies:{}, slotPriorities:{}, tradeOrders:{}, projects:{} } as any;
  const planReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1', plan: emptyPlan }) });
  const planRes = await submitPlan(gameId, planReq);
  expect(planRes.status).toBe(200);
  await Bun.sleep(50);

  const state = await GameService.getGameState(gameId);
  if (!state) throw new Error('state missing');
  state.economy.infrastructure.ports['A'] = { owner:'national', status:'inactive', national:false, hp:100, toggle:{ target:'active', turns:1 } } as any;
  state.economy.cantons['C1'] = {
    sectors: { agriculture: { capacity: 5, funded: 0, idle: 0, utilization: 0 } },
    labor: { general: 0, skilled: 0, specialist: 0 },
    laborDemand: {},
    laborAssigned: {},
    lai: 0,
    happiness: 0,
    consumption: { foodRequired: 0, foodProvided: 0, luxuryRequired: 0, luxuryProvided: 0 },
    shortages: { food: false, luxury: false },
    urbanizationLevel: 1,
    development: 0,
    nextUrbanizationLevel: 2,
    geography: {},
    suitability: { agriculture: 0 },
    suitabilityMultipliers: {},
  } as any;
  state.economy.finance.creditLimit = 10;
  state.economy.finance.debt = 0;
  state.economy.finance.defaulted = false;
  state.economy.resources.gold = 20;
  state.currentPlan = { budgets:{ military:50, welfare:0, sectorOM:{ agriculture:5 } }, policies:{}, slotPriorities:{}, tradeOrders:{}, projects:{} } as any;
  await GameService.saveGameState(state, gameId);

  const advReq = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId:'player1' }) });
  const advRes = await advanceTurn(gameId, advReq);
  expect(advRes.status).toBe(200);
  await Bun.sleep(50);

  const post = await GameService.getGameState(gameId);
  if (post) {
    post.economy.resources.gold = 0;
    await GameService.saveGameState(post, gameId);
  }

  ws1.close();

  const planEvent = events1.find(e => e.event === 'plan_submitted');
  expect(planEvent.data.playerId).toBe('player1');
  const stateEvents = events1.filter(e => e.event === 'state_change');
  const types = stateEvents.map(e => e.data.type).sort();
  expect(types).toEqual(['energy_shortage','infrastructure_complete','resource_default','resource_shortage','ul_change'].sort());
  const turnEvent = events1.find(e => e.event === 'turn_complete');
  expect(turnEvent.data.turnNumber).toBe(2);
  const seqs = events1.filter(e => e.data?.seq !== undefined).map(e => e.data.seq);
  const sorted = [...seqs].sort((a,b)=>a-b);
  expect(seqs).toEqual(sorted);

  const ws2 = new WebSocket(`ws://localhost:${PORT}/ws`);
  const events2: any[] = [];
  ws2.onmessage = e => events2.push(JSON.parse(e.data));
  await new Promise(res => ws2.onopen = res);
  ws2.send(JSON.stringify({ event:'add_to_room', data:{ gameId, playerName:'player2', isCreator:false } }));
  await Bun.sleep(50);

  const planReq2 = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId: player2, plan: emptyPlan }) });
  const planRes2 = await submitPlan(gameId, planReq2);
  expect(planRes2.status).toBe(200);
  await Bun.sleep(100);
  const advReq2 = new Request('http://localhost', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId: player2 }) });
  const advRes2 = await advanceTurn(gameId, advReq2);
  expect(advRes2.status).toBe(200);
  await Bun.sleep(100);

  ws2.close();
  server.stop();

  const turnEvent2 = events2.find(e => e.event === 'turn_complete');
  expect(turnEvent2.data.turnNumber).toBe(3);
});
