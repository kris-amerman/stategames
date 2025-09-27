import { MapSize, deserializeTypedArrays } from './mesh';
import { drawCells } from './drawCells';
import { WIDTH, HEIGHT } from './config';
import {
  loadOrGetMesh,
  setCurrentCellBiomes,
  setCurrentCellCount,
  setCurrentMapSize,
  meshData,
  biomeConfig,
  showError
} from './terrain';
import { addToRoom, removeFromRoom, sendGameAction } from './network';
import { showGameNotification } from './notifications';
import { updatePlannerSnapshot } from './planner';
import { updateStatusBarFromGameState } from './statusBar';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

export let isMyTurn = false;
export let selectedUnitId: number | null = null;
export let selectedCellId: number | null = null;

export let currentGameEntities: { [entityId: number]: any } = {};
export let currentTerritoryData: { [cellId: number]: string } = {};
export let currentGameTerrain: Uint8Array | null = null;

export let currentGameId: string | null = null;
export let currentPlayerName: string | null = null;
export let isGameCreator = false;
export let requiredPlayers = 2;

export function initGame(gameCanvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  canvas = gameCanvas;
  ctx = context;

  canvas.addEventListener('click', handleCellClick);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedUnitId !== null) {
      deselectUnit();
      showGameNotification('Unit deselected', 'success');
    }
  });
}

export function handleActionResult(data: any): void {
  console.log('Action result received:', data);

  if (!data.success) {
    showGameNotification(data.error || 'Action failed', 'error');
  }
}

export function handleGameUpdate(data: any): void {
  console.log('Game update received:', data);

  if (data.gameId === currentGameId) {
    const gameState = data.state;

    if (gameState.status === 'in_progress' && gameState.currentPlayer) {
      isMyTurn = gameState.currentPlayer === currentPlayerName;
      updateTurnIndicator(gameState.currentPlayer, gameState.turnNumber);
    } else {
      isMyTurn = false;
      clearTurnIndicator();
    }

    if (gameState.cellOwnership) {
      currentTerritoryData = gameState.cellOwnership;
    }

    if (gameState.entities) {
      currentGameEntities = gameState.entities;
      console.log('Updated entities:', currentGameEntities);
    }

    renderGameState();
    updatePlannerSnapshot(gameState);
    updateStatusBarFromGameState(gameState, currentPlayerName);
  }
}

export function handleGameError(data: { error: string, gameId?: string }) {
  console.error('Game error:', data);

  if (!data.gameId || data.gameId === currentGameId) {
    showGameNotification(data.error, 'error');
  }
}

export function joinGameRoom(gameId: string, playerName: string, creator: boolean = false) {
  currentGameId = gameId;
  currentPlayerName = playerName;
  isGameCreator = creator;
  addToRoom(gameId, playerName, creator);
  console.log(`Added ws to game room: ${gameId} as ${playerName} (creator: ${creator})`);
}

export function leaveGameRoom() {
  removeFromRoom(currentGameId, currentPlayerName);
  if (currentGameId) {
    console.log(`Removed ws from game room: ${currentGameId}`);
  }
  currentGameId = null;
  currentPlayerName = null;
  isGameCreator = false;
}

export function dispatchGameAction(actionType: string, actionData: any) {
  if (!currentGameId || !currentPlayerName) {
    console.error('Missing game context - cannot send action');
    return;
  }
  sendGameAction(actionType, {
    gameId: currentGameId,
    playerId: currentPlayerName,
    ...actionData,
  });
}

export function processGameData(gameData: any): void {
  try {
    currentGameId = gameData.meta.gameId;
    requiredPlayers = gameData.meta.nationCount ?? gameData.meta.players.length;
    currentTerritoryData = gameData.state.cellOwnership || {};
    if (gameData.state.status === 'in_progress' && gameData.state.currentPlayer) {
      isMyTurn = gameData.state.currentPlayer === currentPlayerName;
      updateTurnIndicator(gameData.state.currentPlayer, gameData.state.turnNumber);
    } else {
      isMyTurn = false;
      clearTurnIndicator();
    }

    if (gameData.state.entities) {
      currentGameEntities = gameData.state.entities;
      console.log('Initial entities:', currentGameEntities);
    }

    let terrainData: Uint8Array;
    if (gameData.map.biomes.__typedArray) {
      terrainData = deserializeTypedArrays(gameData.map.biomes);
    } else {
      terrainData = new Uint8Array(gameData.map.biomes);
    }

    currentGameTerrain = terrainData;

    setCurrentCellBiomes(terrainData);
    setCurrentCellCount(terrainData.length);
    setCurrentMapSize(gameData.meta.mapSize as MapSize);

    if (!meshData || meshData.cellCount !== terrainData.length) {
      console.log(`Loading ${gameData.meta.mapSize} mesh for game...`);
      loadOrGetMesh(gameData.meta.mapSize as MapSize, ctx).then(() => {
        renderGameState();
        updatePlannerSnapshot(gameData.state);
        updateStatusBarFromGameState(gameData.state, currentPlayerName);
      });
    } else {
      renderGameState();
      updatePlannerSnapshot(gameData.state);
      updateStatusBarFromGameState(gameData.state, currentPlayerName);
    }

  } catch (error: any) {
    console.error('Failed to process game data:', error);
    showError(`Failed to process game data: ${error.message}`);
  }
}

export function renderGameState(): void {
  if (!meshData || !currentGameTerrain) {
    console.warn('Cannot render game state: missing mesh data or terrain');
    return;
  }

  console.time('renderGameState');

  const cellBiomes = currentGameTerrain;

  drawCells(
    WIDTH,
    HEIGHT,
    ctx,
    meshData.allVertices,
    meshData.cellOffsets,
    meshData.cellVertexIndices,
    cellBiomes,
    meshData.cellNeighbors,
    biomeConfig.smoothColors
  );

  drawTerritoryOverlay();

  if (currentGameEntities) {
    drawEntities();
  }

  console.timeEnd('renderGameState');
}

function drawEntities(): void {
  if (!meshData) return;

  for (const [entityId, entity] of Object.entries(currentGameEntities)) {
    if (entity.type === 'unit') {
      const isSelected = selectedUnitId === parseInt(entityId);
      console.log(`DRAWING UNIT ${entityId} (selected = ${isSelected})`);
      drawEntityMarker(entity.cellId, entity.owner, isSelected);
    }
  }
}

function drawEntityMarker(cellId: number, owner: string, isSelected: boolean = false): void {
  if (!meshData) return;

  const centerX = meshData.cellTriangleCenters[cellId * 2];
  const centerY = meshData.cellTriangleCenters[cellId * 2 + 1];

  const playerColors: { [playerId: string]: string } = {
    'player1': '#FF0000',
    'player2': '#0000FF',
    'player3': '#00FF00',
    'player4': '#FFFF00',
    'player5': '#FF00FF',
    'player6': '#00FFFF',
  };

  const fillColor = playerColors[owner] || '#888888';

  if (isSelected) {
    console.log(`UNIT ON ${cellId} selected`);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 12, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚔️', centerX, centerY);
}

function drawTerritoryOverlay(): void {
  if (!meshData || Object.keys(currentTerritoryData).length === 0) {
    return;
  }

  const territoryColors: { [playerId: string]: string } = {
    'player1': 'rgba(255, 0, 0, 0.3)',
    'player2': 'rgba(0, 0, 255, 0.3)',
    'player3': 'rgba(0, 255, 0, 0.3)',
    'player4': 'rgba(255, 255, 0, 0.3)',
    'player5': 'rgba(255, 0, 255, 0.3)',
    'player6': 'rgba(0, 255, 255, 0.3)',
  };

  for (const [cellIdStr, playerId] of Object.entries(currentTerritoryData)) {
    const cellId = parseInt(cellIdStr);
    const color = territoryColors[playerId] || 'rgba(128, 128, 128, 0.3)';

    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    if (start >= end) continue;

    ctx.fillStyle = color;
    ctx.beginPath();
    const v0 = meshData.cellVertexIndices[start];
    ctx.moveTo(meshData.allVertices[v0 * 2], meshData.allVertices[v0 * 2 + 1]);

    for (let j = start + 1; j < end; j++) {
      const vi = meshData.cellVertexIndices[j];
      ctx.lineTo(meshData.allVertices[vi * 2], meshData.allVertices[vi * 2 + 1]);
    }

    ctx.closePath();
    ctx.fill();
  }
}

function clearTurnIndicator(): void {
  const indicator = document.getElementById('turnIndicator');
  if (indicator) {
    indicator.remove();
  }
}

export function updateTurnIndicator(currentPlayer: string, turnNumber: number): void {
  let turnIndicator = document.getElementById('turnIndicator');

  if (!turnIndicator) {
    turnIndicator = document.createElement('div');
    turnIndicator.id = 'turnIndicator';
    turnIndicator.style.cssText = `
      position: fixed;
      top: 70px;
      left: 50%;
      transform: translateX(-50%);
      padding: 15px 25px;
      border-radius: 8px;
      color: white;
      font-family: Arial, sans-serif;
      font-size: 16px;
      font-weight: bold;
      z-index: 1500;
      text-align: center;
      min-width: 250px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(turnIndicator);
  }

  if (isMyTurn) {
    turnIndicator.style.background = 'rgba(76, 175, 80, 0.9)';
    turnIndicator.innerHTML = `
      <div id="turnStatus">Your Turn - Turn ${turnNumber}</div>
      <button id="endTurnButton" style="
        background: #4CAF50;
        color: white;
        border: solid 3px rgba(80, 182, 80, 0.9);
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        transition: background-color 0.2s;
      ">End Turn</button>
    `;

    const endTurnButton = document.getElementById('endTurnButton');
    if (endTurnButton) {
      endTurnButton.addEventListener('click', endTurn);
      endTurnButton.addEventListener('mouseenter', (e) => {
        (e.target as HTMLElement).style.background = '#45a049';
      });
      endTurnButton.addEventListener('mouseleave', (e) => {
        (e.target as HTMLElement).style.background = '#4CAF50';
      });
    }
  } else {
    turnIndicator.style.background = 'rgba(255, 193, 7, 0.9)';
    turnIndicator.innerHTML = `
      <div id="waitingStatus">Waiting for ${currentPlayer} - Turn ${turnNumber}</div>
    `;
  }
}

function endTurn(): void {
  if (!isMyTurn) {
    showGameNotification('It is not your turn', 'error');
    return;
  }

  const endTurnButton = document.getElementById('endTurnButton') as HTMLButtonElement;
  if (endTurnButton) {
    endTurnButton.disabled = true;
    endTurnButton.textContent = 'Ending Turn...';
    endTurnButton.style.background = '#cccccc';
  }

  deselectUnit();

  dispatchGameAction('end_turn', {});

  console.log(`${currentPlayerName} ending turn`);
}

function handleCellClick(event: MouseEvent): void {
  if (!isMyTurn || !meshData || currentGameTerrain?.length === 0) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const clickedCellId = findCellAtPosition(x, y);

  if (clickedCellId !== -1) {
    const unitOnCell = findUnitOnCell(clickedCellId);

    if (unitOnCell && unitOnCell.owner === currentPlayerName) {
      selectUnit(unitOnCell.id, clickedCellId);
    } else if (selectedUnitId !== null) {
      moveUnit(selectedUnitId, selectedCellId!, clickedCellId);
    } else {
      const cellOwner = currentTerritoryData[clickedCellId];

      if (cellOwner === currentPlayerName) {
        placeEntity(clickedCellId);
      } else if (cellOwner) {
        showGameNotification(`This cell belongs to ${cellOwner}`, 'warning');
      } else {
        showGameNotification('You can only place units on your territory', 'warning');
      }
    }
  }
}

function findUnitOnCell(cellId: number): any | null {
  for (const [entityId, entity] of Object.entries(currentGameEntities)) {
    if (entity.cellId === cellId && entity.type === 'unit') {
      return entity;
    }
  }
  return null;
}

function selectUnit(unitId: number, cellId: number): void {
  selectedUnitId = unitId;
  selectedCellId = cellId;
  console.log(`NEW SELECTED UNIT ID: ${selectedUnitId}`);
  renderGameState();
}

function deselectUnit(): void {
  selectedUnitId = null;
  selectedCellId = null;
  renderGameState();
}

function moveUnit(unitId: number, fromCellId: number, toCellId: number): void {
  console.log('Sending move action:', { unitId, fromCellId, toCellId });
  dispatchGameAction('move_unit', {
    unitId,
    fromCellId,
    toCellId,
  });
  deselectUnit();
  console.log(`Sending move_unit action: unit ${unitId} from cell ${fromCellId} to cell ${toCellId}`);
}

function findCellAtPosition(x: number, y: number): number {
  if (!meshData) return -1;

  const nCells = meshData.cellCount;

  for (let cellId = 0; cellId < nCells; cellId++) {
    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    if (start >= end) continue;
    if (isPointInCell(x, y, cellId)) {
      return cellId;
    }
  }

  return -1;
}

function isPointInCell(x: number, y: number, cellId: number): boolean {
  if (!meshData) return false;

  const start = meshData.cellOffsets[cellId];
  const end = meshData.cellOffsets[cellId + 1];
  if (start >= end) return false;

  let inside = false;
  let j = end - 1;

  for (let i = start; i < end; i++) {
    const vi = meshData.cellVertexIndices[i];
    const vj = meshData.cellVertexIndices[j];

    const xi = meshData.allVertices[vi * 2];
    const yi = meshData.allVertices[vi * 2 + 1];
    const xj = meshData.allVertices[vj * 2];
    const yj = meshData.allVertices[vj * 2 + 1];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
    j = i;
  }

  return inside;
}

function placeEntity(cellId: number): void {
  dispatchGameAction('place_entity', {
    cellId,
    entityType: 'unit',
  });

  console.log(`Sending place_entity action for cell ${cellId} by ${currentPlayerName}`);
}

