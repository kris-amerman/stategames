// server/src/game-state/service.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { encode, decode } from '../serialization';
import { GameStateManager } from './manager';
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
import { SeededRandom } from '../utils/random';

// In-memory game store (replace with database later)
const games = new Map<string, Game>();

export class GameService {
  
  // === PERSISTENCE ===
  
  private static async ensureMapsDir(): Promise<void> {
    if (!existsSync('maps')) {
      await mkdir('maps', { recursive: true });
    }
  }

  static async saveGame(game: Game): Promise<void> {
    await this.ensureMapsDir();
    
    // JSON storage with TypedArray support
    const filePath = `maps/${game.meta.gameId}.game.json`;
    const jsonData = encode(game);
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

    // Store in memory
    games.set(gameId, game);

    // Persist to disk
    await this.saveGame(game);
    await this.saveGameMap(gameId, game.map);

    console.log(
      `Created game ${gameId} with join code ${joinCode} (${mapSize}, ${cellCount} cells, ${nationCount} nations)`
    );

    return game;
  }

  static async getGame(gameId: string): Promise<Game | null> {
    // Check in-memory first
    if (games.has(gameId)) {
      return games.get(gameId)!;
    }

    // Try to load from disk
    const game = await this.loadGame(gameId);
    if (game) {
      // Load the map separately
      const gameMap = await this.loadGameMap(gameId);
      if (gameMap) {
        game.map = gameMap;
      }
      
      // Cache in memory for future requests
      games.set(gameId, game);
      return game;
    }

    return null;
  }

  static async getGameState(gameId: string): Promise<GameState | null> {
    const game = await this.getGame(gameId);
    return game ? game.state : null;
  }

  static async getGameMeta(gameId: string): Promise<GameMeta | null> {
    const game = await this.getGame(gameId);
    return game ? game.meta : null;
  }

  static async getGameMap(gameId: string): Promise<GameMap | null> {
    const game = await this.getGame(gameId);
    return game ? game.map : null;
  }

  static async saveGameState(gameState: GameState, gameId: string): Promise<void> {
    const game = games.get(gameId);
    if (game) {
      game.state = gameState;
      await this.saveGame(game);
    }
  }

  static async findGameByJoinCode(joinCode: string): Promise<Game | null> {
    const upperJoinCode = joinCode.toUpperCase();

    // Search in-memory games first
    for (const game of games.values()) {
      if (game.meta.joinCode === upperJoinCode) {
        return game;
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
            // Cache in memory for future requests
            games.set(gameId, game);
            return game;
          }
        }
      }
    } catch (error) {
      console.error('Error searching filesystem for games:', error);
    }

    return null;
  }

  static async joinGame(joinCode: string): Promise<{ game: Game; playerName: string } | null> {
    const game = await this.findGameByJoinCode(joinCode);
    
    if (!game) {
      return null;
    }

    if (!GameStateManager.canPlayerJoin(game.state)) {
      throw new Error(`Game is no longer accepting players (status: ${game.state.status})`);
    }

    if (game.meta.players.length >= game.meta.nationCount) {
      throw new Error('Game is full');
    }

    // Generate new player name
    const playerNumber = game.meta.players.length + 1;
    const newPlayerName = `player${playerNumber}`;

    // Update meta with new player
    game.meta.players.push(newPlayerName);

    // Add player to game state if not pre-generated
    if (!game.state.playerCells[newPlayerName]) {
      const success = GameStateManager.addPlayer(game.state, newPlayerName);
      if (!success) {
        throw new Error('Failed to add player to game');
      }
    }

    // Persist updated state
    await this.saveGame(game);

    console.log(`Player ${newPlayerName} joined game ${game.meta.gameId} (${game.meta.players.length} total players)`);

    return { game, playerName: newPlayerName };
  }

  static async startGame(gameId: string): Promise<Game | null> {
    const game = await this.getGame(gameId);
    
    if (!game) {
      return null;
    }

    if (game.state.status !== "waiting") {
      throw new Error(`Game cannot be started (current status: ${game.state.status})`);
    }

    if (game.meta.players.length < game.meta.nationCount) {
      throw new Error(`Not enough players to start game (${game.meta.players.length}/${game.meta.nationCount} joined)`);
    }

    // Update game state to started
    GameStateManager.startGame(game.state, game.meta.players);

    // Persist updated state
    await this.saveGame(game);

    console.log(`Game ${gameId} started with ${game.meta.players.length} players`);

    return game;
  }

  static async leaveGame(gameId: string, playerId: PlayerId): Promise<Game | null> {
    const game = await this.getGame(gameId);
    if (!game) return null;

    const idx = game.meta.players.indexOf(playerId);
    if (idx === -1) throw new Error('Player not in game');

    // Remove from meta players
    game.meta.players.splice(idx, 1);

    // Clean up game state collections
    delete game.state.playerCells[playerId];
    delete game.state.playerEntities[playerId];

    // Remove ownership and entities
    for (const [cell, owner] of Object.entries(game.state.cellOwnership)) {
      if (owner === playerId) {
        delete game.state.cellOwnership[cell as any];
        delete game.state.cellEntities[cell as any];
      }
    }
    for (const [id, ent] of Object.entries(game.state.entities)) {
      if (ent.owner === playerId) {
        delete game.state.entities[id as any];
      }
    }

    if (game.state.currentPlayer === playerId) {
      game.state.currentPlayer = game.meta.players[0] ?? null;
    }

    await this.saveGame(game);
    return game;
  }

  static async endGame(gameId: string): Promise<Game | null> {
    const game = await this.getGame(gameId);
    if (!game) return null;
    GameStateManager.finishGame(game.state);
    await this.saveGame(game);
    return game;
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
    return Array.from(games.values());
  }

  static getGameCount(): number {
    return games.size;
  }
}