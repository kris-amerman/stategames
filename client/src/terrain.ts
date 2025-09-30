import { assignElevations, assignIslandElevations, ElevationConfig } from './terrain-gen/elevations';
import { assignBiomes, BiomeConfig, getBiomeName } from './terrain-gen/biomes';
import { drawCells } from './drawCells';
import { drawRivers } from './drawRivers';
import { loadMesh, preloadAllMeshes, MapSize, MeshData } from './mesh';
import { WIDTH, HEIGHT, SERVER_BASE_URL } from './config';
import {
  generateRivers,
  RiverGenerationResult,
  RiverPath,
  RiverControls,
} from './terrain-gen/rivers';

export let meshData: MeshData | null = null;
export let currentMapSize: MapSize = 'xl';
export let currentCellCount = 0;
export let currentCellBiomes: Uint8Array = new Uint8Array(0);
export let currentRiverFlags: Uint8Array = new Uint8Array(0);
export let currentRivers: RiverPath[] = [];
export let lastRiverGeneration: RiverGenerationResult | null = null;

export let elevationConfig: ElevationConfig = {
  amplitudes: [0.6, 0.3, 0.15, 0.075],
  frequencies: [0.003, 0.006, 0.012, 0.024],
  octaves: 4,
  seed: Math.random(),
  waterLevel: 0.5,
  redistribution: 'exponential',
  exponentialPower: 1.5,
  elevationShift: -0.1,
  useIslands: false,
};

export let biomeConfig: BiomeConfig = {
  waterLevel: 0.5,
  moistureFrequency: 0.02,
  moistureAmplitude: 1.0,
  moistureOctaves: 3,
  temperatureFrequency: 0.015,
  temperatureAmplitude: 1.0,
  temperatureOctaves: 2,
  smoothColors: true,
};

export const terrainControls: RiverControls = {
  riverCount: 8,
  minRiverLength: 8,
  allowNewLakes: true,
};

export function setCurrentCellBiomes(data: Uint8Array) {
  currentCellBiomes = data;
}

export function setCurrentCellCount(count: number) {
  currentCellCount = count;
}

export function setCurrentMapSize(size: MapSize) {
  currentMapSize = size;
}

export async function loadOrGetMesh(size: MapSize, ctx: CanvasRenderingContext2D): Promise<void> {
  console.time('loadOrGetMesh');

  const fetchedMesh = await loadMesh(size, SERVER_BASE_URL);

  if (fetchedMesh) {
    meshData = fetchedMesh;

    currentCellCount = meshData.cellCount;
    if (currentCellBiomes.length !== currentCellCount) {
      currentCellBiomes = new Uint8Array(currentCellCount);
    }

    generateTerrain(ctx);
  } else {
    showError(`Failed to load ${size} mesh from server`);
  }

  console.timeEnd('loadOrGetMesh');
}

export function generateTerrain(ctx: CanvasRenderingContext2D): void {
  if (!meshData) {
    console.warn('No mesh data available for terrain generation');
    return;
  }

  if (!meshData.cellTriangleCenters) {
    console.warn('No triangle cell centers');
  }

  console.log(meshData);

  console.time('assignElevations');
  const elevationFunction = elevationConfig.useIslands ? assignIslandElevations : assignElevations;
  const cellElevations = elevationFunction(meshData.cellTriangleCenters, elevationConfig);
  console.timeEnd('assignElevations');

  console.time('assignBiomes');
  const cellBiomes: Uint8Array = assignBiomes(
    meshData.cellTriangleCenters,
    cellElevations,
    meshData.cellNeighbors,
    meshData.cellOffsets,
    biomeConfig.waterLevel,
    {
      frequency: biomeConfig.moistureFrequency,
      amplitude: biomeConfig.moistureAmplitude,
      octaves: biomeConfig.moistureOctaves,
    },
    {
      frequency: biomeConfig.temperatureFrequency,
      amplitude: biomeConfig.temperatureAmplitude,
      octaves: biomeConfig.temperatureOctaves,
    }
  );
  currentCellBiomes = cellBiomes;
  console.timeEnd('assignBiomes');

  console.time('generateRivers');
  lastRiverGeneration = generateRivers(
    cellElevations,
    meshData.cellNeighbors,
    meshData.cellOffsets,
    biomeConfig.waterLevel,
    terrainControls
  );
  currentRiverFlags = lastRiverGeneration.riverFlags;
  currentRivers = lastRiverGeneration.rivers;
  for (const log of lastRiverGeneration.logs) {
    console.info(log);
  }
  console.timeEnd('generateRivers');

  // Calculate stats
  const landCells = cellElevations.filter((e) => e >= biomeConfig.waterLevel).length;
  const waterCells = cellElevations.length - landCells;
  const landPercentage = Math.round((landCells / cellElevations.length) * 100);

  // Calculate biome distribution
  const biomeCounts: { [key: number]: number } = {};
  for (let i = 0; i < cellBiomes.length; i++) {
    const biome = cellBiomes[i];
    biomeCounts[biome] = (biomeCounts[biome] || 0) + 1;
  }

  const biomeStatsHtml = Object.entries(biomeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([biomeId, count]) => {
      const percentage = Math.round((count / cellBiomes.length) * 100);
      return `${getBiomeName(parseInt(biomeId))}: ${percentage}%`;
    })
    .join('<br>');

  const riverSummary = lastRiverGeneration
    ? `${lastRiverGeneration.generated}/${lastRiverGeneration.requested}`
    : '0/0';

  document.getElementById('stats')!.innerHTML = `
    Land: ${landPercentage}% (${landCells} cells)<br>
    Water: ${100 - landPercentage}% (${waterCells} cells)<br>
    Rivers: ${riverSummary}<br>
    Mesh: ${currentMapSize} (${meshData.cellCount} cells)
  `;

  document.getElementById('biomeStats')!.innerHTML = `
    <strong>Top Biomes:</strong><br>
    ${biomeStatsHtml}
  `;

  console.time('drawCells');
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
  console.timeEnd('drawCells');

  drawRivers(ctx, meshData, currentRivers);
}

export function preloadMeshes(): void {
  preloadAllMeshes(SERVER_BASE_URL);
}

export function showError(message: string): void {
  let errorElement = document.getElementById('errorMessage');
  if (!errorElement) {
    errorElement = document.createElement('div');
    errorElement.id = 'errorMessage';
    errorElement.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #f44336;
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      font-family: Arial, sans-serif;
      z-index: 2000;
    `;
    document.body.appendChild(errorElement);
  }
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}
