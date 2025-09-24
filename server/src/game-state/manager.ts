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
  SectorType,
  TurnPlan,
} from '../types';
import { EconomyManager } from '../economy';
import { LaborManager } from '../labor/manager';

export class GameStateManager {

  // === INITIALIZATION ===

  private static clonePlan(plan: TurnPlan): TurnPlan {
    return JSON.parse(JSON.stringify(plan));
  }

  private static createBaselinePlan(): TurnPlan {
    return {
      budgets: {
        military: 90,
        welfare: 65,
        sectorOM: {
          agriculture: 24,
          extraction: 18,
          manufacturing: 28,
          defense: 16,
          luxury: 12,
          finance: 10,
          research: 14,
          logistics: 18,
          energy: 20,
        },
      },
      policies: {
        welfare: { education: 2, healthcare: 2, socialSupport: 1 },
      },
      slotPriorities: {},
      tradeOrders: {},
      projects: {},
      allocationMode: 'custom',
      sectorPriority: ['manufacturing', 'research'],
    };
  }

  static createInitialGameMeta(
    gameId: string,
    joinCode: string,
    players: PlayerId[],
    mapSize: MapSize,
    nationCount: number
  ): GameMeta {
    return {
      gameId,
      joinCode,
      createdAt: new Date().toISOString(),
      players,
       mapSize,
      nationCount
    };
  }

  static createInitialGameState(players: PlayerId[]): GameState {
    const playerCount = Math.max(1, players.length);
    const economy = EconomyManager.createInitialState();
    const baselinePlan = this.createBaselinePlan();

    economy.resources = {
      gold: 650 + playerCount * 180,
      fx: 220 + playerCount * 35,
      food: 200 + playerCount * 25,
      materials: 180 + playerCount * 30,
      production: 160 + playerCount * 30,
      ordnance: 70 + playerCount * 12,
      luxury: 60 + playerCount * 10,
      energy: 120 + playerCount * 20,
      uranium: 10 + playerCount * 2,
      coal: 130 + playerCount * 25,
      oil: 100 + playerCount * 20,
      rareEarths: 30 + playerCount * 5,
      research: 50 + playerCount * 8,
      logistics: 80 + playerCount * 12,
      labor: 0,
    };

    economy.trade.pendingImports = { food: 25, materials: 20 };
    economy.trade.pendingExports = { luxury: 8, production: 5 };

    economy.finance.debt = 180 + playerCount * 60;
    economy.finance.creditLimit = 1200 + playerCount * 200;
    economy.finance.debtStress = [
      economy.finance.debt >= 50,
      economy.finance.debt >= 100,
      economy.finance.debt >= 200,
    ];
    economy.finance.summary = {
      revenues: 260,
      expenditures: 230,
      netBorrowing: 20,
      interest: Math.round(economy.finance.debt * economy.finance.interestRate),
      defaulted: false,
    };

    economy.welfare.current = { education: 2, healthcare: 2, socialSupport: 1 };
    economy.welfare.next = { ...economy.welfare.current };

    economy.energy.state = { supply: 0, demand: 0, ratio: 1 };
    economy.energy.demandBySector = {};
    economy.energy.brownouts = [];
    economy.energy.fuelUsed = {};
    economy.energy.oAndMSpent = 0;
    economy.energy.essentialsFirst = true;

    const currentPlan = this.clonePlan(baselinePlan);
    const nextPlan = this.clonePlan(baselinePlan);

    return {
      status: "waiting",
      currentPlayer: null,
      turnNumber: 0,
      phase: "planning",
      currentPlan,
      nextPlan,
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
      economy,
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
    biomes: Uint8Array,
    nationCount: number
  ): Game {
    return {
      meta: this.createInitialGameMeta(gameId, joinCode, players, mapSize, nationCount),
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
    deepOceanBiome: number = 7
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
      const j = Math.floor(Math.random() * (i + 1));
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
    const economy = gameState.economy;
    const sectorList: SectorType[] = [
      'agriculture',
      'extraction',
      'manufacturing',
      'defense',
      'luxury',
      'finance',
      'research',
      'logistics',
      'energy',
    ];
    const baseSuitability: Record<SectorType, number> = {
      agriculture: 60,
      extraction: 52,
      manufacturing: 58,
      defense: 50,
      luxury: 48,
      finance: 55,
      research: 57,
      logistics: 53,
      energy: 51,
    };
    const energyWeights: Record<SectorType, number> = {
      agriculture: 1,
      extraction: 1.2,
      manufacturing: 1.6,
      defense: 1.5,
      luxury: 1.1,
      finance: 0.8,
      research: 1.3,
      logistics: 1,
      energy: 1.2,
    };

    const demandBySector: Partial<Record<SectorType, number>> = {};
    let energySupply = 0;
    let energyDemand = 0;

    economy.energy.plants = [];
    economy.energy.demandBySector = {};
    economy.infrastructure.airports = { ...economy.infrastructure.airports };
    economy.infrastructure.ports = { ...economy.infrastructure.ports };
    economy.infrastructure.railHubs = { ...economy.infrastructure.railHubs };

    let nationalAirport = economy.infrastructure.national.airport;
    let nationalRail = economy.infrastructure.national.rail;
    let nationalPort = economy.infrastructure.national.port;

    for (const player of players) {
      const rawCells = this.getPlayerCells(gameState, player);
      if (!rawCells || rawCells.length === 0) continue;
      const ownedCells = [...rawCells].sort((a, b) => a - b);

      ownedCells.forEach((cell, idx) => {
        const cantonId = String(cell);
        if (!economy.cantons[cantonId]) {
          EconomyManager.addCanton(economy, cantonId);
        }
        const canton = economy.cantons[cantonId];
        const ulCycle = [3, 4, 2];
        const urbanization = ulCycle[idx % ulCycle.length];
        canton.urbanizationLevel = urbanization;
        canton.nextUrbanizationLevel = urbanization;
        canton.development = Math.min(3, 1 + (idx % 3));
        canton.lai = Number((1 + urbanization * 0.05).toFixed(2));

        const coastal = this.isCoastalCell(
          cell,
          biomes,
          cellNeighbors,
          cellOffsets,
          SHALLOW_OCEAN,
          DEEP_OCEAN,
        );
        canton.geography = coastal
          ? { plains: 0.5, coast: 0.35, woods: 0.15 }
          : { plains: 0.55, hills: 0.25, woods: 0.2 };

        sectorList.forEach((sector, sectorIdx) => {
          const capacity = 4 + ((idx + sectorIdx) % 3);
          const idle = Math.max(1, Math.floor(capacity / 3));
          const funded = Math.max(1, capacity - idle);
          const utilization = Math.max(1, funded - 1);
          canton.sectors[sector] = {
            capacity,
            funded,
            idle,
            utilization,
          };

          const adjustment = ((idx + sectorIdx) % 3) * 2;
          canton.suitability[sector] = baseSuitability[sector] + adjustment;
          const multiplier = Number((1 + (urbanization - 2) * 0.05).toFixed(2));
          canton.suitabilityMultipliers[sector] = multiplier;

          const demandContribution = Math.max(
            1,
            Math.round((funded + idle * 0.5) * (energyWeights[sector] ?? 1)),
          );
          energyDemand += demandContribution;
          demandBySector[sector] = (demandBySector[sector] || 0) + demandContribution;
        });
      });

      const capital = rawCells[0];
      const capitalId = String(capital);
      const capitalCoastal = this.isCoastalCell(
        capital,
        biomes,
        cellNeighbors,
        cellOffsets,
        SHALLOW_OCEAN,
        DEEP_OCEAN,
      );

      const infraBase: InfrastructureData = {
        owner: player,
        status: 'active',
        hp: 100,
      };

      economy.infrastructure.airports[capitalId] = {
        ...infraBase,
        national: false,
      };
      if (!nationalAirport) {
        economy.infrastructure.airports[capitalId].national = true;
        economy.infrastructure.national.airport = capitalId;
        nationalAirport = capitalId;
      }

      economy.infrastructure.railHubs[capitalId] = {
        ...infraBase,
        national: false,
      };
      if (!nationalRail) {
        economy.infrastructure.railHubs[capitalId].national = true;
        economy.infrastructure.national.rail = capitalId;
        nationalRail = capitalId;
      }

      if (capitalCoastal) {
        economy.infrastructure.ports[capitalId] = {
          ...infraBase,
          national: false,
        };
        if (!nationalPort) {
          economy.infrastructure.ports[capitalId].national = true;
          economy.infrastructure.national.port = capitalId;
          nationalPort = capitalId;
        }
      }

      const plantConfigs = [
        { index: 0, type: 'coal', output: 28 },
        { index: 1, type: capitalCoastal ? 'hydro' : 'wind', output: capitalCoastal ? 18 : 14 },
        { index: 2, type: 'solar', output: 12 },
      ];
      for (const config of plantConfigs) {
        const source = ownedCells[config.index];
        if (source === undefined) continue;
        economy.energy.plants.push({
          canton: String(source),
          type: config.type as any,
          status: 'active',
        });
        energySupply += config.output;
      }

      const unitTemplates = [
        { role: 'infantry', strength: 6, upkeep: 12, readiness: 0.8, experience: 2 },
        { role: 'armor', strength: 8, upkeep: 18, readiness: 0.7, experience: 1 },
      ];
      unitTemplates.forEach((template, idx) => {
        const location = ownedCells[idx] ?? capital;
        const entityId = this.getNextEntityId(gameState);
        this.addEntity(gameState, {
          id: entityId,
          type: 'unit',
          owner: player,
          cellId: location,
          data: {
            role: template.role,
            strength: template.strength,
            readiness: template.readiness,
            upkeep: template.upkeep,
            experience: template.experience,
          },
        });
      });
    }

    LaborManager.generate(economy);

    let totalLabor = 0;
    for (const canton of Object.values(economy.cantons)) {
      totalLabor += canton.labor.general + canton.labor.skilled + canton.labor.specialist;
    }
    economy.resources.labor = totalLabor;
    const logisticsFloor = Math.round(totalLabor * 0.5);
    if (economy.resources.logistics < logisticsFloor) {
      economy.resources.logistics = logisticsFloor;
    }

    if (energyDemand > 0) {
      if (energySupply < energyDemand) {
        energySupply = energyDemand + players.length * 8;
      }
      economy.energy.state = {
        supply: energySupply,
        demand: energyDemand,
        ratio: Number((energySupply / energyDemand).toFixed(2)),
      };
    } else {
      economy.energy.state = { supply: energySupply, demand: 0, ratio: 1 };
    }
    economy.energy.demandBySector = demandBySector;
    economy.energy.fuelUsed = {
      coal: Math.round(energySupply * 0.4),
      oil: Math.round(energySupply * 0.25),
      uranium: Math.round(energySupply * 0.1),
    };
    economy.energy.oAndMSpent = Math.round(energySupply * 0.35);
    const storedEnergy = Math.round(energySupply * 0.6);
    if (storedEnergy > economy.resources.energy) {
      economy.resources.energy = storedEnergy;
    }
  }

  private static isCoastalCell(
    cell: CellId,
    biomes: Uint8Array,
    cellNeighbors: Int32Array,
    cellOffsets: Uint32Array,
    shallowOcean: number,
    deepOcean: number,
  ): boolean {
    const start = cellOffsets[cell];
    const end = cell + 1 < cellOffsets.length ? cellOffsets[cell + 1] : start;
    for (let i = start; i < end; i++) {
      const neighbor = cellNeighbors[i];
      if (neighbor < 0) continue;
      const biome = biomes[neighbor];
      if (biome === shallowOcean || biome === deepOcean) {
        return true;
      }
    }
    return false;
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