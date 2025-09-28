// server/src/game-actions/handler.ts
import type { ServerWebSocket } from "bun";
import { GameService } from "../game-state";
import { GameStateManager } from "../game-state";
import type { UpdateResult } from "../game-state/authority";
import { meshService } from "../mesh-service";
import type { Entity, Game, GameState } from "../types";
import { broadcastGameStateUpdate } from "../index";
import { TurnManager } from "../turn";
import { broadcastTurnCompleted, broadcastStateChanges } from "../index";
import { collectStateChanges } from "../events";

export async function handleGameAction(ws: ServerWebSocket<any>, data: any) {
  const { actionType, gameId, playerId, ...actionData } = data;

  console.log(`Processing ${actionType} action from ${playerId} in game ${gameId}`);

  try {
    const stateView = await GameService.getGameState(gameId);

    if (!stateView) {
      sendActionResult(ws, false, 'Game not found');
      return;
    }

    if (stateView.status !== 'in_progress') {
      sendActionResult(ws, false, 'Game is not in progress');
      return;
    }

    // Check if it's the player's turn (except for non-turn actions if any)
    if (stateView.currentPlayer !== playerId) {
      sendActionResult(ws, false, 'It is not your turn');
      return;
    }

    // Process the action based on type
    let actionResult: UpdateResult<
      | { success: true; message: string; entityId?: number }
      | { success: false; error: string }
    > | null = null;
    switch (actionType) {
      case 'place_entity':
        actionResult = await GameService.updateGame(gameId, game =>
          handlePlaceEntityAction(gameId, game, playerId, actionData),
        );
        break;
      case 'move_unit':
        actionResult = await GameService.updateGame(gameId, game =>
          handleMoveUnitAction(gameId, game, playerId, actionData),
        );
        break;
      case 'end_turn':
        actionResult = await GameService.updateGame(gameId, game =>
          handleEndTurnAction(gameId, game, playerId, actionData),
        );
        break;
      default:
        sendActionResult(ws, false, `Unknown action type: ${actionType}`);
        return;
    }

    if (!actionResult) {
      sendActionResult(ws, false, 'Unsupported action');
      return;
    }

    const outcome = actionResult.result;

    if (outcome.success) {
      sendActionResult(ws, true, outcome.message);

      broadcastGameStateUpdate(gameId, actionResult.state as unknown as GameState, {
        actionType,
        playerId,
        details: actionData
      });
    } else {
      sendActionResult(ws, false, outcome.error);
    }

  } catch (error) {
    console.error('Error processing game action:', error);
    sendActionResult(ws, false, 'Internal server error');
  }
}

export async function handlePlaceEntityAction(gameId: string, game: Game, playerId: string, actionData: any): Promise<{ 
  success: true;
  message: string;
  entityId: number;
} | {
  success: false;
  error: string;
}> {
  const gameState = game.state;
  const { cellId, entityType } = actionData;
  
  // Validate the action
  if (typeof cellId !== 'number' || cellId < 0) {
    return { success: false, error: 'Invalid cell ID' };
  }
  
  if (entityType !== 'unit') {
    return { success: false, error: 'Invalid entity type' };
  }
  
  // Check if player owns the cell
  const cellOwner = gameState.cellOwnership[cellId];
  if (cellOwner !== playerId) {
    return { success: false, error: 'You can only place entities on your own territory' };
  }
  
  // Check if cell already has entities (for now, limit one unit per cell)
  const existingEntities = gameState.cellEntities[cellId] || [];
  if (existingEntities.length > 0) {
    return { success: false, error: 'Cell already contains an entity' };
  }
  
  // Create the entity
  const entityId = GameStateManager.getNextEntityId(gameState);
  
  const entity: Entity = {
    id: entityId,
    type: "unit",
    owner: playerId,
    cellId: cellId,
    data: {
      health: 100,
      attack: 10,
      defense: 5,
      moveRange: 1,
      hasMoved: false
    }
  };
  
  // Add entity to game state
  GameStateManager.addEntity(gameState, entity);
  
  return { 
    success: true, 
    message: `Unit placed on cell ${cellId}`,
    entityId: entityId
  };
}

export async function handleMoveUnitAction(gameId: string, game: Game, playerId: string, actionData: any): Promise<{
  success: true;
  message: string;
} | {
  success: false;
  error: string;
}> {
  const gameState = game.state;
  const { unitId, fromCellId, toCellId } = actionData;
  
  // Add debugging to see what we're receiving
  console.log('Move unit action data:', { unitId, fromCellId, toCellId, types: {
    unitId: typeof unitId,
    fromCellId: typeof fromCellId,
    toCellId: typeof toCellId
  }});
  
  // More flexible parameter validation
  const parsedUnitId = typeof unitId === 'string' ? unitId : String(unitId);
  const parsedFromCellId = typeof fromCellId === 'number' ? fromCellId : parseInt(String(fromCellId));
  const parsedToCellId = typeof toCellId === 'number' ? toCellId : parseInt(String(toCellId));
  
  // Validate parsed parameters
  if (!parsedUnitId || isNaN(parsedFromCellId) || isNaN(parsedToCellId)) {
    console.log('Parameter validation failed:', { 
      parsedUnitId, 
      parsedFromCellId, 
      parsedToCellId,
      unitIdValid: !!parsedUnitId,
      fromCellIdValid: !isNaN(parsedFromCellId),
      toCellIdValid: !isNaN(parsedToCellId)
    });
    return { success: false, error: 'Invalid action parameters' };
  }
  
  // Get the entity - try both string and number versions of unitId
  let entity = GameStateManager.getEntity(gameState, parseInt(parsedUnitId));
  if (!entity) {
    // Try the unitId as-is if parseInt failed
    entity = GameStateManager.getEntity(gameState, parsedUnitId as any);
  }
  
  if (!entity) {
    console.log('Entity not found:', { 
      parsedUnitId, 
      availableEntities: Object.keys(gameState.entities)
    });
    return { success: false, error: 'Unit not found' };
  }
  
  console.log('Found entity:', entity);
  
  // Check ownership
  if (entity.owner !== playerId) {
    return { success: false, error: 'You can only move your own units' };
  }
  
  // Check if unit is actually on the fromCell
  if (entity.cellId !== parsedFromCellId) {
    console.log('Unit location mismatch:', { 
      entityCellId: entity.cellId, 
      expectedFromCellId: parsedFromCellId 
    });
    return { success: false, error: 'Unit is not on the specified source cell' };
  }
  
  // Check if target cell is empty
  const entitiesOnTarget = GameStateManager.getEntitiesOnCell(gameState, parsedToCellId);
  if (entitiesOnTarget.length > 0) {
    return { success: false, error: 'Target cell is occupied' };
  }
  
  // Get mesh data to validate adjacency
  const meshData = await meshService.getMeshData(game.meta.mapSize);
  
  // Check if movement is within unit's range
  const moveDistance = calculateCellDistance(parsedFromCellId, parsedToCellId, meshData);
  const unitMoveRange = entity.data.moveRange || 1;
  
  console.log('Movement validation:', { 
    moveDistance, 
    unitMoveRange, 
    fromCellId: parsedFromCellId, 
    toCellId: parsedToCellId 
  });
  
  if (moveDistance > unitMoveRange) {
    return { success: false, error: `Unit can only move ${unitMoveRange} cell${unitMoveRange > 1 ? 's' : ''} at a time` };
  }
  
  // Check if unit has already moved this turn
  if (entity.data.hasMoved) {
    return { success: false, error: 'Unit has already moved this turn' };
  }
  
  // Perform the move - use the correct unitId type that worked for getEntity
  const entityId = typeof entity.id === 'number' ? entity.id : parseInt(String(entity.id));
  const moveSuccessful = GameStateManager.moveEntity(gameState, entityId, parsedToCellId);
  if (!moveSuccessful) {
    return { success: false, error: 'Failed to move unit' };
  }
  
  // Mark unit as having moved this turn
  entity.data.hasMoved = true;
  
  return {
    success: true,
    message: `Unit moved from cell ${parsedFromCellId} to cell ${parsedToCellId}`
  };
}

function sendActionResult(ws: ServerWebSocket<any>, success: boolean, message: string) {
  try {
    ws.send(JSON.stringify({
      event: 'action_result',
      data: { success, message: success ? message : undefined, error: !success ? message : undefined }
    }));
  } catch (error) {
    console.error('Failed to send action result:', error);
  }
}

function calculateCellDistance(cellId1: number, cellId2: number, meshData: any): number {
  if (cellId1 === cellId2) return 0;
  
  // Use BFS to find shortest path distance
  const visited = new Set<number>();
  const queue: { cellId: number; distance: number }[] = [{ cellId: cellId1, distance: 0 }];
  
  while (queue.length > 0) {
    const { cellId, distance } = queue.shift()!;
    
    if (cellId === cellId2) {
      return distance;
    }
    
    if (visited.has(cellId) || distance >= 10) { // Max search depth
      continue;
    }
    
    visited.add(cellId);
    
    // Add neighbors
    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    
    for (let i = start; i < end; i++) {
      const neighborId = meshData.cellNeighbors[i];
      if (neighborId >= 0 && !visited.has(neighborId)) {
        queue.push({ cellId: neighborId, distance: distance + 1 });
      }
    }
  }
  
  return Infinity; // Not reachable
}

export async function handleEndTurnAction(gameId: string, game: Game, playerId: string, actionData: any): Promise<{
  success: true;
  message: string;
} | {
  success: false;
  error: string;
}> {
  const gameState = game.state;
  console.log(`Player ${playerId} ending turn ${gameState.turnNumber}`);
  
  // Validate that it's actually the player's turn
  if (gameState.currentPlayer !== playerId) {
    return { success: false, error: 'It is not your turn' };
  }
  
  // Reset unit movement flags for the current player
  resetPlayerUnitMovement(gameState, playerId);

  // Get the game to access player list from meta
  // Advance to next player
  const currentPlayerIndex = game.meta.players.indexOf(playerId);
  const nextPlayerIndex = (currentPlayerIndex + 1) % game.meta.players.length;
  const nextPlayer = game.meta.players[nextPlayerIndex];
  
  // Update game state
  gameState.currentPlayer = nextPlayer;

  // If we've cycled back to the first player, resolve the turn and increment
  if (nextPlayerIndex === 0) {
    const prevEconomy = structuredClone(gameState.economy);
    TurnManager.advanceTurn(gameState);
    const events = collectStateChanges(prevEconomy, gameState.economy);
    gameState.turnNumber += 1;
    broadcastStateChanges(gameId, events);
    broadcastTurnCompleted(gameId, gameState, nextPlayer, events);
  }

  console.log(`Turn advanced: ${playerId} -> ${nextPlayer} (Turn ${gameState.turnNumber})`);

  return {
    success: true,
    message: `Turn ended. It's now ${nextPlayer}'s turn.`
  };
}

function resetPlayerUnitMovement(gameState: GameState, playerId: string): void {
  const playerEntities = gameState.playerEntities[playerId] || [];
  
  for (const entityId of playerEntities) {
    const entity = gameState.entities[entityId];
    if (entity && entity.data.hasMoved) {
      entity.data.hasMoved = false;
      console.log(`Reset movement for unit ${entityId}`);
    }
  }
}