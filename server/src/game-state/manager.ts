// server/src/game-state/manager.ts
import type { 
  GameState, 
  SerializableGameState, 
  PlayerId, 
  CellId, 
  EntityId, 
  Entity, 
  EntityType,
  MapSize 
} from './types';

export class GameStateManager {
  
  // === INITIALIZATION ===
  
  static createInitialState(
    gameId: string,
    joinCode: string,
    players: PlayerId[],
    mapSize: MapSize,
    cellCount: number,
    biomes: Uint8Array
  ): GameState {
    return {
      gameId,
      joinCode,
      status: "waiting",
      createdAt: new Date().toISOString(),
      
      players,
      currentPlayer: players[0], // First player starts
      turnNumber: 1,
      
      // Initialize empty ownership maps
      cellOwnership: new Map(),
      playerCells: new Map(players.map(p => [p, new Set()])),
      
      // Initialize empty entity tracking
      entities: new Map(),
      cellEntities: new Map(),
      playerEntities: new Map(players.map(p => [p, new Set()])),
      entitiesByType: new Map(),
      nextEntityId: 1,

      // Map information
      mapSize,
      biomes
    };
  }

  // === SERIALIZATION ===

  static serialize(gameState: GameState): SerializableGameState {
    return {
      gameId: gameState.gameId,
      joinCode: gameState.joinCode,
      status: gameState.status,
      createdAt: gameState.createdAt,
      
      players: gameState.players,
      currentPlayer: gameState.currentPlayer,
      turnNumber: gameState.turnNumber,
      
      // Convert Map keys to strings for JSON compatibility
      cellOwnership: Object.fromEntries(
        Array.from(gameState.cellOwnership.entries()).map(([k, v]) => [k.toString(), v])
      ),
      playerCells: Object.fromEntries(
        Array.from(gameState.playerCells.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      entities: Object.fromEntries(
        Array.from(gameState.entities.entries()).map(([k, v]) => [k.toString(), v])
      ),
      cellEntities: Object.fromEntries(
        Array.from(gameState.cellEntities.entries()).map(([k, v]) => [k.toString(), Array.from(v)])
      ),
      playerEntities: Object.fromEntries(
        Array.from(gameState.playerEntities.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      entitiesByType: Object.fromEntries(
        Array.from(gameState.entitiesByType.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      nextEntityId: gameState.nextEntityId,

      mapSize: gameState.mapSize,
      biomes: gameState.biomes
    };
  }

  static deserialize(data: SerializableGameState): GameState {
    return {
      gameId: data.gameId,
      joinCode: data.joinCode,
      status: data.status,
      createdAt: data.createdAt,
      
      players: data.players,
      currentPlayer: data.currentPlayer,
      turnNumber: data.turnNumber,
      
      cellOwnership: new Map(Object.entries(data.cellOwnership).map(([k, v]) => [Number(k), v])),
      playerCells: new Map(
        Object.entries(data.playerCells).map(([k, v]) => [k, new Set(v)])
      ),
      entities: new Map(Object.entries(data.entities).map(([k, v]) => [Number(k), v])),
      cellEntities: new Map(
        Object.entries(data.cellEntities).map(([k, v]) => [Number(k), new Set(v)])
      ),
      playerEntities: new Map(
        Object.entries(data.playerEntities).map(([k, v]) => [k, new Set(v)])
      ),
      entitiesByType: new Map(
        Object.entries(data.entitiesByType).map(([k, v]) => [k as EntityType, new Set(v)])
      ),
      nextEntityId: data.nextEntityId,

      mapSize: data.mapSize,
      biomes: data.biomes
    };
  }

  // === CELL OWNERSHIP ===

  static claimCell(gameState: GameState, cellId: CellId, playerId: PlayerId): void {
    // Remove from previous owner if any
    const previousOwner = gameState.cellOwnership.get(cellId);
    if (previousOwner) {
      gameState.playerCells.get(previousOwner)?.delete(cellId);
    }

    // Assign to new owner
    gameState.cellOwnership.set(cellId, playerId);
    
    // Ensure player has a cell set
    if (!gameState.playerCells.has(playerId)) {
      gameState.playerCells.set(playerId, new Set());
    }
    gameState.playerCells.get(playerId)!.add(cellId);
  }

  static unclaimCell(gameState: GameState, cellId: CellId): void {
    const owner = gameState.cellOwnership.get(cellId);
    if (owner) {
      gameState.cellOwnership.delete(cellId);
      gameState.playerCells.get(owner)?.delete(cellId);
    }
  }

  static getCellOwner(gameState: GameState, cellId: CellId): PlayerId | null {
    return gameState.cellOwnership.get(cellId) || null;
  }

  static getPlayerCells(gameState: GameState, playerId: PlayerId): Set<CellId> {
    return gameState.playerCells.get(playerId) || new Set();
  }

  static getPlayerCellCount(gameState: GameState, playerId: PlayerId): number {
    return gameState.playerCells.get(playerId)?.size || 0;
  }

  // === ENTITY MANAGEMENT ===

  static addEntity(gameState: GameState, entity: Entity): void {
    const entityId = entity.id;
    
    // Store the entity
    gameState.entities.set(entityId, entity);
    
    // Track by cell location
    if (!gameState.cellEntities.has(entity.cellId)) {
      gameState.cellEntities.set(entity.cellId, new Set());
    }
    gameState.cellEntities.get(entity.cellId)!.add(entityId);
    
    // Track by owner
    if (entity.owner) {
      if (!gameState.playerEntities.has(entity.owner)) {
        gameState.playerEntities.set(entity.owner, new Set());
      }
      gameState.playerEntities.get(entity.owner)!.add(entityId);
    }
    
    // Track by type
    if (!gameState.entitiesByType.has(entity.type)) {
      gameState.entitiesByType.set(entity.type, new Set());
    }
    gameState.entitiesByType.get(entity.type)!.add(entityId);
  }

  static removeEntity(gameState: GameState, entityId: EntityId): boolean {
    const entity = gameState.entities.get(entityId);
    if (!entity) return false;

    // Remove from all tracking maps
    gameState.entities.delete(entityId);
    gameState.cellEntities.get(entity.cellId)?.delete(entityId);
    if (entity.owner) {
      gameState.playerEntities.get(entity.owner)?.delete(entityId);
    }
    gameState.entitiesByType.get(entity.type)?.delete(entityId);
    
    return true;
  }

  static moveEntity(gameState: GameState, entityId: EntityId, newCellId: CellId): boolean {
    const entity = gameState.entities.get(entityId);
    if (!entity) return false;

    // Remove from old cell
    gameState.cellEntities.get(entity.cellId)?.delete(entityId);
    
    // Add to new cell
    if (!gameState.cellEntities.has(newCellId)) {
      gameState.cellEntities.set(newCellId, new Set());
    }
    gameState.cellEntities.get(newCellId)!.add(entityId);
    
    // Update entity's cell reference
    entity.cellId = newCellId;
    
    return true;
  }

  static getNextEntityId(gameState: GameState): EntityId {
    return gameState.nextEntityId++;
  }

  // === ENTITY QUERIES ===

  static getEntitiesOnCell(gameState: GameState, cellId: CellId): Entity[] {
    const entityIds = gameState.cellEntities.get(cellId) || new Set();
    return Array.from(entityIds)
      .map(id => gameState.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getPlayerEntities(gameState: GameState, playerId: PlayerId): Entity[] {
    const entityIds = gameState.playerEntities.get(playerId) || new Set();
    return Array.from(entityIds)
      .map(id => gameState.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getEntitiesByType(gameState: GameState, type: EntityType): Entity[] {
    const entityIds = gameState.entitiesByType.get(type) || new Set();
    return Array.from(entityIds)
      .map(id => gameState.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  static getEntity(gameState: GameState, entityId: EntityId): Entity | null {
    return gameState.entities.get(entityId) || null;
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
    const players = gameState.players;
    
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
    for (const [playerId, cells] of gameState.playerCells) {
      stats.set(playerId, cells.size);
    }
    return stats;
  }

  static getEntityStats(gameState: GameState): Map<PlayerId, Map<EntityType, number>> {
    const stats = new Map<PlayerId, Map<EntityType, number>>();
    
    for (const [playerId, entityIds] of gameState.playerEntities) {
      const playerStats = new Map<EntityType, number>();
      
      for (const entityId of entityIds) {
        const entity = gameState.entities.get(entityId);
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

    if (gameState.players.includes(playerId)) {
      return false; // Player already exists
    }

    gameState.players.push(playerId);
    
    // Initialize empty collections for the new player
    gameState.playerCells.set(playerId, new Set());
    gameState.playerEntities.set(playerId, new Set());

    return true;
  }
}