import type { Game, GameMeta, GameMap, GameState, EntityId } from '../types';

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  throw new Error('structuredClone is not available in this environment');
}

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return value;
  }
  if (value instanceof ArrayBuffer || value instanceof DataView) {
    return value as T;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);
  const propNames = Reflect.ownKeys(value as object);
  for (const name of propNames) {
    const desc = Object.getOwnPropertyDescriptor(value as object, name);
    if (!desc || !('value' in desc)) continue;
    deepFreeze(desc.value, seen);
  }
  return Object.freeze(value) as T;
}

export interface AuthoritativeSnapshot {
  game: Readonly<Game>;
  state: Readonly<GameState>;
  meta: Readonly<GameMeta>;
  map: Readonly<GameMap>;
}

export interface UpdateResult<T> extends AuthoritativeSnapshot {
  result: T;
}

export function auditGameIntegrity(game: Game): string[] {
  const issues: string[] = [];
  const state = game.state;

  const ownership = state.cellOwnership;
  const playerCells = state.playerCells;

  for (const [cellKey, owner] of Object.entries(ownership)) {
    const cellId = Number(cellKey);
    if (!playerCells[owner]?.includes(cellId)) {
      issues.push(`Cell ${cellId} owned by ${owner} missing from playerCells.`);
    }
  }

  for (const [playerId, cells] of Object.entries(playerCells)) {
    for (const cell of cells) {
      if (ownership[cell] !== playerId) {
        issues.push(`Player ${playerId} lists cell ${cell} but ownership is ${ownership[cell] ?? 'none'}.`);
      }
    }
  }

  for (const [cantonId, cells] of Object.entries(state.cantonCells)) {
    const meta = state.cantonMeta[cantonId];
    if (!meta) {
      issues.push(`Missing canton meta for ${cantonId}.`);
    }
    for (const cell of cells) {
      if (state.cellCantons[cell] !== cantonId) {
        issues.push(`Cell ${cell} lists canton ${state.cellCantons[cell]} but ${cantonId} includes it.`);
      }
    }
  }

  for (const [cellKey, cantonId] of Object.entries(state.cellCantons)) {
    if (!cantonId) continue;
    const cells = state.cantonCells[cantonId];
    if (!cells || !cells.includes(Number(cellKey))) {
      issues.push(`Cell ${cellKey} maps to canton ${cantonId} but cantonCells missing it.`);
    }
  }

  const assignedCantons = new Set<string>();
  for (const [playerId, cantons] of Object.entries(state.nationCantons)) {
    for (const cantonId of cantons) {
      if (!state.cantonCells[cantonId]) {
        issues.push(`Nation ${playerId} references canton ${cantonId} with no cells.`);
      }
      assignedCantons.add(cantonId);
    }
  }

  for (const cantonId of Object.keys(state.cantonCells)) {
    if (!assignedCantons.has(cantonId)) {
      issues.push(`Canton ${cantonId} is not assigned to any nation.`);
    }
  }

  const entities = state.entities;
  const cellEntities = state.cellEntities;
  const playerEntities = state.playerEntities;
  const typeEntities = state.entitiesByType;

  for (const [entityId, entity] of Object.entries(entities)) {
    const numericId = Number(entityId) as EntityId;
    if (!cellEntities[entity.cellId]?.includes(numericId)) {
      issues.push(`Entity ${entityId} missing from cellEntities for cell ${entity.cellId}.`);
    }
    if (entity.owner && !playerEntities[entity.owner]?.includes(numericId)) {
      issues.push(`Entity ${entityId} owned by ${entity.owner} missing from playerEntities.`);
    }
    if (!typeEntities[entity.type as keyof typeof typeEntities]?.includes(numericId)) {
      issues.push(`Entity ${entityId} missing from type index ${entity.type}.`);
    }
  }

  for (const [cellKey, ids] of Object.entries(cellEntities)) {
    for (const id of ids) {
      const entity = entities[id];
      if (!entity) {
        issues.push(`cellEntities references missing entity ${id} on cell ${cellKey}.`);
        continue;
      }
      if (entity.cellId !== Number(cellKey)) {
        issues.push(`Entity ${id} stored on cell ${entity.cellId} but indexed for cell ${cellKey}.`);
      }
    }
  }

  for (const [playerId, ids] of Object.entries(playerEntities)) {
    for (const id of ids) {
      const entity = entities[id];
      if (entity && entity.owner !== playerId) {
        issues.push(`Player ${playerId} lists entity ${id} owned by ${entity.owner ?? 'none'}.`);
      }
    }
  }

  for (const [type, ids] of Object.entries(typeEntities)) {
    for (const id of ids) {
      const entity = entities[id];
      if (!entity) {
        issues.push(`Entity ${id} missing but referenced in type index ${type}.`);
      }
    }
  }

  for (const [nationId, nation] of Object.entries(state.nations)) {
    if (nation.id !== nationId) {
      issues.push(`Nation snapshot key ${nationId} mismatches embedded id ${nation.id}.`);
    }
  }

  return issues;
}

export class AuthoritativeGameStore {
  private readonly games = new Map<string, Game>();

  register(game: Game): void {
    this.games.set(game.meta.gameId, game);
  }

  has(gameId: string): boolean {
    return this.games.has(gameId);
  }

  getMutableGame(gameId: string): Game | null {
    return this.games.get(gameId) ?? null;
  }

  getSnapshot(gameId: string): AuthoritativeSnapshot | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    return {
      game: deepFreeze(clone(game)),
      state: deepFreeze(clone(game.state)),
      meta: deepFreeze(clone(game.meta)),
      map: deepFreeze(clone(game.map)),
    };
  }

  getState(gameId: string): Readonly<GameState> | null {
    const record = this.getSnapshot(gameId);
    return record?.state ?? null;
  }

  getMeta(gameId: string): Readonly<GameMeta> | null {
    const record = this.getSnapshot(gameId);
    return record?.meta ?? null;
  }

  getGame(gameId: string): Readonly<Game> | null {
    const record = this.getSnapshot(gameId);
    return record?.game ?? null;
  }

  getMap(gameId: string): Readonly<GameMap> | null {
    const record = this.getSnapshot(gameId);
    return record?.map ?? null;
  }

  async update<T>(gameId: string, mutator: (game: Game) => T | Promise<T>): Promise<UpdateResult<T>> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }
    const result = await mutator(game);
    const issues = auditGameIntegrity(game);
    if (issues.length) {
      throw new Error(`Authoritative state violation:\n${issues.join('\n')}`);
    }
    const snapshot = this.getSnapshot(gameId);
    if (!snapshot) {
      throw new Error('Failed to capture authoritative snapshot');
    }
    return { ...snapshot, result };
  }

  listSnapshots(): AuthoritativeSnapshot[] {
    const snapshots: AuthoritativeSnapshot[] = [];
    for (const gameId of this.games.keys()) {
      const snapshot = this.getSnapshot(gameId);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  get size(): number {
    return this.games.size;
  }
}

export const authoritativeStore = new AuthoritativeGameStore();
