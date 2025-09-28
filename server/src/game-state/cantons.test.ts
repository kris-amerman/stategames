import { expect, test } from 'bun:test';
import { GameService } from './service';
import { meshService } from '../mesh-service';
import { defaultNationInputs } from '../test-utils/nations';
import { GameStateManager } from './manager';

function isContiguous(cells: number[], neighbors: Int32Array, offsets: Uint32Array): boolean {
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
      if (nb >= 0 && owned.has(nb) && !visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited.size === cells.length;
}

function hasCoastalCell(cells: number[], biomes: Uint8Array, neighbors: Int32Array, offsets: Uint32Array): boolean {
  for (const cell of cells) {
    const start = offsets[cell];
    const end = offsets[cell + 1];
    for (let i = start; i < end; i++) {
      const nb = neighbors[i];
      if (nb >= 0) {
        const biome = biomes[nb];
        if (biome === 6 || biome === 7) {
          return true;
        }
      }
    }
  }
  return false;
}

function areaBounds(total: number, count: number): { min: number; max: number } {
  const target = total / count;
  const min = Math.floor(target * 0.75);
  const max = Math.ceil(target * 1.25);
  return { min: Math.max(1, min), max: Math.max(1, max) };
}

function sumAreas(cells: number[][]): number {
  return cells.reduce((sum, group) => sum + group.length, 0);
}

test('initializeCantons partitions nations into balanced contiguous regions', async () => {
  const meshData = await meshService.getMeshData('small');
  const cellCount = meshData.cellCount;
  const biomes = new Uint8Array(cellCount).fill(1);
  biomes[0] = 7;
  biomes[1] = 6;

  const nations = defaultNationInputs(3);
  const gameId = `cantons-${Math.random().toString(36).slice(2, 8)}`;
  const joinCode = `J${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  await GameService.createGame(gameId, joinCode, 'small', cellCount, nations, biomes, 'canton-test');
  const state = await GameService.getGameState(gameId);
  if (!state) throw new Error('state missing');

  const neighbors = meshData.cellNeighbors;
  const offsets = meshData.cellOffsets;

  for (const playerId of Object.keys(state.playerCells)) {
    const playerCells = GameStateManager.getPlayerCells(state, playerId);
    const cantonIds = state.nationCantons[playerId] ?? [];
    expect(cantonIds.length).toBeGreaterThan(0);

    const cantonCellGroups = cantonIds.map((id) => state.cantonCells[id] ?? []);
    expect(sumAreas(cantonCellGroups)).toBe(playerCells.length);

    const { min, max } = areaBounds(playerCells.length, cantonIds.length);
    const coastalRequired = hasCoastalCell(playerCells, biomes, neighbors, offsets);
    let coastalCantons = 0;

    for (const [index, cantonId] of cantonIds.entries()) {
      const group = state.cantonCells[cantonId] ?? [];
      expect(group.length).toBeGreaterThanOrEqual(min - 1);
      expect(group.length).toBeLessThanOrEqual(max + 1);
      expect(isContiguous(group, neighbors, offsets)).toBe(true);

      const meta = state.cantonMeta[cantonId];
      expect(meta).toBeDefined();
      if (meta) {
        expect(meta.area).toBe(group.length);
        coastalCantons += meta.coastal ? 1 : 0;
      }

      for (const cell of group) {
        expect(state.cellCantons[cell]).toBe(cantonId);
      }

      if (index === 0) {
        expect(meta?.capital ?? false).toBe(true);
      }
    }

    if (coastalRequired) {
      expect(coastalCantons).toBeGreaterThan(0);
    }
  }
});
