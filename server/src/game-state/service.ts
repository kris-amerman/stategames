// server/src/game-state/service.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { GameStateManager } from './manager';
import type { GameState, SerializableGameState, MapSize } from './types';

// In-memory game state store (replace with database later)
const gameStates = new Map<string, GameState>();

export class GameService {
  
  // === PERSISTENCE ===
  
  private static async ensureMapsDir(): Promise<void> {
    if (!existsSync('maps')) {
      await mkdir('maps', { recursive: true });
    }
  }

  private static async saveGameState(gameState: GameState): Promise<void> {
    await this.ensureMapsDir();
    
    const serialized = GameStateManager.serialize(gameState);
    const filePath = `maps/${gameState.gameId}.state.json`;
    
    await writeFile(filePath, JSON.stringify(serialized, null, 2));
  }

  private static async loadGameState(gameId: string): Promise<GameState | null> {
    const filePath = `maps/${gameId}.state.json`;
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const fileContent = await readFile(filePath, 'utf-8');
      const serialized: SerializableGameState = JSON.parse(fileContent);
      return GameStateManager.deserialize(serialized);
    } catch (error) {
      console.error(`Failed to load game state for ${gameId}:`, error);
      return null;
    }
  }

  // === GAME MANAGEMENT ===

  static async createGame(
    gameId: string,
    joinCode: string,
    mapSize: MapSize,
    cellCount: number,
    creatorName: string = "player1"
  ): Promise<GameState> {
    const gameState = GameStateManager.createInitialState(
      gameId,
      joinCode,
      [creatorName], // Start with just the creator
      mapSize,
      cellCount
    );

    // Store in memory
    gameStates.set(gameId, gameState);
    
    // Persist to disk
    await this.saveGameState(gameState);
    
    console.log(`Created game ${gameId} with join code ${joinCode} (${mapSize}, ${cellCount} cells)`);
    
    return gameState;
  }

  static async getGameState(gameId: string): Promise<GameState | null> {
    // Check in-memory first
    if (gameStates.has(gameId)) {
      return gameStates.get(gameId)!;
    }

    // Try to load from disk
    const gameState = await this.loadGameState(gameId);
    if (gameState) {
      // Cache in memory for future requests
      gameStates.set(gameId, gameState);
      return gameState;
    }

    return null;
  }

  static async findGameByJoinCode(joinCode: string): Promise<GameState | null> {
    const upperJoinCode = joinCode.toUpperCase();

    // Search in-memory games first
    for (const gameState of gameStates.values()) {
      if (gameState.joinCode === upperJoinCode) {
        return gameState;
      }
    }

    // Search filesystem if not found in memory
    try {
      if (existsSync('maps')) {
        const files = readdirSync('maps').filter(f => f.endsWith('.state.json'));
        
        for (const file of files) {
          const gameId = file.replace('.state.json', '');
          const gameState = await this.loadGameState(gameId);
          
          if (gameState && gameState.joinCode === upperJoinCode) {
            // Cache in memory for future requests
            gameStates.set(gameId, gameState);
            return gameState;
          }
        }
      }
    } catch (error) {
      console.error('Error searching filesystem for games:', error);
    }

    return null;
  }

  static async joinGame(joinCode: string): Promise<{ gameState: GameState; playerName: string } | null> {
    const gameState = await this.findGameByJoinCode(joinCode);
    
    if (!gameState) {
      return null;
    }

    if (!GameStateManager.canPlayerJoin(gameState)) {
      throw new Error(`Game is no longer accepting players (status: ${gameState.status})`);
    }

    // Generate new player name
    const playerNumber = gameState.players.length + 1;
    const newPlayerName = `player${playerNumber}`;

    // Add player to game state
    const success = GameStateManager.addPlayer(gameState, newPlayerName);
    if (!success) {
      throw new Error('Failed to add player to game');
    }

    // Persist updated state
    await this.saveGameState(gameState);

    console.log(`Player ${newPlayerName} joined game ${gameState.gameId} (${gameState.players.length} total players)`);

    return { gameState, playerName: newPlayerName };
  }

  static async startGame(gameId: string): Promise<GameState | null> {
    const gameState = await this.getGameState(gameId);
    
    if (!gameState) {
      return null;
    }

    if (gameState.status !== "waiting") {
      throw new Error(`Game cannot be started (current status: ${gameState.status})`);
    }

    if (gameState.players.length < 2) {
      throw new Error(`Not enough players to start game (${gameState.players.length}/2 minimum)`);
    }

    // Import mesh service to get the mesh data for territory assignment
    const { meshService } = await import('../mesh-service');
    
    try {
      // Get mesh data for this game's map size
      const meshData = await meshService.getMeshData(gameState.mapSize);
      
      // Update game state to started
      GameStateManager.startGame(gameState);
      
      // Assign starting territories using the mesh data
      GameStateManager.assignStartingTerritories(
        gameState,
        meshData.cellNeighbors,
        meshData.cellOffsets,
        50 // 50 cells per player
      );
      
      // Persist updated state
      await this.saveGameState(gameState);

      console.log(`Game ${gameId} started with ${gameState.players.length} players, territories assigned`);

      return gameState;
      
    } catch (error) {
      console.error(`Failed to assign starting territories for game ${gameId}:`, error);
      throw new Error('Failed to initialize game territories');
    }
  }

  // === TERRAIN DATA ===

  static async saveTerrainData(gameId: string, biomes: Uint8Array): Promise<void> {
    await this.ensureMapsDir();
    await writeFile(`maps/${gameId}.terrain`, biomes);
  }

  static async loadTerrainData(gameId: string): Promise<Uint8Array | null> {
    const filePath = `maps/${gameId}.terrain`;
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const data = await readFile(filePath);
      return new Uint8Array(data);
    } catch (error) {
      console.error(`Failed to load terrain data for ${gameId}:`, error);
      return null;
    }
  }

  // === UTILITY ===

  static generateGameId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  static generateJoinCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  static getAllGameStates(): GameState[] {
    return Array.from(gameStates.values());
  }

  static getGameCount(): number {
    return gameStates.size;
  }
}