import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

if (runInVitest) {
  vi.mock('./terrain', () => ({
    loadOrGetMesh: vi.fn().mockResolvedValue(undefined),
    setCurrentCellBiomes: vi.fn(),
    setCurrentCellCount: vi.fn(),
    setCurrentMapSize: vi.fn(),
    meshData: { cellCount: 1, allVertices: new Float64Array(), cellOffsets: new Uint32Array([0, 0]), cellVertexIndices: new Uint32Array(), cellNeighbors: new Int32Array() },
    biomeConfig: { smoothColors: false },
    showError: vi.fn(),
  }));

  vi.mock('./drawCells', () => ({ drawCells: vi.fn() }));
  vi.mock('./notifications', () => ({ showGameNotification: vi.fn() }));
}

import * as game from './game';
import { processGameData } from './game';

(runInVitest ? describe : describe.skip)('lobby behaviour', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(game, 'renderGameState').mockImplementation(() => {});
  });

  it('does not show turn controls before game start', async () => {
    const gameData = {
      meta: { gameId: 'g1', mapSize: 'small', players: ['player1'], nationCount: 1 },
      state: { status: 'waiting', currentPlayer: 'player1', turnNumber: 1 },
      map: { biomes: new Uint8Array([0]) },
    };
    await processGameData(gameData);
    expect(document.getElementById('turnIndicator')).toBeNull();
    expect(game.isMyTurn).toBe(false);
  });
});
