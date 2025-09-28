// server/src/game-state/service.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { encode, decode } from '../serialization';
import { GameStateManager } from './manager';
import { authoritativeStore, type UpdateResult } from './authority';
import type {
  Game,
  GameState,
  GameMeta,
  GameMap,
  MapSize,
  PlayerId,
  NationCreationInput,
  NationMeta,
} from '../types';
import { InMediaResInitializer } from './inmediares';
import { initializeCantons } from './cantons';
import { SeededRandom } from '../utils/random';

export class GameService {

  // === PERSISTENCE ===

  private static async ensureMapsDir(): Promise<void> {
    if (!existsSync('maps')) {
      await mkdir('maps', { recursive: true });
    }
  }

  private static async saveGame(gameId: string): Promise<void> {
    await this.ensureMapsDir();

    const canonical = authoritativeStore.getMutableGame(gameId);
    if (!canonical) {
      throw new Error(`Cannot save missing game ${gameId}`);
    }

    const filePath = `maps/${canonical.meta.gameId}.game.json`;
    const jsonData = encode(canonical);
    await writeFile(filePath, jsonData, 'utf-8');
  }

  static async saveGameMap(gameId: string, gameMap: GameMap): Promise<void> {
    await this.ensureMapsDir();
    
    // JSON storage with TypedArray support
    const filePath = `maps/${gameId}.map.json`;
    const jsonData = encode(gameMap);
    await writeFile(filePath, jsonData, 'utf-8');
  }

  static async loadGameMap(gameId: string): Promise<GameMap | null> {
    const filePath = `maps/${gameId}.map.json`;
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const jsonData = await readFile(filePath, 'utf-8');
      return decode<GameMap>(jsonData);
    } catch (error) {
      console.error(`Failed to load game map for ${gameId}:`, error);
      return null;
    }
  }

  private static async loadGame(gameId: string): Promise<Game | null> {
    // JSON loading
    const filePath = `maps/${gameId}.game.json`;
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const jsonData = await readFile(filePath, 'utf-8');
      const game = decode<Game>(jsonData);
      authoritativeStore.register(game);
      return game;
    } catch (error) {
      console.error(`Failed to load game for ${gameId}:`, error);
      return null;
    }
  }

  // === GAME MANAGEMENT ===

  static async createGame(
    gameId: string,
    joinCode: string,
    mapSize: MapSize,
    cellCount: number,
    nationInputs: NationCreationInput[],
    biomes: Uint8Array,
    seed?: string | number,
  ): Promise<Game> {
    const nationCount = nationInputs.length;
    const players = Array.from({ length: nationCount }, (_, i) => `player${i + 1}`);
    const nationMetas: NationMeta[] = nationInputs.map((nation, index) => ({
      id: players[index],
      name: nation.name,
      preset: nation.preset,
    }));
    const normalizedSeed = seed !== undefined && seed !== null ? String(seed) : null;

    const game = GameStateManager.createCompleteGame(
      gameId,
      joinCode,
      players,
      mapSize,
      biomes,
      nationCount,
      nationMetas,
      normalizedSeed,
    );

    // Import mesh service to generate starting territories
    const { meshService } = await import('../mesh-service');
    const meshData = await meshService.getMeshData(mapSize);

    const territoryRandom = new SeededRandom(normalizedSeed);
    GameStateManager.assignStartingTerritories(
      game.state,
      meshData.cellNeighbors,
      meshData.cellOffsets,
      meshData.cellCount,
      biomes,
      7,
      () => territoryRandom.next(),
    );

    const presetMap = Object.fromEntries(
      players.map((playerId, index) => [playerId, nationInputs[index].preset]),
    );

    initializeCantons(
      game.state,
      presetMap,
      meshData.cellNeighbors,
      meshData.cellOffsets,
      meshData.cellTriangleCenters,
      biomes,
      normalizedSeed,
    );

    GameStateManager.initializeNationInfrastructure(
      game.state,
      players,
      biomes,
      meshData.cellNeighbors,
      meshData.cellOffsets
    );

    const metas = InMediaResInitializer.initialize(
      game,
      nationInputs,
      biomes,
      meshData.cellNeighbors,
      meshData.cellOffsets,
      normalizedSeed ?? undefined,
    );
    game.meta.nations = metas;
    game.meta.seed = normalizedSeed;

    // Only the creator is in the lobby initially
    game.meta.players = ['player1'];

    // Store as authoritative canonical state
    authoritativeStore.register(game);

    // Persist to disk
    await this.saveGame(gameId);
    await this.saveGameMap(gameId, game.map);

    console.log(
      `Created game ${gameId} with join code ${joinCode} (${mapSize}, ${cellCount} cells, ${nationCount} nations)`
    );

    const snapshot = authoritativeStore.getGame(gameId);
    if (!snapshot) {
      throw new Error('Failed to materialize authoritative game snapshot after creation');
    }
    return snapshot as Game;
  }

  static async getGame(gameId: string): Promise<Game | null> {
    const snapshot = authoritativeStore.getGame(gameId);
    if (snapshot) {
      return snapshot as Game;
    }

    // Try to load from disk and register
    const loaded = await this.loadGame(gameId);
    if (!loaded) {
      return null;
    }

    const map = await this.loadGameMap(gameId);
    if (map) {
      loaded.map = map;
    }

    // loadGame registers canonical; fetch snapshot for return
    const view = authoritativeStore.getGame(gameId);
    return view ? (view as Game) : null;
  }

  static async getGameState(gameId: string): Promise<GameState | null> {
    const state = authoritativeStore.getState(gameId);
    if (state) {
      return state as GameState;
    }
    await this.getGame(gameId);
    const refreshed = authoritativeStore.getState(gameId);
    return refreshed ? (refreshed as GameState) : null;
  }

  static async getGameMeta(gameId: string): Promise<GameMeta | null> {
    const meta = authoritativeStore.getMeta(gameId);
    if (meta) {
      return meta as GameMeta;
    }
    await this.getGame(gameId);
    const refreshed = authoritativeStore.getMeta(gameId);
    return refreshed ? (refreshed as GameMeta) : null;
  }

  static async getGameMap(gameId: string): Promise<GameMap | null> {
    const map = authoritativeStore.getMap(gameId);
    if (map) {
      return map as GameMap;
    }
    await this.getGame(gameId);
    const refreshed = authoritativeStore.getMap(gameId);
    return refreshed ? (refreshed as GameMap) : null;
  }

  static async updateGame<T>(
    gameId: string,
    mutator: (game: Game) => T | Promise<T>,
  ): Promise<UpdateResult<T>> {
    const result = await authoritativeStore.update(gameId, mutator);
    await this.saveGame(gameId);
    return result;
  }

  static async updateGameState<T>(
    gameId: string,
    mutator: (state: GameState, game: Game) => T | Promise<T>,
  ): Promise<UpdateResult<T>> {
    return this.updateGame(gameId, game => mutator(game.state, game));
  }

  static async findGameByJoinCode(joinCode: string): Promise<string | null> {
    const upperJoinCode = joinCode.toUpperCase();

    // Search authoritative in-memory games first
    for (const snapshot of authoritativeStore.listSnapshots()) {
      if (snapshot.meta.joinCode === upperJoinCode) {
        return snapshot.meta.gameId;
      }
    }

    // Search filesystem if not found in memory
    try {
      if (existsSync('maps')) {
        const fileExtension = '.game.json';
        const files = readdirSync('maps').filter(f => f.endsWith(fileExtension));

        for (const file of files) {
          const gameId = file.replace(fileExtension, '');
          const game = await this.loadGame(gameId);

          if (game && game.meta.joinCode === upperJoinCode) {
            return gameId;
          }
        }
      }
    } catch (error) {
      console.error('Error searching filesystem for games:', error);
    }

    return null;
  }

  static async joinGame(joinCode: string): Promise<{ game: Game; playerName: string } | null> {
    const gameId = await this.findGameByJoinCode(joinCode);

    if (!gameId) {
      return null;
    }

    const { game, result } = await this.updateGame(gameId, canonical => {
      if (!GameStateManager.canPlayerJoin(canonical.state)) {
        throw new Error(`Game is no longer accepting players (status: ${canonical.state.status})`);
      }

      if (canonical.meta.players.length >= canonical.meta.nationCount) {
        throw new Error('Game is full');
      }

      const playerNumber = canonical.meta.players.length + 1;
      const newPlayerName = `player${playerNumber}`;

      canonical.meta.players.push(newPlayerName);

      if (!canonical.state.playerCells[newPlayerName]) {
        const success = GameStateManager.addPlayer(canonical.state, newPlayerName);
        if (!success) {
          throw new Error('Failed to add player to game');
        }
      }

      return newPlayerName;
    });

    const newPlayerName = result;

    console.log(`Player ${newPlayerName} joined game ${game.meta.gameId} (${game.meta.players.length} total players)`);

    return { game: game as Game, playerName: newPlayerName };
  }

  static async startGame(gameId: string): Promise<Game | null> {
    const snapshot = await this.getGame(gameId);
    if (!snapshot) {
      return null;
    }

    const { game } = await this.updateGame(gameId, canonical => {
      if (canonical.state.status !== 'waiting') {
        throw new Error(`Game cannot be started (current status: ${canonical.state.status})`);
      }

      if (canonical.meta.players.length < canonical.meta.nationCount) {
        throw new Error(
          `Not enough players to start game (${canonical.meta.players.length}/${canonical.meta.nationCount} joined)`,
        );
      }

      GameStateManager.startGame(canonical.state, canonical.meta.players);
      return null;
    });

    console.log(`Game ${gameId} started with ${game.meta.players.length} players`);

    return game as Game;
  }

  static async leaveGame(gameId: string, playerId: PlayerId): Promise<Game | null> {
    const snapshot = await this.getGame(gameId);
    if (!snapshot) return null;

    const { game } = await this.updateGame(gameId, canonical => {
      const idx = canonical.meta.players.indexOf(playerId);
      if (idx === -1) throw new Error('Player not in game');

      canonical.meta.players.splice(idx, 1);

      delete canonical.state.playerCells[playerId];
      delete canonical.state.playerEntities[playerId];

      for (const [cell, owner] of Object.entries(canonical.state.cellOwnership)) {
        if (owner === playerId) {
          delete canonical.state.cellOwnership[cell as any];
          delete canonical.state.cellEntities[cell as any];
        }
      }
      for (const [id, ent] of Object.entries(canonical.state.entities)) {
        if (ent.owner === playerId) {
          delete canonical.state.entities[id as any];
        }
      }

      if (canonical.state.currentPlayer === playerId) {
        canonical.state.currentPlayer = canonical.meta.players[0] ?? null;
      }

      return null;
    });

    return game as Game;
  }

  static async endGame(gameId: string): Promise<Game | null> {
    const snapshot = await this.getGame(gameId);
    if (!snapshot) return null;
    const { game } = await this.updateGame(gameId, canonical => {
      GameStateManager.finishGame(canonical.state);
      return null;
    });
    return game as Game;
  }

  // === TERRAIN DATA (LEGACY METHODS - DEPRECATED) ===

  static async saveTerrainData(gameId: string, biomes: Uint8Array): Promise<void> {
    // This is now handled by saveGameMap
    const gameMap: GameMap = { biomes };
    await this.saveGameMap(gameId, gameMap);
  }

  static async loadTerrainData(gameId: string): Promise<Uint8Array | null> {
    const gameMap = await this.loadGameMap(gameId);
    return gameMap ? gameMap.biomes : null;
  }

  // === UTILITY ===

  static generateGameId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  static generateJoinCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  static getAllGames(): Game[] {
    return authoritativeStore.listSnapshots().map(snapshot => snapshot.game as Game);
  }

  static getGameCount(): number {
    return authoritativeStore.size;
  }
}