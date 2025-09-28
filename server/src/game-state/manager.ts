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
  MapSize,
  InfrastructureData,
  NationMeta,
  NationState,
} from '../types';
import { EconomyManager } from '../economy';

export class GameStateManager {
  
  // === INITIALIZATION ===
  
  static createInitialGameMeta(
    gameId: string,
    joinCode: string,
    players: PlayerId[],
    mapSize: MapSize,
    nationCount: number,
    nations: NationMeta[] = [],
    seed: string | null = null,
  ): GameMeta {
    return {
      gameId,
      joinCode,
      createdAt: new Date().toISOString(),
      players,
      nations,
      seed,
      mapSize,
      nationCount,
    };
  }

  static createInitialGameState(players: PlayerId[]): GameState {
    return {
      status: "waiting",
      currentPlayer: null,
      turnNumber: 0,
      phase: "planning",
      currentPlan: null,
      nextPlan: null,
      planSubmittedBy: null,
      turnSummary: null,

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
      nextEntityId: 1,
      nations: {} as Record<PlayerId, NationState>,
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
    biomes: Uint8Array,
    nationCount: number,
    nations: NationMeta[] = [],
    seed: string | null = null,
  ): Game {
    return {
      meta: this.createInitialGameMeta(
        gameId,
        joinCode,
        players,
        mapSize,
        nationCount,
        nations,
        seed,
      ),
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

  static startGame(gameState: GameState, players: PlayerId[]): void {
    gameState.status = "in_progress";
    gameState.currentPlayer = players[0] ?? null;
    gameState.turnNumber = 1;
  }

  // === STARTING TERRITORY ASSIGNMENT ===

  static assignStartingTerritories(
    gameState: GameState,
    cellNeighbors: Int32Array,
    cellOffsets: Uint32Array,
    cellCount: number,
    biomes: Uint8Array,
    deepOceanBiome: number = 7,
    randomFn: () => number = Math.random,
  ): void {
    const players = Object.keys(gameState.playerCells);

    // Gather all claimable cells (exclude deep ocean)
    const claimable = new Set<CellId>();
    for (let cell = 0; cell < cellCount; cell++) {
      if (biomes[cell] !== deepOceanBiome) claimable.add(cell);
    }

    if (claimable.size === 0) return; // nothing to claim

    // Randomize order for seed selection
    const claimableArray = Array.from(claimable);
    for (let i = claimableArray.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      [claimableArray[i], claimableArray[j]] = [claimableArray[j], claimableArray[i]];
    }

    // Owner map used for BFS propagation (null = unvisited)
    const owners: (PlayerId | null)[] = new Array(cellCount).fill(null);
    const queue: CellId[] = [];

    // Seed each player with an initial claimable cell if available
    players.forEach((playerId, idx) => {
      const seed = claimableArray.pop();
      if (seed === undefined) return; // not enough cells
      owners[seed] = playerId;
      queue.push(seed);
      claimable.delete(seed);
      this.claimCell(gameState, seed, playerId);
    });

    // Helper to choose player with fewest cells for additional seeds
    const leastCellsPlayer = (): PlayerId => {
      return players.reduce((min, p) =>
        this.getPlayerCellCount(gameState, p) < this.getPlayerCellCount(gameState, min)
          ? p
          : min,
      players[0]);
    };

    while (claimable.size > 0 || queue.length > 0) {
      // If queue empty but cells remain (disconnected region), seed it to the smallest player
      if (queue.length === 0 && claimable.size > 0) {
        const seed = claimable.values().next().value as CellId;
        const player = leastCellsPlayer();
        owners[seed] = player;
        this.claimCell(gameState, seed, player);
        claimable.delete(seed);
        queue.push(seed);
      }

      const cell = queue.shift();
      if (cell === undefined) continue;
      const owner = owners[cell]!;

      const start = cellOffsets[cell];
      const end = cellOffsets[cell + 1];
      for (let i = start; i < end; i++) {
        const neighbor = cellNeighbors[i];
        if (neighbor < 0) continue; // boundary
        if (owners[neighbor] !== null) continue; // already processed
        owners[neighbor] = owner;
        queue.push(neighbor);
        if (claimable.has(neighbor)) {
          this.claimCell(gameState, neighbor, owner);
          claimable.delete(neighbor);
        }
      }
    }
  }

  static initializeNationInfrastructure(
    gameState: GameState,
    players: PlayerId[],
    biomes: Uint8Array,
    cellNeighbors: Int32Array,
    cellOffsets: Uint32Array,
  ): void {
    const SHALLOW_OCEAN = 6;
    const DEEP_OCEAN = 7;

    for (const player of players) {
      const cells = this.getPlayerCells(gameState, player);
      if (cells.length === 0) continue;
      const capital = cells[0];
      const cantonId = String(capital);

      // Ensure a canton exists for this capital cell
      EconomyManager.addCanton(gameState.economy, cantonId);

      const base: InfrastructureData = {
        owner: 'national',
        status: 'active',
        national: true,
        hp: 100,
      };

      // National Airport and Rail Hub
      gameState.economy.infrastructure.airports[cantonId] = { ...base };
      gameState.economy.infrastructure.railHubs[cantonId] = { ...base };
      const national = gameState.economy.infrastructure.national as Record<string, string | undefined>;
      if (!national.airport) {
        national.airport = cantonId;
      }
      if (!national.rail) {
        national.rail = cantonId;
      }

      // Port placement handled during in-media-res setup to respect canton layout
    }
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