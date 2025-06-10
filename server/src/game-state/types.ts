export type MapSize = "small" | "medium" | "large" | "xl";
export type PlayerId = string; // e.g., "player1", "player2"
export type CellId = number; // 0-based cell index
export type EntityId = number;

export enum EntityType {
  UNIT = "unit",
}

export interface Entity {
  id: EntityId;
  type: EntityType;
  owner: PlayerId | null; // null for neutral entities
  cellId: CellId;
  // Entity-specific data - flexible for different entity types
  data: Record<string, any>;
}

export interface GameState {
  // Basic game info
  gameId: string;
  joinCode: string;
  status: "waiting" | "in_progress" | "finished";
  createdAt: string;

  // Players and basic turn tracking
  players: PlayerId[];
  currentPlayer: PlayerId;
  turnNumber: number;

  // Cell ownership
  cellOwnership: Map<CellId, PlayerId>; // cellId -> playerId
  playerCells: Map<PlayerId, Set<CellId>>; // playerId -> cellIds

  // Entity system
  entities: Map<EntityId, Entity>; // all entities by ID
  cellEntities: Map<CellId, Set<EntityId>>; // cellId -> entityIds
  playerEntities: Map<PlayerId, Set<EntityId>>; // playerId -> entityIds
  entitiesByType: Map<EntityType, Set<EntityId>>; // 
  nextEntityId: EntityId;

  // Terrain data
  biomes: Uint8Array;

  // Mesh info (to lookup associated MeshData)
  mapSize: MapSize;
}

// Serializable version for persistence (Maps -> Objects) NOTE/TODO ids become strings
export interface SerializableGameState {
  gameId: string;
  joinCode: string;
  status: "waiting" | "in_progress" | "finished";
  createdAt: string;

  players: PlayerId[];
  currentPlayer: PlayerId;
  turnNumber: number;

  // Serialized Maps as objects - using index signatures for JSON compatibility
  cellOwnership: { [cellId: string]: PlayerId };
  playerCells: { [playerId: string]: CellId[] };
  entities: { [entityId: string]: Entity };
  cellEntities: { [cellId: string]: EntityId[] };
  playerEntities: { [playerId: string]: EntityId[] };
  entitiesByType: { [entityType: string]: EntityId[] };
  nextEntityId: EntityId;

  // TODO how to "serialize"? base64?
  biomes: Uint8Array;

  mapSize: MapSize;
}