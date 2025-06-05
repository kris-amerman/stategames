// server/src/game-state/types.ts
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
  startedAt?: string;

  // Map info
  mapSize: MapSize;
  cellCount: number;

  // Players and basic turn tracking
  players: PlayerId[];
  currentPlayer: PlayerId;
  turnNumber: number;

  // Cell ownership - core mechanic
  cellOwnership: Map<CellId, PlayerId>; // cellId -> owner
  playerCells: Map<PlayerId, Set<CellId>>; // player -> owned cells

  // Entity system - location and ownership tracking
  entities: Map<EntityId, Entity>; // all entities by ID
  cellEntities: Map<CellId, Set<EntityId>>; // entities on each cell
  playerEntities: Map<PlayerId, Set<EntityId>>; // entities owned by each player
  entitiesByType: Map<EntityType, Set<EntityId>>; // entities by type
  nextEntityId: EntityId;
}

// Serializable version for persistence (Maps -> Objects)
export interface SerializableGameState {
  gameId: string;
  joinCode: string;
  status: "waiting" | "in_progress" | "finished";
  createdAt: string;
  startedAt?: string;

  mapSize: MapSize;
  cellCount: number;

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
}