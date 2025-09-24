import { expect, test } from 'bun:test';
import {
  GameStateManager,
  STARTING_RESOURCES_PER_NATION,
  STARTING_SECTOR_PROFILE,
  STARTING_URBANIZATION_LEVEL,
  STARTING_WELFARE_POLICIES,
  STARTING_ENERGY_PLANTS,
  STARTING_CREDIT_LIMIT_PER_NATION,
} from './manager';

function setupState(players: string[]) {
  const state = GameStateManager.createInitialGameState(players);
  players.forEach((player, index) => {
    const base = index * 3;
    state.playerCells[player] = [base, base + 1, base + 2];
  });
  const cellCount = players.length * 3;
  const biomes = new Uint8Array(cellCount + 1).fill(1);
  const cellOffsets = new Uint32Array(cellCount + 1);
  const cellNeighbors = new Int32Array();
  GameStateManager.initializeNationInfrastructure(
    state,
    players,
    biomes,
    cellNeighbors,
    cellOffsets,
  );
  return state;
}

test('initializeNationInfrastructure seeds balanced mid-progress nations', () => {
  const players = ['p1', 'p2', 'p3'];
  const state = setupState(players);
  const economy = state.economy;
  const multiplier = players.length;

  for (const [res, amount] of Object.entries(STARTING_RESOURCES_PER_NATION)) {
    expect(economy.resources[res as keyof typeof economy.resources]).toBe(
      amount * multiplier,
    );
  }

  expect(economy.welfare.current).toEqual(STARTING_WELFARE_POLICIES);
  expect(economy.welfare.next).toEqual(STARTING_WELFARE_POLICIES);
  expect(economy.finance.creditLimit).toBe(
    STARTING_CREDIT_LIMIT_PER_NATION * multiplier,
  );

  const plantsPerNation = STARTING_ENERGY_PLANTS.length;
  for (const player of players) {
    const cantonId = String(state.playerCells[player][0]);
    const canton = economy.cantons[cantonId];
    expect(canton).toBeDefined();
    expect(canton.urbanizationLevel).toBe(STARTING_URBANIZATION_LEVEL);
    for (const [sector, profile] of Object.entries(STARTING_SECTOR_PROFILE)) {
      const sectorState = canton.sectors[sector as keyof typeof STARTING_SECTOR_PROFILE];
      expect(sectorState?.capacity).toBe(profile.capacity);
      expect(canton.suitability[sector as keyof typeof STARTING_SECTOR_PROFILE]).toBe(
        profile.suitability,
      );
    }
    const assignedPlants = economy.energy.plants.filter(p => p.canton === cantonId);
    expect(assignedPlants.length).toBe(plantsPerNation);
  }
});
