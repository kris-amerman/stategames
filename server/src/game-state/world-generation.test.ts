import { expect, test } from 'bun:test';
import { GameService } from './service';
import { GameStateManager } from './manager';
import { meshService } from '../mesh-service';
import { defaultNationInputs } from '../test-utils/nations';

test('world generation assigns contiguous balanced territories with infrastructure', async () => {
  const meshData = await meshService.getMeshData('small');
  const cellCount = meshData.cellCount;
  const biomes = new Uint8Array(cellCount).fill(1);
  // single deep ocean cell and a shallow water cell for coastal checks
  biomes[0] = 7; // deep ocean
  biomes[1] = 6; // shallow water

  const gameId = 'g' + Math.random().toString(36).slice(2,8);
  const joinCode = 'J' + Math.random().toString(36).slice(2,7).toUpperCase();
  const nations = defaultNationInputs(2);
  await GameService.createGame(gameId, joinCode, 'small', cellCount, nations, biomes, 'eta');

  const state = await GameService.getGameState(gameId);
  if (!state) throw new Error('state missing');

  // All claimable cells assigned; deep ocean unclaimed
  for (let c = 0; c < cellCount; c++) {
    if (biomes[c] === 7) {
      expect(GameStateManager.getCellOwner(state, c)).toBeNull();
    } else {
      expect(GameStateManager.getCellOwner(state, c)).not.toBeNull();
    }
  }

  // Balanced territory counts (within 10% tolerance)
  const players = Object.keys(state.playerCells);
  const counts = players.map(p => GameStateManager.getPlayerCellCount(state, p));
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  expect(max - min).toBeLessThanOrEqual(Math.ceil(cellCount * 0.2));

  // Contiguity per player
  const neighbors = meshData.cellNeighbors;
  const offsets = meshData.cellOffsets;
  const isContiguous = (cells: number[]) => {
    if (cells.length === 0) return true;
    const owned = new Set(cells);
    const visited = new Set<number>();
    const queue: number[] = [cells[0]];
    visited.add(cells[0]);
    while (queue.length) {
      const cell = queue.shift()!;
      const start = offsets[cell];
      const end = offsets[cell + 1];
      for (let i = start; i < end; i++) {
        const nb = neighbors[i];
        if (owned.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited.size === cells.length;
  };

  for (const p of players) {
    const cells = GameStateManager.getPlayerCells(state, p);
    expect(isContiguous(cells)).toBe(true);

    const capital = cells[0];
    const cantonId = String(capital);
    expect(state.economy.infrastructure.airports[cantonId]).toBeDefined();
    expect(state.economy.infrastructure.railHubs[cantonId]).toBeDefined();

    let coastal = false;
    const start = offsets[capital];
    const end = offsets[capital + 1];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      const biome = biomes[nb];
      if (biome === 6 || biome === 7) {
        coastal = true;
        break;
      }
    }
    const hasPort = !!state.economy.infrastructure.ports[cantonId];
    expect(hasPort).toBe(coastal);
  }
});

