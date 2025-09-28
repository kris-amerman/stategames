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

let mapHighlightMode: MapHighlightMode = 'nation';
let cellCantons: Record<number, string> = {};
let cantonVisuals: Record<string, CantonVisual> = {};
let cantonTooltip: HTMLDivElement | null = null;

export type HSLColor = { h: number; s: number; l: number };

type CantonShadeCandidate = {
  index: number;
  h: number;
  s: number;
  l: number;
  alpha: number;
  color: string;
};

type PaletteClampMeta = {
  lightFloorHits: number;
  lightCeilHits: number;
  saturationFloorHits: number;
  saturationCeilHits: number;
};

type ShadeAssignmentResult = {
  palette: CantonShadeCandidate[];
  clampMeta: PaletteClampMeta;
  fillByCanton: Record<string, string>;
  adjacencyPermutation: boolean;
  assignedIndices: Record<string, number>;
};

const NATION_BASE_COLORS: Record<string, HSLColor> = {
  player1: { h: 2, s: 78, l: 52 },
  player2: { h: 218, s: 72, l: 48 },
  player3: { h: 135, s: 58, l: 46 },
  player4: { h: 48, s: 82, l: 60 },
  player5: { h: 305, s: 70, l: 56 },
  player6: { h: 184, s: 64, l: 50 },
};

const DEFAULT_BASE_COLOR: HSLColor = { h: 210, s: 28, l: 54 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(value: number): number {
  const mod = value % 360;
  return mod < 0 ? mod + 360 : mod;
}

function formatHsl(color: HSLColor, alpha: number): string {
  return `hsla(${Math.round(color.h)}, ${Math.round(color.s)}%, ${Math.round(color.l)}%, ${alpha})`;
}

function getNationBaseColor(nationId: string): HSLColor {
  return NATION_BASE_COLORS[nationId] ?? DEFAULT_BASE_COLOR;
}

function createClampMeta(): PaletteClampMeta {
  return {
    lightFloorHits: 0,
    lightCeilHits: 0,
    saturationFloorHits: 0,
    saturationCeilHits: 0,
  };
}

function clampWithMeta(
  value: number,
  min: number,
  max: number,
  meta: PaletteClampMeta,
  lowKey: keyof PaletteClampMeta,
  highKey: keyof PaletteClampMeta,
): number {
  if (value < min) {
    meta[lowKey] += 1;
  }
  if (value > max) {
    meta[highKey] += 1;
  }
  return clamp(value, min, max);
}

function hslaToHex(h: number, s: number, l: number): string {
  const hue = normalizeHue(h);
  const saturation = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (huePrime >= 0 && huePrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (huePrime >= 1 && huePrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (huePrime >= 3 && huePrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  const m = light - chroma / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  const toHex = (component: number) => component.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function buildCantonShadePalette(base: HSLColor, count: number): { palette: CantonShadeCandidate[]; clampMeta: PaletteClampMeta } {
  const palette: CantonShadeCandidate[] = [];
  const clampMeta = createClampMeta();
  if (count <= 0) {
    return { palette, clampMeta };
  }

  const hue = normalizeHue(base.h);
  const baseSaturation = clamp(base.s, 35, 90);
  const baseLightness = clamp(base.l, 30, 65);

  const lightSpread = clamp(22 + count * 2.5, 26, 48);
  let lightMin = baseLightness - lightSpread / 2;
  let lightMax = baseLightness + lightSpread / 2;
  if (lightMin < 22) lightMin = 22;
  if (lightMax > 82) lightMax = 82;
  if (lightMin >= lightMax) {
    lightMin = clamp(baseLightness - 12, 20, 74);
    lightMax = clamp(baseLightness + 12, 32, 82);
  }

  const satSpread = clamp(18 + count * 1.2, 22, 38);
  let satMin = baseSaturation - satSpread / 2;
  let satMax = baseSaturation + satSpread / 2;
  if (satMin < 32) satMin = 32;
  if (satMax > 94) satMax = 94;
  if (satMin >= satMax) {
    satMin = clamp(baseSaturation - 10, 32, 80);
    satMax = clamp(baseSaturation + 10, 40, 94);
  }

  const alpha = 0.68;

  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const oscillation = Math.sin((t - 0.5) * Math.PI);
    const targetLight = lightMin + (lightMax - lightMin) * t;
    const targetSat = satMin + (satMax - satMin) * (0.5 + oscillation * 0.5);
    const light = clampWithMeta(targetLight, 20, 85, clampMeta, 'lightFloorHits', 'lightCeilHits');
    const saturation = clampWithMeta(targetSat, 30, 96, clampMeta, 'saturationFloorHits', 'saturationCeilHits');
    palette.push({
      index,
      h: hue,
      s: saturation,
      l: light,
      alpha,
      color: `hsla(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(light)}%, ${alpha})`,
    });
  }

  return { palette, clampMeta };
}

function colorDistance(a: CantonShadeCandidate, b: CantonShadeCandidate): number {
  const ds = (a.s - b.s) / 100;
  const dl = (a.l - b.l) / 100;
  return Math.sqrt(ds * ds + dl * dl);
}

function assignCantonShades(
  cantonIds: string[],
  adjacency: Record<string, string[]>,
  palette: CantonShadeCandidate[],
): { fillByCanton: Record<string, string>; adjacencyPermutation: boolean; assignedIndices: Record<string, number> } {
  const fillByCanton: Record<string, string> = {};
  const assignedIndex: Record<string, number> = {};
  const available = palette.map((shade) => shade.index);

  for (const cantonId of cantonIds) {
    let bestIndex = -1;
    let bestScore = -1;
    for (const candidateIndex of available) {
      const candidate = palette[candidateIndex];
      const neighbors = adjacency[cantonId] ?? [];
      const neighborScores = neighbors
        .map((neighborId) => assignedIndex[neighborId])
        .filter((value) => value !== undefined)
        .map((neighborIndex) => colorDistance(candidate, palette[neighborIndex]));
      const minDistance = neighborScores.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...neighborScores);
      const score = Number.isFinite(minDistance) ? minDistance : 0;
      if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && candidateIndex < bestIndex)) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    }

    if (bestIndex === -1) {
      bestIndex = available[0];
    }

    assignedIndex[cantonId] = bestIndex;
    fillByCanton[cantonId] = palette[bestIndex].color;
    const removeAt = available.indexOf(bestIndex);
    if (removeAt >= 0) {
      available.splice(removeAt, 1);
    }
  }

  const adjacencyPermutation = cantonIds.some((id, idx) => assignedIndex[id] !== idx);
  return { fillByCanton, adjacencyPermutation, assignedIndices: assignedIndex };
}

export function generateCantonShades(base: HSLColor, count: number): string[] {
  const { palette } = buildCantonShadePalette(base, count);
  return palette.map((shade) => shade.color);
}

export function assignCantonFillColors(
  cantonIds: string[],
  base: HSLColor,
  adjacency: Record<string, string[]>,
): ShadeAssignmentResult {
  const { palette, clampMeta } = buildCantonShadePalette(base, cantonIds.length);
  const { fillByCanton, adjacencyPermutation, assignedIndices } = assignCantonShades(cantonIds, adjacency, palette);
  return { palette, clampMeta, fillByCanton, adjacencyPermutation, assignedIndices };
}

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
  const owners: Record<string, string | null> = economy.cantonOwners ?? {};
  const adjacency: Record<string, string[]> = economy.cantonAdjacency ?? {};
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
    const baseColor = getNationBaseColor(nationId);
    const shadeAssignment = assignCantonFillColors(cantonIds, baseColor, adjacency);
    const paletteHex = cantonIds.map((cantonId) => {
      const assignedIndex = shadeAssignment.assignedIndices[cantonId];
      if (assignedIndex === undefined) {
        return '#000000';
      }
      const candidate = shadeAssignment.palette[assignedIndex];
      return hslaToHex(candidate.h, candidate.s, candidate.l);
    });

    console.log('[CantonPalette]', {
      nationId,
      nationName: nation.name,
      baseColor,
      cantonCount: cantonIds.length,
      shades: paletteHex,
      clampHits: shadeAssignment.clampMeta,
      adjacencyPermutation: shadeAssignment.adjacencyPermutation,
    });
    let satelliteOrdinal = 1;

    cantonIds.forEach((cantonId, cantonIndex) => {
      const cantonState = cantonStates[cantonId];
      const cells = Array.isArray(territories[cantonId])
        ? [...territories[cantonId]]
        : [];
      const isCapital = capitalId === cantonId;
      const fillColor = shadeAssignment.fillByCanton[cantonId];
      if (!fillColor) {
        console.warn('Missing canton shade assignment, falling back to base color', {
          nationId,
          cantonId,
        });
      }
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
        fillColor: fillColor ?? formatHsl(baseColor, 0.6),
        capital: isCapital,
        urbanization,
        capacity,
        happiness,
        cells,
      };

    });
  });
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

  const territoryColorCache: Record<string, string> = {};

  for (const [cellIdStr, playerId] of Object.entries(currentTerritoryData)) {
    const cellId = parseInt(cellIdStr);
    if (!territoryColorCache[playerId]) {
      territoryColorCache[playerId] = formatHsl(getNationBaseColor(playerId), 0.3);
    }
    const color = territoryColorCache[playerId];

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

  ctx.restore();

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

