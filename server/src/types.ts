export type MapSize = "small" | "medium" | "large" | "xl";
export type PlayerId = string;
export type CellId = number;
export type EntityId = number;

export type EntityType = 
  | "unit";

export interface Entity {
  id: EntityId;
  type: EntityType;
  owner: PlayerId | null;
  cellId: CellId;
  data: Record<string, any>;
}

export type ActionType =
  | "move"
  | "attack"
  | "build"
  | "end_turn"
  | "research"
  | "recruit";

export type TurnPhase = "planning" | "execution";

export type Gate = "budget" | "inputs" | "logistics" | "labor" | "suitability";

export interface BudgetPools {
  /** Gold allocated to military upkeep and discretionary spending */
  military: number;
  /** Gold allocated to welfare tiers */
  welfare: number;
  /** Operations & Maintenance gold by sector */
  sectorOM: Partial<Record<SectorType, number>>;
}

export interface TurnPlan {
  budgets?: BudgetPools;
  policies?: Record<string, any>;
  slotPriorities?: Record<string, any>;
  tradeOrders?: Record<string, any>;
  projects?: Record<string, any>;
}

export interface TurnSummary {
  log: string[];
}

// === Economy Types ===

// Resources tracked by the economy.
export type ResourceType =
  | "gold"
  | "fx"
  | "food"
  | "materials"
  | "production"
  | "ordnance"
  | "luxury"
  | "energy"
  | "uranium"
  | "coal"
  | "oil"
  | "rareEarths"
  | "research"
  | "logistics"
  | "labor";

export interface Resources {
  gold: number;
  fx: number;
  food: number;
  materials: number;
  production: number;
  ordnance: number;
  luxury: number;
  energy: number;
  uranium: number;
  coal: number;
  oil: number;
  rareEarths: number;
  research: number;
  logistics: number;
  labor: number;
}

export type LaborType = "general" | "skilled" | "specialist";

export interface LaborPool {
  general: number;
  skilled: number;
  specialist: number;
}

// Welfare policy tiers for the nation.
export interface WelfarePolicies {
  education: number;
  healthcare: number;
  socialSupport: number;
}

// Welfare system state tracking current and next-turn tiers.
export interface WelfareState {
  current: WelfarePolicies;
  next: WelfarePolicies;
}

// Terrain tile categories that compose a canton geography mix.
export type TileType =
  | 'plains'
  | 'woods'
  | 'hills'
  | 'rainforest'
  | 'wetlands'
  | 'mountains'
  | 'shallows'
  | 'coast'
  | 'river'
  | 'tundra'
  | 'desert';

export type SectorType =
  | "agriculture"
  | "extraction"
  | "manufacturing"
  | "defense"
  | "luxury"
  | "finance"
  | "research"
  | "logistics"
  | "energy";

export interface SectorDefinition {
  outputs: ResourceType[];
  inputs: ResourceType[];
}

export interface SectorState {
  /** Total slots available for this sector in the canton */
  capacity: number;
  /** Slots funded to attempt running this turn */
  funded: number;
  /** Slots idle and charged idle tax */
  idle: number;
  /** Slots that actually ran after all gates */
  utilization?: number;
}

// === Energy System Types ===

export type PlantType =
  | 'coal'
  | 'gas'
  | 'oilPeaker'
  | 'nuclear'
  | 'hydro'
  | 'wind'
  | 'solar';

export type PlantStatus = 'active' | 'idle' | 'building';

export interface PlantRegistryEntry {
  canton: string;
  type: PlantType;
  status: PlantStatus;
  turns_remaining?: number;
}

export interface PlantAttributes {
  fuelType: ResourceType | null;
  baseOutput: number;
  oAndMCost: number;
  rcf: boolean;
}

export interface EnergyComputation {
  supply: number;
  demand: number;
  ratio: number;
}

export interface BrownoutRecord {
  canton: string;
  sector: SectorType;
  before: number;
  after: number;
}

export interface LaborConsumption {
  foodRequired: number;
  foodProvided: number;
  luxuryRequired: number;
  luxuryProvided: number;
}

export interface ShortageRecord {
  food: boolean;
  luxury: boolean;
}

export interface SuitabilityResult {
  percent: number;
  multiplier: number;
}

export type GeographyModifiers = Partial<
  Record<SectorType, Partial<Record<TileType, number>>>
>;

export type UrbanizationModifiers = Partial<
  Record<SectorType, Partial<Record<number, number>>>
>;

/** Flags that may trigger Urbanization Level decay at end of turn. */
export interface DecayFlags {
  siege?: boolean;
  energy?: boolean;
  food?: boolean;
  catastrophe?: boolean;
}

export interface CantonEconomy {
  sectors: { [K in SectorType]?: SectorState };
  labor: LaborPool;
  laborDemand: Partial<Record<SectorType, LaborPool>>;
  laborAssigned: Partial<Record<SectorType, LaborPool>>;
  lai: number;
  /** Happiness modifier from healthcare tier applied this turn */
  happiness: number;
  consumption: LaborConsumption;
  shortages: ShortageRecord;
  urbanizationLevel: number;
  /**
   * Development meter advances toward the next Urbanization Level.
   * Resets to 0 when reaching 4 and triggering a level increase.
   */
  development: number;
  /**
   * Urbanization Level that will become active next turn after lagged effects.
   */
  nextUrbanizationLevel: number;
  /** Geography mix for the canton; shares should sum to 1.0. */
  geography: Record<TileType, number>;
  /** Cached suitability percent by sector for ordering labor priority. */
  suitability: Partial<Record<SectorType, number>>;
  /** Cached suitability multiplier by sector applied after all other gates. */
  suitabilityMultipliers: Partial<Record<SectorType, number>>;
}

export type InfrastructureType = 'airport' | 'port' | 'rail';

export interface InfrastructureData {
  owner: string;
  status: 'active' | 'inactive' | 'building';
  national?: boolean;
  turns_remaining?: number;
  hp: number;
  toggle?: { target: 'active' | 'inactive'; turns: number };
}

export interface InfrastructureRegistry {
  airports: Record<string, InfrastructureData>;
  ports: Record<string, InfrastructureData>;
  railHubs: Record<string, InfrastructureData>;
  national: { airport?: string; port?: string; rail?: string };
}

export type ProjectTier = 'small' | 'medium' | 'large' | 'mega';

export interface ProjectData {
  id: number;
  canton: string;
  sector: SectorType;
  tier: ProjectTier;
  slots: number;
  status: 'active' | 'inactive' | 'building' | 'suspended';
  owner: string;
  turns_remaining: number;
  cost: { gold: number; production: number };
  toggle?: { target: 'active' | 'inactive'; turns: number };
  completed?: boolean;
}

export interface ProjectsState {
  nextId: number;
  projects: ProjectData[];
}

export interface FinanceState {
  /** Total outstanding borrowed Gold */
  debt: number;
  /** Maximum allowable debt before default */
  creditLimit: number;
  /** Interest rate applied to debt each turn */
  interestRate: number;
  /** Flag when credit limit exceeded */
  defaulted: boolean;
  /** Debt stress tier flags */
  debtStress: boolean[];
}

export interface TradeState {
  /** Imports scheduled to arrive next turn */
  pendingImports: Partial<Record<ResourceType, number>>;
  /** Exports scheduled to arrive next turn (for symmetry) */
  pendingExports: Partial<Record<ResourceType, number>>;
}

export interface EconomyState {
  resources: Resources;
  cantons: { [cantonId: string]: CantonEconomy };
  /** Slots undergoing retooling and their timers */
  retoolQueue: RetoolOrder[];
  /** Energy system tracking */
  energy: {
    plants: PlantRegistryEntry[];
    state: EnergyComputation;
    demandBySector: Partial<Record<SectorType, number>>;
    brownouts: BrownoutRecord[];
    essentialsFirst: boolean;
  };
  /** Infrastructure registry */
  infrastructure: InfrastructureRegistry;
  /** Capital projects state */
  projects: ProjectsState;
  /** Treasury, debt, and related finance tracking */
  finance: FinanceState;
  /** Welfare policy state */
  welfare: WelfareState;
  /** Trade state and pending international shipments */
  trade: TradeState;
}

export interface RetoolOrder {
  canton: string;
  sector_from: SectorType;
  sector_to: SectorType;
  slots: number;
  turns_remaining: number;
}

/**
 * Static game metadata that never changes after game creation.
 * This includes basic information about the game session and its participants.
 * 
 * 
 */
export interface GameMeta {
  /** Unique identifier for this game instance */
  gameId: string;

  /** Short code players can use to join this game (e.g., "ABC123") */
  joinCode: string;

  /** ISO timestamp of when this game was created */
  createdAt: string;

  /**
   * List of all players in this game, in turn order.
   * The first player in the array goes first, etc.
   */
  players: PlayerId[];

  /**
   * Size of the map for this game.
   * Determines which mesh to use.
   */
  mapSize: MapSize;
}

/**
 * Static map/terrain information that doesn't change during gameplay.
 * Contains ONLY the physical geography and terrain data that defines 
 * the unique game world layout.
 * 
 * This data is immutable after map generation and represents the 
 * "physical reality" of the game world - terrain types, elevation, 
 * climate zones, etc.
 * 
 * Resource deposits, infrastructure, and other gameplay elements 
 * should be stored in GameState as they can change during play.
 */
export interface GameMap {
  /**
   * Biome for each cell on the map.
   * Each byte represents a biome ID for the corresponding cell.
   * Array length equals the number of cells in the associated mesh.
   */
  biomes: Uint8Array;
}

/**
 * Dynamic game state that changes throughout gameplay.
 * Contains all the information that evolves as players take actions.
 */
export interface GameState {
  /** Current phase of the game */
  status: "waiting" | "in_progress" | "finished";

  /** ID of the player whose turn it currently is */
  currentPlayer: PlayerId;

  /** Current turn number (increments when all players have taken their turn) */
  turnNumber: number;

  /** Phase of the turn flow (planning or execution) */
  phase: TurnPhase;

  /** Plan currently being executed */
  currentPlan: TurnPlan | null;

  /** Plan being prepared for the next turn */
  nextPlan: TurnPlan | null;

  /**
   * Maps each cell to its current owner.
   * Key: CellId, Value: PlayerId who owns that cell
   */
  cellOwnership: { [cellId: CellId]: PlayerId };

  /**
   * Maps each player to the cells they own.
   * Key: PlayerId, Value: Array of CellIds owned by that player
   */
  playerCells: { [playerId: PlayerId]: CellId[] };

  /**
   * Maps entity IDs to their full entity data.
   * Key: EntityId, Value: Complete Entity object
   */
  entities: { [entityId: EntityId]: Entity };

  /**
   * Maps each cell to the entities currently on it.
   * Key: CellId, Value: Array of EntityIds on that cell
   */
  cellEntities: { [cellId: CellId]: EntityId[] };

  /**
   * Maps each player to the entities they own.
   * Key: PlayerId, Value: Array of EntityIds owned by that player
   */
  playerEntities: { [playerId: PlayerId]: EntityId[] };

  /**
   * Maps entity types to all entities of that type.
   * Key: EntityType as string, Value: Array of EntityIds of that type
   */
  entitiesByType: { [K in EntityType]: EntityId[] };

  /**
   * Counter for generating unique entity IDs.
   * Incremented each time a new entity is created.
   */
  economy: EconomyState;

  /**
   * Counter for generating unique entity IDs.
   * Incremented each time a new entity is created.
   */
  nextEntityId: number;
}

/**
 * Complete game representation containing all game data.
 * This is the main interface that combines metadata, map, and dynamic state.
 * 
 * Used for transmitting the full game state over the network, typically:
 * - When a player first joins a game (initial state download)
 * - When a player reconnects after a disconnection
 * 
 * For incremental updates during gameplay (turn-by-turn changes), 
 * use GameStateUpdate instead to avoid retransmitting static map data and metadata.
 * 
 * NOTE: This interface may contain TypedArrays (e.g., Uint8Array),
 * complex nested objects, and other data types that are not directly JSON-serializable.
 * Consider using binary serialization formats (e.g., MessagePack) for network
 * transmission, or implement custom serialization logic if using JSON.
 */
export interface Game {
  /** Static game metadata (never changes) */
  meta: GameMeta;

  /** Static map/terrain data (never changes during gameplay) */
  map: GameMap;

  /** Dynamic game state (changes as game progresses) */
  state: GameState;
}

/**
 * Format for transmitting game state updates during gameplay.
 * Used for incremental updates when only the game state changes
 * (territory ownership, entity movements, turn progression, etc.).
 *
 * Does not include map data since terrain doesn't change during gameplay.
 * 
 * NOTE: Like the Game interface, this may contain TypedArrays
 * and complex nested objects that require binary serialization for network transmission.
 */
export interface GameStateUpdate {
  /** ID of the game being updated */
  gameId: string;

  /** The updated game state */
  state: GameState;

  /**
   * Optional information about the last action that caused this update.
   * Should be omitted for system-generated updates.
   */
  lastAction?: {
    actionType: ActionType;
    playerId: PlayerId;
    details: Record<string, any>;
  };
}

/**
 * Geometric mesh data for a dual-cell mesh constructed from a Delaunay triangulation.
 * 
 * This represents the dual mesh where each cell corresponds to an interior point from
 * the original Delaunay triangulation, and the cell vertices are the centroids of 
 * triangles that surround that point.
 * 
 * NOTE: Uses TypedArrays that require binary serialization 
 * (e.g., MessagePack) for efficient storage and network transmission.
 */
export interface MeshData {
  /**
   * Raw coordinates of all cell vertices in the mesh.
   * Format: [x0, y0, x1, y1, x2, y2, ...]
   * These are triangle centroids from the original Delaunay triangulation.
   */
  allVertices: Float64Array;

  /**
   * Offset array for accessing cell data in other arrays.
   * Length: cellCount + 1
   * 
   * For cell i:
   * - Cell vertices: cellVertexIndices[cellOffsets[i]] to cellVertexIndices[cellOffsets[i+1]-1]
   * - Cell neighbors: cellNeighbors[cellOffsets[i]] to cellNeighbors[cellOffsets[i+1]-1]
   */
  cellOffsets: Uint32Array;

  /**
   * Flattened list of vertex indices for each cell in counter-clockwise order.
   * Each index references a vertex in allVertices (divide by 2 for coordinate pairs).
   * Use cellOffsets to determine which indices belong to each cell.
   */
  cellVertexIndices: Uint32Array;

  /**
   * Flattened list of neighboring cell IDs for each cell.
   * Parallel array to cellVertexIndices - same structure and indexing.
   * A value of -1 indicates a boundary edge (no neighbor).
   */
  cellNeighbors: Int32Array;

  /**
   * Coordinates of the original triangle vertices that define each cell's center.
   * Format: [x0, y0, x1, y1, x2, y2, ...] ordered by cell ID.
   * These are the actual Delaunay triangulation points, not the dual mesh centroids.
   */
  cellTriangleCenters: Float64Array;

  /**
   * Total number of cells in the mesh.
   * Only includes interior cells (boundary points are excluded).
   */
  cellCount: number;
}