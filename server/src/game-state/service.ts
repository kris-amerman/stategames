// server/src/game-state/service.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { encode, decode } from '@msgpack/msgpack';
import { GameStateManager } from './manager';
import type { Game, GameState, GameMeta, GameMap, MapSize } from '../types';

// In-memory game store (replace with database later)
const gameStates = new Map<string, Game>();

// Configuration flag for serialization format
const USE_BINARY_STORAGE = false; // Set to true to use MessagePack for GameMeta/GameState

export class GameService {
  
  // === PERSISTENCE ===
  
  private static async ensureMapsDir(): Promise<void> {
    if (!existsSync('maps')) {
      await mkdir('maps', { recursive: true });
    }
  }

  static async saveGame(game: Game): Promise<void> {
    await this.ensureMapsDir();
    
    if (USE_BINARY_STORAGE) {
      // MessagePack binary storage
      const filePath = `maps/${game.meta.gameId}.game.msgpack`;
      const binaryData = encode(game);
      await writeFile(filePath, binaryData);
    } else {
      // JSON storage for debugging
      const filePath = `maps/${game.meta.gameId}.game.json`;
      await writeFile(filePath, JSON.stringify(game, null, 2));
    }
  }

  static async saveGameMap(gameId: string, gameMap: GameMap): Promise<void> {
    await this.ensureMapsDir();
    
    // Always use MessagePack for GameMap due to large Uint8Array
    const filePath = `maps/${gameId}.map.msgpack`;
    const binaryData = encode(gameMap);
    await writeFile(filePath, binaryData);
  }

  static async loadGameMap(gameId: string): Promise<GameMap | null> {
    const filePath = `maps/${gameId}.map.msgpack`;
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const data = await readFile(filePath);
      return decode(data) as GameMap;
    } catch (error) {
      console.error(`Failed to load game map for ${gameId}:`, error);
      return null;
    }
  }

  private static async loadGame(gameId: string): Promise<Game | null> {
    if (USE_BINARY_STORAGE) {
      // MessagePack binary loading
      const filePath = `maps/${gameId}.game.msgpack`;
      
      if (!existsSync(filePath)) {
        return null;
      }

      try {
        const data = await readFile(filePath);
        return decode(data) as Game;
      } catch (error) {
        console.error(`Failed to load game for ${gameId}:`, error);
        return null;
      }
    } else {
      // JSON loading
      const filePath = `maps/${gameId}.game.json`;
      
      if (!existsSync(filePath)) {
        return null;
      }

      try {
        const fileContent = await readFile(filePath, 'utf-8');
        const game: Game = JSON.parse(fileContent);
        
        // Convert biomes back to Uint8Array if it was serialized as regular array
        if (Array.isArray(game.map.biomes)) {
          game.map.biomes = new Uint8Array(game.map.biomes);
        }
        
        return game;
      } catch (error) {
        console.error(`Failed to load game for ${gameId}:`, error);
        return null;
      }
    }
  }

  // === GAME MANAGEMENT ===

  static async createGame(
    gameId: string,
    joinCode: string,
    mapSize: MapSize,
    cellCount: number,
    creatorName: string,
    biomes: Uint8Array
  ): Promise<Game> {
    const game = GameStateManager.createCompleteGame(
      gameId,
      joinCode,
      [creatorName], // Start with just the creator
      mapSize,
      biomes
    );

    // Store in memory
    gameStates.set(gameId, game);
    
    // Persist to disk
    await this.saveGame(game);
    await this.saveGameMap(gameId, game.map);
    
    console.log(`Created game ${gameId} with join code ${joinCode} (${mapSize}, ${cellCount} cells)`);
    
    return game;
  }

  static async getGame(gameId: string): Promise<Game | null> {
    // Check in-memory first
    if (gameStates.has(gameId)) {
      return gameStates.get(gameId)!;
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
      gameStates.set(gameId, game);
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
    const game = gameStates.get(gameId);
    if (game) {
      game.state = gameState;
      await this.saveGame(game);
    }
  }

  static async findGameByJoinCode(joinCode: string): Promise<Game | null> {
    const upperJoinCode = joinCode.toUpperCase();

    // Search in-memory games first
    for (const game of gameStates.values()) {
      if (game.meta.joinCode === upperJoinCode) {
        return game;
      }
    }

    // Search filesystem if not found in memory
    try {
      if (existsSync('maps')) {
        const fileExtension = USE_BINARY_STORAGE ? '.game.msgpack' : '.game.json';
        const files = readdirSync('maps').filter(f => f.endsWith(fileExtension));
        
        for (const file of files) {
          const gameId = file.replace(fileExtension, '');
          const game = await this.loadGame(gameId);
          
          if (game && game.meta.joinCode === upperJoinCode) {
            // Cache in memory for future requests
            gameStates.set(gameId, game);
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

    // Generate new player name
    const playerNumber = game.meta.players.length + 1;
    const newPlayerName = `player${playerNumber}`;

    // Update meta with new player
    game.meta.players.push(newPlayerName);

    // Add player to game state
    const success = GameStateManager.addPlayer(game.state, newPlayerName);
    if (!success) {
      throw new Error('Failed to add player to game');
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

    if (game.meta.players.length < 2) {
      throw new Error(`Not enough players to start game (${game.meta.players.length}/2 minimum)`);
    }

    // Import mesh service to get the mesh data for territory assignment
    const { meshService } = await import('../mesh-service');
    
    try {
      // Get mesh data for this game's map size
      const meshData = await meshService.getMeshData(game.meta.mapSize);
      
      // Update game state to started
      GameStateManager.startGame(game.state);
      
      // Assign starting territories using the mesh data
      GameStateManager.assignStartingTerritories(
        game.state,
        meshData.cellNeighbors,
        meshData.cellOffsets,
        meshData.cellCount,
        15 // TODO: set cells per player in config or pass from client and figure out better divvy
      );
      
      // Persist updated state
      await this.saveGame(game);

      console.log(`Game ${gameId} started with ${game.meta.players.length} players, territories assigned`);

      return game;
      
    } catch (error) {
      console.error(`Failed to assign starting territories for game ${gameId}:`, error);
      throw new Error('Failed to initialize game territories');
    }
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
    return Array.from(gameStates.values());
  }

  static getGameCount(): number {
    return gameStates.size;
  }
}