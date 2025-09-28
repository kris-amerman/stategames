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

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

export let isMyTurn = false;
export let selectedUnitId: number | null = null;
export let selectedCellId: number | null = null;

export let currentGameEntities: { [entityId: number]: any } = {};
export let currentTerritoryData: { [cellId: number]: string } = {};
export let currentGameTerrain: Uint8Array | null = null;

export type MapHighlightMode = 'nation' | 'canton';

interface CantonVisual {
  id: string;
  nationId: string;
  nationName: string;
  name: string;
  fillColor: string;
  capital: boolean;
  urbanization: number | null;
  capacity: number;
  happiness: number | null;
  cells: number[];
}

interface NationOutlineRing {
  points: number[]; // flattened [x0, y0, x1, y1, ...]
}

interface NationOutline {
  nationId: string;
  rings: NationOutlineRing[];
}

let mapHighlightMode: MapHighlightMode = 'nation';
let cellCantons: Record<number, string> = {};
let cantonVisuals: Record<string, CantonVisual> = {};
let cantonTooltip: HTMLDivElement | null = null;
let nationCellMembership: Record<string, number[]> = {};
let nationOutlineCache: Record<string, NationOutline> = {};

export let currentGameId: string | null = null;
export let currentPlayerName: string | null = null;
export let isGameCreator = false;
export let requiredPlayers = 2;

export function initGame(gameCanvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  canvas = gameCanvas;
  ctx = context;

  canvas.addEventListener('click', handleCellClick);
  canvas.addEventListener('mousemove', handleCanvasHover);
  canvas.addEventListener('mouseleave', hideCantonTooltip);
  ensureCantonTooltip();

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

export function setMapHighlightMode(mode: MapHighlightMode): void {
  if (mapHighlightMode === mode) return;
  mapHighlightMode = mode;
  if (mode === 'nation') {
    hideCantonTooltip();
  }
  renderGameState();
}

export function getMapHighlightMode(): MapHighlightMode {
  return mapHighlightMode;
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

    ingestCantonData(gameState);
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

    ingestCantonData(gameData.state);
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

function ingestCantonData(gameState: any): void {
  cellCantons = {};
  cantonVisuals = {};
  nationCellMembership = {};
  nationOutlineCache = {};

  const cellMap = gameState?.cellCantons ?? {};
  for (const [cellKey, cantonId] of Object.entries(cellMap)) {
    const parsed = Number(cellKey);
    if (!Number.isNaN(parsed) && typeof cantonId === 'string') {
      cellCantons[parsed] = cantonId;
    }
  }

  const economy = gameState?.economy ?? {};
  const territories: Record<string, number[]> = economy.cantonTerritories ?? {};
  const cantonStates: Record<string, any> = economy.cantons ?? {};
  const nations: Record<string, any> = gameState?.nations ?? {};

  const nationIds = Object.keys(nations).sort();
  nationIds.forEach((nationId, index) => {
    const nation = nations[nationId];
    if (!nation) return;
    const capitalId = typeof nation.capitalCanton === 'string' ? nation.capitalCanton : null;
    const cantonIds = Object.entries(owners)
      .filter(([, owner]) => owner === nationId)
      .map(([id]) => id)
      .sort();
    if (capitalId) {
      const index = cantonIds.indexOf(capitalId);
      if (index >= 0) {
        cantonIds.splice(index, 1);
        cantonIds.unshift(capitalId);
      } else {
        cantonIds.unshift(capitalId);
      }
    }
    const baseHue = (index * 137 + 23) % 360;
    let satelliteOrdinal = 1;
    const nationCells: number[] = [];

    cantonIds.forEach((cantonId, cantonIndex) => {
      const cantonState = cantonStates[cantonId];
      const cells = Array.isArray(territories[cantonId])
        ? [...territories[cantonId]]
        : [];
      const isCapital = capitalId === cantonId;
      const fillColor = computeCantonFillColor(baseHue, cantonIndex, cantonIds.length);
      const capacity = Object.values(cantonState?.sectors ?? {}).reduce(
        (sum: number, sector: any) => sum + (sector?.capacity ?? 0),
        0,
      );
      const urbanization = typeof cantonState?.urbanizationLevel === 'number'
        ? cantonState.urbanizationLevel
        : null;
      const happiness = typeof cantonState?.happiness === 'number'
        ? cantonState.happiness
        : null;
      const name = isCapital
        ? `${nation.name} Capital`
        : `${nation.name} Canton ${satelliteOrdinal++}`;

      cantonVisuals[cantonId] = {
        id: cantonId,
        nationId,
        nationName: nation.name,
        name,
        fillColor,
        capital: isCapital,
        urbanization,
        capacity,
        happiness,
        cells,
      };

      nationCells.push(...cells);
    });

    if (nationCells.length > 0) {
      nationCellMembership[nationId] = nationCells;
    }
  });
}

function computeCantonFillColor(baseHue: number, index: number, total: number): string {
  const hue = (baseHue + (index * 47) % 360) % 360;
  const saturation = 68;
  const lightnessBase = 58 - Math.min(18, index * 6);
  const lightness = Math.max(28, lightnessBase);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.55)`;
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
  if (!meshData) {
    return;
  }

  if (mapHighlightMode === 'canton') {
    drawCantonOverlay();
    return;
  }

  if (Object.keys(currentTerritoryData).length === 0) {
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

function drawCantonOverlay(): void {
  if (!meshData) return;
  if (Object.keys(cantonVisuals).length === 0) return;

  ctx.save();
  const nCells = meshData.cellCount;

  for (let cellId = 0; cellId < nCells; cellId++) {
    const cantonId = cellCantons[cellId];
    if (!cantonId) continue;
    const visual = cantonVisuals[cantonId];
    if (!visual) continue;

    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    if (start >= end) continue;

    ctx.fillStyle = visual.fillColor;
    ctx.beginPath();
    const v0 = meshData.cellVertexIndices[start];
    ctx.moveTo(meshData.allVertices[v0 * 2], meshData.allVertices[v0 * 2 + 1]);
    for (let idx = start + 1; idx < end; idx++) {
      const vi = meshData.cellVertexIndices[idx];
      ctx.lineTo(meshData.allVertices[vi * 2], meshData.allVertices[vi * 2 + 1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawNationOutlines();

  ctx.restore();

}

function drawNationOutlines(): void {
  if (!meshData) return;
  ensureNationOutlines();
  const outlines = Object.values(nationOutlineCache);
  if (outlines.length === 0) return;

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(20, 20, 20, 0.85)';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const outline of outlines) {
    for (const ring of outline.rings) {
      const points = ring.points;
      if (points.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) {
        ctx.lineTo(points[i], points[i + 1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function ensureNationOutlines(): void {
  if (!meshData) return;
  for (const [nationId, cells] of Object.entries(nationCellMembership)) {
    if (nationOutlineCache[nationId]) continue;
    nationOutlineCache[nationId] = {
      nationId,
      rings: buildNationOutlineRings(new Set(cells)),
    };
  }
}

function buildNationOutlineRings(cells: Set<number>): NationOutlineRing[] {
  if (!meshData) return [];
  const { cellOffsets, cellVertexIndices, cellNeighbors, allVertices } = meshData;

  const adjacency = new Map<number, number[]>();

  const addEdge = (from: number, to: number) => {
    if (!adjacency.has(from)) {
      adjacency.set(from, []);
    }
    adjacency.get(from)!.push(to);
  };

  for (const cellId of cells) {
    const start = cellOffsets[cellId];
    const end = cellOffsets[cellId + 1];
    if (start >= end) continue;

    for (let i = start; i < end; i++) {
      const neighbor = cellNeighbors[i];
      if (neighbor >= 0 && cells.has(neighbor)) {
        continue;
      }
      const fromVertex = cellVertexIndices[i];
      const nextIndex = i + 1 < end ? i + 1 : start;
      const toVertex = cellVertexIndices[nextIndex];
      addEdge(fromVertex, toVertex);
    }
  }

  const rings: NationOutlineRing[] = [];
  const totalEdges = Array.from(adjacency.values()).reduce((sum, arr) => sum + arr.length, 0);

  const takeNextEdge = (from: number): number | undefined => {
    const list = adjacency.get(from);
    if (!list || list.length === 0) {
      return undefined;
    }
    const next = list.shift();
    if (!list.length) {
      adjacency.delete(from);
    }
    return next;
  };

  while (adjacency.size > 0) {
    const iterator = adjacency.entries().next();
    if (iterator.done || !iterator.value) {
      break;
    }
    const [startVertex] = iterator.value;

    const ringVertexIndices: number[] = [];
    let currentVertex = startVertex;
    let guard = 0;
    let closed = false;

    while (guard < totalEdges * 2) {
      ringVertexIndices.push(currentVertex);
      const nextVertex = takeNextEdge(currentVertex);
      if (nextVertex === undefined) {
        break;
      }
      currentVertex = nextVertex;
      guard++;
      if (currentVertex === startVertex) {
        closed = true;
        break;
      }
    }

    if (!closed || ringVertexIndices.length < 3) {
      continue;
    }

    const coords = ringVertexIndices.map((vertexIndex) => [
      allVertices[vertexIndex * 2],
      allVertices[vertexIndex * 2 + 1],
    ]);

    const simplified = simplifyRing(coords);
    if (simplified.length < 3) {
      continue;
    }

    const flattened: number[] = [];
    for (const [x, y] of simplified) {
      flattened.push(x, y);
    }
    rings.push({ points: flattened });
  }

  return rings;
}

function simplifyRing(points: number[][]): number[][] {
  if (points.length <= 3) {
    return points;
  }

  const simplified: number[][] = [];
  const len = points.length;
  const tolerance = 1e-6;

  for (let i = 0; i < len; i++) {
    const prev = points[(i - 1 + len) % len];
    const curr = points[i];
    const next = points[(i + 1) % len];

    const dx1 = curr[0] - prev[0];
    const dy1 = curr[1] - prev[1];
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];
    const cross = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(cross) < tolerance) {
      continue;
    }

    simplified.push(curr);
  }

  return simplified.length >= 3 ? simplified : points;
}

function getCellPolygon(cellId: number): { x: number; y: number }[] {
  if (!meshData) return [];
  const polygon: { x: number; y: number }[] = [];
  const start = meshData.cellOffsets[cellId];
  const end = meshData.cellOffsets[cellId + 1];
  for (let idx = start; idx < end; idx++) {
    const vi = meshData.cellVertexIndices[idx];
    polygon.push({
      x: meshData.allVertices[vi * 2],
      y: meshData.allVertices[vi * 2 + 1],
    });
  }
  return polygon;
}

function ensureCantonTooltip(): void {
  if (cantonTooltip) return;
  const tooltip = document.createElement('div');
  tooltip.id = 'cantonTooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.background = 'rgba(20, 20, 20, 0.9)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '8px 10px';
  tooltip.style.borderRadius = '6px';
  tooltip.style.fontSize = '12px';
  tooltip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
  tooltip.style.display = 'none';
  tooltip.style.zIndex = '1000';
  tooltip.style.maxWidth = '240px';
  document.body.appendChild(tooltip);
  cantonTooltip = tooltip;
}

function handleCanvasHover(event: MouseEvent): void {
  if (mapHighlightMode !== 'canton') {
    hideCantonTooltip();
    return;
  }
  if (!meshData) return;

  ensureCantonTooltip();
  if (!cantonTooltip) return;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const cellId = findCellAtPosition(x, y);
  if (cellId === -1) {
    hideCantonTooltip();
    return;
  }
  const cantonId = cellCantons[cellId];
  if (!cantonId) {
    hideCantonTooltip();
    return;
  }
  const visual = cantonVisuals[cantonId];
  if (!visual) {
    hideCantonTooltip();
    return;
  }
  updateCantonTooltip(event.clientX, event.clientY, visual);
}

function hideCantonTooltip(): void {
  if (cantonTooltip) {
    cantonTooltip.style.display = 'none';
  }
}

function updateCantonTooltip(screenX: number, screenY: number, visual: CantonVisual): void {
  ensureCantonTooltip();
  if (!cantonTooltip) return;

  const title = visual.capital ? `${visual.name} (Capital)` : visual.name;
  const happiness = formatDecimal(visual.happiness);
  const ul = formatInteger(visual.urbanization);
  const capacity = visual.capacity;

  cantonTooltip.innerHTML = `
    <div style="font-weight:600; font-size:13px; margin-bottom:2px;">${title}</div>
    <div style="font-size:12px; color:#ccc;">${visual.nationName}</div>
    <div style="font-size:11px; color:#eee; margin-top:6px;">UL: ${ul} · Capacity: ${capacity} · Happiness: ${happiness}</div>
  `;

  cantonTooltip.style.display = 'block';
  const offsetX = 14;
  const offsetY = 18;
  let left = screenX + offsetX;
  let top = screenY + offsetY;
  const tooltipRect = cantonTooltip.getBoundingClientRect();
  if (left + tooltipRect.width > window.innerWidth - 12) {
    left = screenX - tooltipRect.width - offsetX;
  }
  if (top + tooltipRect.height > window.innerHeight - 12) {
    top = screenY - tooltipRect.height - offsetY;
  }
  cantonTooltip.style.left = `${Math.max(8, left)}px`;
  cantonTooltip.style.top = `${Math.max(8, top)}px`;
}

function formatInteger(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return Math.round(value).toString();
}

function formatDecimal(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(1);
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

