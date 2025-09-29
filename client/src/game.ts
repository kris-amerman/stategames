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
import { updateDebugSidebarFromGameState } from './debugSidebar';
import { computeCellColors, buildCantonAdjacency, rgbaToCss, RgbaColor } from './mapColors';
import { getMapViewMode } from './mapViewState';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

export let isMyTurn = false;
export let selectedUnitId: number | null = null;
export let selectedCellId: number | null = null;

export let currentGameEntities: { [entityId: number]: any } = {};
export let currentTerritoryData: { [cellId: number]: string } = {};
export let currentCellCantons: Record<string, string | undefined> = {};
export let currentNationCantons: Record<string, string[]> = {};
export let currentGameSeed: string | null = null;
export let currentGameTerrain: Uint8Array | null = null;

export let currentGameId: string | null = null;
export let currentPlayerName: string | null = null;
export let isGameCreator = false;
export let requiredPlayers = 2;

const BASE_COLOR_ALPHA = 0.45;
const DEFAULT_NATION_PALETTE = [
  '#FF6B6B',
  '#4D96FF',
  '#6BCB77',
  '#F7C948',
  '#A66DD4',
  '#4ED8B5',
  '#FF8E72',
  '#3A86FF',
  '#FFCF56',
  '#845EC2',
  '#2EC4B6',
  '#FF5E7E',
];

const nationColorAssignments = new Map<string, RgbaColor>();
let paletteCursor = 0;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixChannel(base: number, target: number, amount: number): number {
  return clampChannel(base * (1 - amount) + target * amount);
}

function hexToRgbaColor(hex: string, alpha: number): RgbaColor {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((ch) => ch + ch).join('')
    : normalized.padStart(6, '0').slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b, a: alpha };
}

function derivePaletteColor(index: number): RgbaColor {
  if (index < DEFAULT_NATION_PALETTE.length) {
    return hexToRgbaColor(DEFAULT_NATION_PALETTE[index], BASE_COLOR_ALPHA);
  }
  const base = hexToRgbaColor(DEFAULT_NATION_PALETTE[index % DEFAULT_NATION_PALETTE.length], BASE_COLOR_ALPHA);
  const cycle = Math.floor(index / DEFAULT_NATION_PALETTE.length) + 1;
  const lighten = cycle % 2 === 1;
  const amount = Math.min(0.2 + cycle * 0.05, 0.45);
  const target = lighten ? 255 : 0;
  return {
    r: mixChannel(base.r, target, amount),
    g: mixChannel(base.g, target, amount * 0.9),
    b: mixChannel(base.b, target, amount * 0.8),
    a: BASE_COLOR_ALPHA,
  };
}

function ensureNationColor(nationId: string): RgbaColor {
  let color = nationColorAssignments.get(nationId);
  if (!color) {
    color = derivePaletteColor(paletteCursor);
    paletteCursor += 1;
    nationColorAssignments.set(nationId, color);
  }
  return color;
}

function resetNationColors(): void {
  nationColorAssignments.clear();
  paletteCursor = 0;
}

function ensureColorsForPlayers(players: string[]): void {
  for (const id of players) {
    ensureNationColor(id);
  }
}

function applyOwnershipColors(ownership: { [cellId: number]: string }): void {
  const owners = new Set(Object.values(ownership));
  for (const owner of owners) {
    if (owner) {
      ensureNationColor(owner);
    }
  }
}

function getBaseColorMap(): Record<string, RgbaColor> {
  const result: Record<string, RgbaColor> = {};
  for (const [nationId, color] of nationColorAssignments.entries()) {
    result[nationId] = color;
  }
  return result;
}

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
      currentTerritoryData = { ...gameState.cellOwnership };
      applyOwnershipColors(currentTerritoryData);
    }

    if (gameState.cellCantons) {
      currentCellCantons = { ...gameState.cellCantons };
    }

    if (gameState.nationCantons) {
      currentNationCantons = { ...gameState.nationCantons };
    }

    if (gameState.entities) {
      currentGameEntities = gameState.entities;
      console.log('Updated entities:', currentGameEntities);
    }

    renderGameState();
    updatePlannerSnapshot(gameState);
    updateStatusBarFromGameState(gameState, currentPlayerName);
    updateDebugSidebarFromGameState(gameState, currentPlayerName);
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
    resetNationColors();
    currentGameSeed = gameData.meta?.seed ?? null;
    currentGameId = gameData.meta.gameId;
    requiredPlayers = gameData.meta.nationCount ?? gameData.meta.players.length;
    currentCellCantons = gameData.state.cellCantons ? { ...gameData.state.cellCantons } : {};
    currentNationCantons = gameData.state.nationCantons ? { ...gameData.state.nationCantons } : {};
    ensureColorsForPlayers(gameData.meta.players ?? []);
    currentTerritoryData = gameData.state.cellOwnership ? { ...gameData.state.cellOwnership } : {};
    applyOwnershipColors(currentTerritoryData);
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
        updateDebugSidebarFromGameState(gameData.state, currentPlayerName);
      });
    } else {
      renderGameState();
      updatePlannerSnapshot(gameData.state);
      updateStatusBarFromGameState(gameData.state, currentPlayerName);
      updateDebugSidebarFromGameState(gameData.state, currentPlayerName);
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

  const baseColors = getBaseColorMap();
  if (Object.keys(baseColors).length === 0) {
    return;
  }

  const viewMode = getMapViewMode();
  const adjacency = viewMode === 'canton'
    ? buildCantonAdjacency(
        currentCellCantons,
        currentTerritoryData,
        meshData.cellOffsets,
        meshData.cellNeighbors,
      )
    : undefined;

  const fills = computeCellColors(viewMode, {
    cellCount: meshData.cellCount,
    cellOwnership: currentTerritoryData,
    cellCantons: currentCellCantons,
    nationCantons: currentNationCantons,
    baseColors,
    cantonAdjacency: adjacency,
    seed: currentGameSeed ?? undefined,
  });

  for (let cellId = 0; cellId < fills.length; cellId++) {
    const color = fills[cellId];
    if (!color) continue;

    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    if (start >= end) continue;

    ctx.beginPath();
    const firstVertex = meshData.cellVertexIndices[start];
    ctx.moveTo(
      meshData.allVertices[firstVertex * 2],
      meshData.allVertices[firstVertex * 2 + 1],
    );

    for (let j = start + 1; j < end; j++) {
      const vi = meshData.cellVertexIndices[j];
      ctx.lineTo(
        meshData.allVertices[vi * 2],
        meshData.allVertices[vi * 2 + 1],
      );
    }

    ctx.closePath();
    ctx.fillStyle = rgbaToCss(color);
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

