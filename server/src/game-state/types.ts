export type MapSize = "small" | "medium" | "large" | "xl";
export type PlayerId = string;
export type CellId = string;
export type EntityId = string;

export enum EntityType {
  UNIT = "unit",
}

export interface Entity {
  id: EntityId;
  type: EntityType;
  owner: PlayerId | null;
  cellId: CellId;
  data: Record<string, any>;
}

/**
 * Static game metadata that never changes after game creation.
 * This includes basic information about the game session and its participants.
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
 * Contains the environmental data that defines the unique game world.
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
  entitiesByType: { [entityType: string]: EntityId[] };
  
  /** 
   * Counter for generating unique entity IDs.
   * Incremented each time a new entity is created.
   */
  nextEntityId: number;
}

/**
 * Complete game representation containing all game data.
 * This is the main interface that combines metadata, map, and dynamic state.
 */
export interface Game {
  /** Static game metadata (never changes) */
  meta: GameMeta;
  
  /** Static map/terrain data (never changes during gameplay) */
  map: GameMap;
  
  /** Dynamic game state (changes as game progresses) */
  state: GameState;
}

// ============================================================================
// TRANSMISSION FORMATS
// ============================================================================

/**
 * Format for transmitting complete game data over WebSocket.
 * Used when clients need the full game state (e.g., on game start).
 * 
 * The mapData is compressed binary data to minimize transmission size.
 * Clients receive this as a binary WebSocket message with embedded JSON.
 */
export interface GameTransmission {
  /** Static game metadata */
  meta: GameMeta;
  
  /** Current dynamic game state */
  state: GameState;
  
  /** 
   * Compressed binary representation of the GameMap.
   * Contains gzipped biome data that clients must decompress.
   */
  compressedMap: ArrayBuffer;
}

/**
 * Format for transmitting game state updates during gameplay.
 * Used for incremental updates when only the game state changes
 * (territory ownership, entity movements, turn progression, etc.).
 * 
 * Does not include map data since terrain doesn't change during gameplay.
 */
export interface GameStateUpdate {
  /** ID of the game being updated */
  gameId: string;
  
  /** The updated game state */
  state: GameState;
  
  /** 
   * Optional information about the last action that caused this update.
   * Used for displaying notifications and game history.
   */
  lastAction?: {
    actionType: string;
    playerId: PlayerId;
    details: Record<string, any>;
  };
}