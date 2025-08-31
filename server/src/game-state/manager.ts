// server/src/game-state/manager.ts
import type {
  GameState,
  GameMeta,
  GameMap,
  Game,
  PlayerId,
  CellId,
  EntityId,
  Entity,
  EntityType,
  MapSize
} from '../types';
import { EconomyManager } from '../economy';

export class GameStateManager {
  
  // === INITIALIZATION ===
  
  static createInitialGameMeta(
    gameId: string,
    joinCode: string,
    players: PlayerId[],
    mapSize: MapSize
  ): GameMeta {
    return {
      gameId,
      joinCode,
      createdAt: new Date().toISOString(),
      players,
      mapSize
    };
  }

  static createInitialGameState(players: PlayerId[]): GameState {
    return {
      status: "waiting",
      currentPlayer: players[0], // First player starts
      turnNumber: 1,
      phase: "planning",
      currentPlan: null,
      nextPlan: null,

      // Initialize empty ownership maps
      cellOwnership: {},
      playerCells: Object.fromEntries(players.map(p => [p, []])),
      
      // Initialize empty entity tracking
      entities: {},
      cellEntities: {},
      playerEntities: Object.fromEntries(players.map(p => [p, []])),
      entitiesByType: {
        unit: []
      },
      economy: EconomyManager.createInitialState(),
      nextEntityId: 1
    };
  }

  static createGameMap(biomes: Uint8Array): GameMap {
    return {
      biomes
    };
  }

  static createCompleteGame(
    gameId: string,
    joinCode: string,
    players: PlayerId[],
    mapSize: MapSize,
    biomes: Uint8Array
  ): Game {
    return {
      meta: this.createInitialGameMeta(gameId, joinCode, players, mapSize),
      map: this.createGameMap(biomes),
      state: this.createInitialGameState(players)
    };
  }

  // === CELL OWNERSHIP ===

  static claimCell(gameState: GameState, cellId: CellId, playerId: PlayerId): void {
    // Remove from previous owner if any
    const previousOwner = gameState.cellOwnership[cellId];
    if (previousOwner) {
      const playerCells = gameState.playerCells[previousOwner];
      const index = playerCells.indexOf(cellId);
      if (index > -1) {
        playerCells.splice(index, 1);
      }
    }

    // Assign to new owner
    gameState.cellOwnership[cellId] = playerId;
    
    // Ensure player has a cell array
    if (!gameState.playerCells[playerId]) {
      gameState.playerCells[playerId] = [];
    }
    if (!gameState.playerCells[playerId].includes(cellId)) {
      gameState.playerCells[playerId].push(cellId);
    }
  }

  static unclaimCell(gameState: GameState, cellId: CellId): void {
    const owner = gameState.cellOwnership[cellId];
    if (owner) {
      delete gameState.cellOwnership[cellId];
      const playerCells = gameState.playerCells[owner];
      const index = playerCells.indexOf(cellId);
      if (index > -1) {
        playerCells.splice(index, 1);
      }
    }
  }

  static getCellOwner(gameState: GameState, cellId: CellId): PlayerId | null {
    return gameState.cellOwnership[cellId] || null;
  }

  static getPlayerCells(gameState: GameState, playerId: PlayerId): CellId[] {
    return gameState.playerCells[playerId] || [];
  }

  static getPlayerCellCount(gameState: GameState, playerId: PlayerId): number {
    return gameState.playerCells[playerId]?.length || 0;
  }

  // === ENTITY MANAGEMENT ===

  static addEntity(gameState: GameState, entity: Entity): void {
    const entityId = entity.id;
    
    // Store the entity
    gameState.entities[entityId] = entity;
    
    // Track by cell location
    if (!gameState.cellEntities[entity.cellId]) {
      gameState.cellEntities[entity.cellId] = [];
    }
    if (!gameState.cellEntities[entity.cellId].includes(entityId)) {
      gameState.cellEntities[entity.cellId].push(entityId);
    }
    
    // Track by owner
    if (entity.owner) {
      if (!gameState.playerEntities[entity.owner]) {
        gameState.playerEntities[entity.owner] = [];
      }
      if (!gameState.playerEntities[entity.owner].includes(entityId)) {
        gameState.playerEntities[entity.owner].push(entityId);
      }
    }
    
    // Track by type
    if (!gameState.entitiesByType[entity.type].includes(entityId)) {
      gameState.entitiesByType[entity.type].push(entityId);
    }
  }

  static removeEntity(gameState: GameState, entityId: EntityId): boolean {
    const entity = gameState.entities[entityId];
    if (!entity) return false;

    // Remove from all tracking arrays
    delete gameState.entities[entityId];
    
    const cellEntities = gameState.cellEntities[entity.cellId];
    if (cellEntities) {
      const index = cellEntities.indexOf(entityId);
      if (index > -1) {
        cellEntities.splice(index, 1);
      }
    }
    
    if (entity.owner && gameState.playerEntities[entity.owner]) {
      const index = gameState.playerEntities[entity.owner].indexOf(entityId);
      if (index > -1) {
        gameState.playerEntities[entity.owner].splice(index, 1);
      }
    }
    
    const typeEntities = gameState.entitiesByType[entity.type];
    const typeIndex = typeEntities.indexOf(entityId);
    if (typeIndex > -1) {
      typeEntities.splice(typeIndex, 1);
    }
    
    return true;
  }

  static moveEntity(gameState: GameState, entityId: EntityId, newCellId: CellId): boolean {
    const entity = gameState.entities[entityId];
    if (!entity) return false;

    // Remove from old cell
    const oldCellEntities = gameState.cellEntities[entity.cellId];
    if (oldCellEntities) {
      const index = oldCellEntities.indexOf(entityId);
      if (index > -1) {
        oldCellEntities.splice(index, 1);
      }
    }
    
    // Add to new cell
    if (!gameState.cellEntities[newCellId]) {
      gameState.cellEntities[newCellId] = [];
    }
    if (!gameState.cellEntities[newCellId].includes(entityId)) {
      gameState.cellEntities[newCellId].push(entityId);
    }
    
    // Update entity's cell reference
    entity.cellId = newCellId;
    
    return true;
  }

  static getNextEntityId(gameState: GameState): EntityId {
    return gameState.nextEntityId++;
  }

  // === ENTITY QUERIES ===

  static getEntitiesOnCell(gameState: GameState, cellId: CellId): Entity[] {
    const entityIds = gameState.cellEntities[cellId] || [];
    return entityIds
      .map(id => gameState.entities[id])
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getPlayerEntities(gameState: GameState, playerId: PlayerId): Entity[] {
    const entityIds = gameState.playerEntities[playerId] || [];
    return entityIds
      .map(id => gameState.entities[id])
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getEntitiesByType(gameState: GameState, type: EntityType): Entity[] {
    const entityIds = gameState.entitiesByType[type] || [];
    return entityIds
      .map(id => gameState.entities[id])
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getEntity(gameState: GameState, entityId: EntityId): Entity | null {
    return gameState.entities[entityId] || null;
  }

  // === GAME STATE UPDATES ===

  static startGame(gameState: GameState): void {
    gameState.status = "in_progress";
  }

  // === STARTING TERRITORY ASSIGNMENT ===

  static assignStartingTerritories(
    gameState: GameState, 
    cellNeighbors: Int32Array, 
    cellOffsets: Uint32Array,
    cellCount: number,
    cellsPerPlayer: number
  ): void {
    const players = Object.keys(gameState.playerCells);
    
    console.log(`Assigning ${cellsPerPlayer} starting cells to ${players.length} players`);

    // Track which cells are already claimed
    const claimedCells = new Set<CellId>();
    
    for (const playerId of players) {
      const startingCells = this.findContiguousRegion(
        cellCount,
        cellNeighbors,
        cellOffsets,
        claimedCells,
        cellsPerPlayer
      );
      
      // Claim all cells for this player
      for (const cellId of startingCells) {
        this.claimCell(gameState, cellId, playerId);
        claimedCells.add(cellId);
      }
      
      console.log(`Player ${playerId} assigned ${startingCells.length} starting cells`);
    }
  }

  private static findContiguousRegion(
    totalCells: number,
    cellNeighbors: Int32Array,
    cellOffsets: Uint32Array,
    claimedCells: Set<CellId>,
    targetSize: number,
    maxAttempts: number = 100
  ): CellId[] {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Pick a random unclaimed starting cell
      let startCell: CellId;
      let attempts = 0;
      do {
        startCell = Math.floor(Math.random() * totalCells);
        attempts++;
        if (attempts > 1000) {
          throw new Error("Could not find unclaimed starting cell after 1000 attempts");
        }
      } while (claimedCells.has(startCell));

      // Try to grow a contiguous region from this cell
      const region = this.growContiguousRegion(
        startCell,
        cellNeighbors,
        cellOffsets,
        claimedCells,
        targetSize
      );

      // If we got close to our target size, use this region
      if (region.length >= Math.min(targetSize, targetSize * 0.8)) {
        return region.slice(0, targetSize); // Trim to exact size if we got more
      }
    }

    // Fallback: just find any available cells
    console.warn(`Could not find contiguous region of size ${targetSize}, falling back to scattered cells`);
    return this.findScatteredCells(totalCells, claimedCells, targetSize);
  }

  private static growContiguousRegion(
    startCell: CellId,
    cellNeighbors: Int32Array,
    cellOffsets: Uint32Array,
    claimedCells: Set<CellId>,
    targetSize: number
  ): CellId[] {
    const region = new Set<CellId>([startCell]);
    const frontier = new Set<CellId>([startCell]);

    while (region.size < targetSize && frontier.size > 0) {
      // Pick a random cell from the frontier
      const frontierArray = Array.from(frontier);
      const currentCell = frontierArray[Math.floor(Math.random() * frontierArray.length)];
      frontier.delete(currentCell);

      // Get neighbors of current cell
      const start = cellOffsets[currentCell];
      const end = cellOffsets[currentCell + 1];

      for (let i = start; i < end; i++) {
        const neighborId = cellNeighbors[i];
        
        // Skip invalid neighbors (boundary cells return -1)
        if (neighborId < 0) continue;
        
        // Skip already claimed or already in region
        if (claimedCells.has(neighborId) || region.has(neighborId)) continue;

        // Add to region and frontier
        region.add(neighborId);
        frontier.add(neighborId);

        // Stop if we've reached our target
        if (region.size >= targetSize) break;
      }
    }

    return Array.from(region);
  }

  private static findScatteredCells(
    totalCells: number,
    claimedCells: Set<CellId>,
    targetSize: number
  ): CellId[] {
    const availableCells: CellId[] = [];
    
    for (let cellId = 0; cellId < totalCells; cellId++) {
      if (!claimedCells.has(cellId)) {
        availableCells.push(cellId);
      }
    }

    // Shuffle and take the first targetSize cells
    for (let i = availableCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableCells[i], availableCells[j]] = [availableCells[j], availableCells[i]];
    }

    return availableCells.slice(0, Math.min(targetSize, availableCells.length));
  }

  static finishGame(gameState: GameState): void {
    gameState.status = "finished";
  }

  // === UTILITY METHODS ===

  static getCellStats(gameState: GameState): Map<PlayerId, number> {
    const stats = new Map<PlayerId, number>();
    for (const [playerId, cells] of Object.entries(gameState.playerCells)) {
      stats.set(playerId, cells.length);
    }
    return stats;
  }

  static getEntityStats(gameState: GameState): Map<PlayerId, Map<EntityType, number>> {
    const stats = new Map<PlayerId, Map<EntityType, number>>();
    
    for (const [playerId, entityIds] of Object.entries(gameState.playerEntities)) {
      const playerStats = new Map<EntityType, number>();
      
      for (const entityId of entityIds) {
        const entity = gameState.entities[entityId];
        if (entity) {
          const count = playerStats.get(entity.type) || 0;
          playerStats.set(entity.type, count + 1);
        }
      }
      
      stats.set(playerId, playerStats);
    }
    
    return stats;
  }

  static canPlayerJoin(gameState: GameState): boolean {
    return gameState.status === "waiting";
  }

  static addPlayer(gameState: GameState, playerId: PlayerId): boolean {
    if (!this.canPlayerJoin(gameState)) {
      return false;
    }

    if (gameState.playerCells[playerId]) {
      return false; // Player already exists
    }

    // Initialize empty collections for the new player
    gameState.playerCells[playerId] = [];
    gameState.playerEntities[playerId] = [];

    return true;
  }
}