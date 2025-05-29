import { MeshData } from "./main";

export type EntityId = number;
export type CellId = number;

export interface Entity {
  id: EntityId;
  type: string;
  cellId: CellId;
  // Add more properties as needed (health, resources, etc.)
  data?: Record<string, any>;
}

export interface GameState {
  // Core lookups - these are your primary data structures
  entities: Map<EntityId, Entity>;           // All entities by ID
  cellEntities: Map<CellId, Set<EntityId>>;  // Entities in each cell
  
  // Optional indexes for efficient queries
  entitiesByType: Map<string, Set<EntityId>>; // Entities by type
  
  // Counters
  nextEntityId: EntityId;
}

export class GameWorld {
  private gameState: GameState;
  private meshData: MeshData;

  constructor(meshData: MeshData) {
    this.meshData = meshData;
    this.gameState = {
      entities: new Map(),
      cellEntities: new Map(),
      entitiesByType: new Map(),
      nextEntityId: 1,
    };
  }

  // === ENTITY MANAGEMENT ===
  
  /**
   * Spawn a new entity on the specified cell
   */
  spawnEntity(cellId: CellId, type: string, data?: Record<string, any>): EntityId {
    if (!this.isValidCell(cellId)) {
      throw new Error(`Invalid cell ID: ${cellId}`);
    }

    const entityId = this.gameState.nextEntityId++;
    const entity: Entity = {
      id: entityId,
      type,
      cellId,
      data: data || {}
    };

    // Add to primary maps
    this.gameState.entities.set(entityId, entity);
    
    // Add to cell lookup
    if (!this.gameState.cellEntities.has(cellId)) {
      this.gameState.cellEntities.set(cellId, new Set());
    }
    this.gameState.cellEntities.get(cellId)!.add(entityId);

    // Add to type index
    if (!this.gameState.entitiesByType.has(type)) {
      this.gameState.entitiesByType.set(type, new Set());
    }
    this.gameState.entitiesByType.get(type)!.add(entityId);

    return entityId;
  }

  /**
   * Remove an entity from the game
   */
  removeEntity(entityId: EntityId): boolean {
    const entity = this.gameState.entities.get(entityId);
    if (!entity) return false;

    // Remove from all lookups
    this.gameState.entities.delete(entityId);
    this.gameState.cellEntities.get(entity.cellId)?.delete(entityId);
    this.gameState.entitiesByType.get(entity.type)?.delete(entityId);

    return true;
  }

  /**
   * Move an entity from one cell to another
   */
  moveEntity(entityId: EntityId, targetCellId: CellId): boolean {
    const entity = this.gameState.entities.get(entityId);
    if (!entity || !this.isValidCell(targetCellId)) {
      return false;
    }

    // Check if movement is valid (adjacent cells only)
    if (!this.areCellsAdjacent(entity.cellId, targetCellId)) {
      return false;
    }

    const oldCellId = entity.cellId;

    // Update entity
    entity.cellId = targetCellId;

    // Update cell lookups
    this.gameState.cellEntities.get(oldCellId)?.delete(entityId);
    if (!this.gameState.cellEntities.has(targetCellId)) {
      this.gameState.cellEntities.set(targetCellId, new Set());
    }
    this.gameState.cellEntities.get(targetCellId)!.add(entityId);

    return true;
  }

  // === QUERIES ===

  /**
   * Get all entities in a specific cell
   */
  getEntitiesInCell(cellId: CellId): Entity[] {
    const entityIds = this.gameState.cellEntities.get(cellId);
    if (!entityIds) return [];

    return Array.from(entityIds)
      .map(id => this.gameState.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  /**
   * Get all entities of a specific type
   */
  getEntitiesByType(type: string): Entity[] {
    const entityIds = this.gameState.entitiesByType.get(type);
    if (!entityIds) return [];

    return Array.from(entityIds)
      .map(id => this.gameState.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  /**
   * Get entities in neighboring cells (including the center cell)
   */
  getEntitiesInNeighborhood(cellId: CellId): Entity[] {
    const entities: Entity[] = [];
    const neighbors = this.getCellNeighbors(cellId);
    
    // Include the center cell
    entities.push(...this.getEntitiesInCell(cellId));
    
    // Include neighboring cells
    for (const neighborId of neighbors) {
      entities.push(...this.getEntitiesInCell(neighborId));
    }

    return entities;
  }

  /**
   * Get a specific entity by ID
   */
  getEntity(entityId: EntityId): Entity | undefined {
    return this.gameState.entities.get(entityId);
  }

  /**
   * Check if a cell has any entities
   */
  isCellOccupied(cellId: CellId): boolean {
    const entities = this.gameState.cellEntities.get(cellId);
    return entities ? entities.size > 0 : false;
  }

  /**
   * Find the nearest entity of a given type to a cell
   */
  findNearestEntityOfType(cellId: CellId, type: string): Entity | null {
    const entitiesOfType = this.getEntitiesByType(type);
    if (entitiesOfType.length === 0) return null;

    let nearest: Entity | null = null;
    let shortestDistance = Infinity;

    const cellCenter = this.getCellCenter(cellId);

    for (const entity of entitiesOfType) {
      const entityCenter = this.getCellCenter(entity.cellId);
      const distance = this.getDistance(cellCenter, entityCenter);
      
      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearest = entity;
      }
    }

    return nearest;
  }

  // === PATHFINDING SUPPORT ===

  /**
   * Get valid neighbor cells for pathfinding
   */
  getCellNeighbors(cellId: CellId): CellId[] {
    const neighbors: CellId[] = [];
    const start = this.meshData.cellOffsets[cellId];
    const end = this.meshData.cellOffsets[cellId + 1];

    for (let i = start; i < end; i++) {
      const neighborId = this.meshData.cellNeighbors[i];
      if (neighborId >= 0) {
        neighbors.push(neighborId);
      }
    }

    return neighbors;
  }

  /**
   * Check if two cells are adjacent
   */
  areCellsAdjacent(cellId1: CellId, cellId2: CellId): boolean {
    const neighbors = this.getCellNeighbors(cellId1);
    return neighbors.includes(cellId2);
  }

  // === UTILITY METHODS ===

  private isValidCell(cellId: CellId): boolean {
    return cellId >= 0 && cellId < this.meshData.cellOffsets.length - 1;
  }

  private getCellCenter(cellId: CellId): { x: number; y: number } {
    const index = cellId * 2;
    return {
      x: this.meshData.cellGeometricCenters[index],
      y: this.meshData.cellGeometricCenters[index + 1]
    };
  }

  private getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // === SERIALIZATION SUPPORT ===

  /**
   * Export game state for persistence
   */
  exportGameState(): any {
    return {
      entities: Array.from(this.gameState.entities.entries()),
      nextEntityId: this.gameState.nextEntityId,
    };
  }

  /**
   * Import game state from saved data
   */
  importGameState(savedState: any): void {
    this.gameState = {
      entities: new Map(),
      cellEntities: new Map(),
      entitiesByType: new Map(),
      nextEntityId: savedState.nextEntityId || 1,
    };

    // Reconstruct all the lookup tables
    for (const [entityId, entity] of savedState.entities) {
      this.gameState.entities.set(entityId, entity);

      // Rebuild cell lookup
      if (!this.gameState.cellEntities.has(entity.cellId)) {
        this.gameState.cellEntities.set(entity.cellId, new Set());
      }
      this.gameState.cellEntities.get(entity.cellId)!.add(entityId);

      // Rebuild type lookup
      if (!this.gameState.entitiesByType.has(entity.type)) {
        this.gameState.entitiesByType.set(entity.type, new Set());
      }
      this.gameState.entitiesByType.get(entity.type)!.add(entityId);
    }
  }

  // === DEBUGGING ===

  getStats(): any {
    return {
      totalEntities: this.gameState.entities.size,
      occupiedCells: this.gameState.cellEntities.size,
      entityTypes: Array.from(this.gameState.entitiesByType.keys()),
      entitiesByType: Object.fromEntries(
        Array.from(this.gameState.entitiesByType.entries()).map(
          ([type, entities]) => [type, entities.size]
        )
      ),
    };
  }
}

// === EXAMPLE USAGE ===

/*
// After generating your mesh:
const gameWorld = new GameWorld(meshData);

// Spawn some entities
const villageId = gameWorld.spawnEntity(42, 'village', { population: 100 });
const unitId = gameWorld.spawnEntity(43, 'unit', { health: 100, attack: 10 });

// Move a unit
gameWorld.moveEntity(unitId, 44);

// Query entities
const entitiesInCell = gameWorld.getEntitiesInCell(44);
const allVillages = gameWorld.getEntitiesByType('village');
const nearbyEntities = gameWorld.getEntitiesInNeighborhood(44);

// Find nearest village to a unit
const unit = gameWorld.getEntity(unitId);
if (unit) {
  const nearestVillage = gameWorld.findNearestEntityOfType(unit.cellId, 'village');
}

// Save/load game state
const savedGame = gameWorld.exportGameState();
// ... later ...
gameWorld.importGameState(savedGame);
*/