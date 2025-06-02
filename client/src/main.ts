import { assignElevations, assignIslandElevations, ElevationConfig } from './terrain-gen/elevations';
import { assignBiomes, BiomeConfig, getBiomeName } from './terrain-gen/biomes';
import { createUI } from './createUI';
import { drawCells } from './drawCells';

export type MapSize = "small" | "medium" | "large" | "xl";

// TODO we need to standardize/centralize this configuration between client and server
const WIDTH  = 960;
const HEIGHT = 600;

// Server configuration
const SERVER_BASE_URL = process.env.VITE_SERVER_URL || 'http://localhost:3000';

// Biome color scheme
export const BIOME_COLORS: { [key: number]: string } = {
  0: "#88aa55",   // Plains - Grassland
  1: "#679459",   // Woods - Temperate Deciduous Forest
  2: "#337755",   // Rainforest - Tropical Rain Forest
  3: "#2f6666",   // Wetlands - Marsh
  4: "#889977",   // Hills - Shrubland
  5: "#888888",   // Mountains - Bare
  6: "#44447a",   // Shallow Ocean - Ocean
  7: "#33335a",   // Deep Ocean - (darker)
  8: "#bbbbaa",   // Tundra Plains - Tundra
  9: "#99aa77",   // Tundra Woods - Taiga
  10: "#bbbbaa",  // Tundra Hills - Tundra
  11: "#ffffff",  // Tundra Mountains - Ice
  12: "#d2b98b",  // Desert Plains - Subtropical Desert
  13: "#c9d29b",  // Desert Hills - Temperate Desert
  14: "#555555"   // Desert Mountains - Scorched
};

// set up canvas
const canvas = document.createElement('canvas');
const container = document.getElementById('canvas-container')!;
container.appendChild(canvas);
canvas.width  = WIDTH;
canvas.height = HEIGHT;

const ctx = canvas.getContext('2d')!;

export type MeshData = {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellTriangleCenters: Float64Array;
};

// Mesh cache - stores fetched meshes from server
const meshCache = new Map<MapSize, MeshData>();
const meshLoadingStates = new Map<MapSize, 'loading' | 'loaded' | 'error'>();

// Current mesh data
let meshData: MeshData | null = null;
let currentMapSize: MapSize = 'xl';

// Current elevation configuration
let elevationConfig: ElevationConfig = {
  amplitudes: [0.6, 0.3, 0.15, 0.075],
  frequencies: [0.003, 0.006, 0.012, 0.024],
  octaves: 4,
  seed: Math.random(),
  waterLevel: 0.5,
  redistribution: 'exponential' as const,
  exponentialPower: 1.5,
  elevationShift: -0.1,
  useIslands: false
};

// Biome configuration
let biomeConfig: BiomeConfig = {
  waterLevel: 0.5,
  moistureFrequency: 0.02,
  moistureAmplitude: 1.0,
  moistureOctaves: 3,
  temperatureFrequency: 0.015,
  temperatureAmplitude: 1.0,
  temperatureOctaves: 2,
  smoothColors: true
};

/**
 * Deserializes mesh data from server response back to TypedArrays
 */
function deserializeMeshData(serialized: any): MeshData {
  return {
    allVertices: new Float64Array(serialized.allVertices),
    cellOffsets: new Uint32Array(serialized.cellOffsets),
    cellVertexIndices: new Uint32Array(serialized.cellVertexIndices),
    cellNeighbors: new Int32Array(serialized.cellNeighbors),
    cellTriangleCenters: new Float64Array(serialized.cellTriangleCenters),
  };
}

/**
 * Fetches mesh data from the server for a specific size
 */
async function fetchMeshFromServer(size: MapSize): Promise<MeshData | null> {
  if (meshLoadingStates.get(size) === 'loading') {
    // Already loading, wait for it to complete
    while (meshLoadingStates.get(size) === 'loading') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return meshCache.get(size) || null;
  }

  meshLoadingStates.set(size, 'loading');

  try {
    console.log(`Fetching ${size} mesh from server...`);
    console.time(`fetch-${size}`);
    
    const response = await fetch(`${SERVER_BASE_URL}/api/mesh/${size}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${size} mesh: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.timeEnd(`fetch-${size}`);

    // Deserialize the mesh data
    const meshData = deserializeMeshData(data.meshData);
    
    // Cache the mesh
    meshCache.set(size, meshData);
    meshLoadingStates.set(size, 'loaded');
    
    console.log(`✅ Loaded ${size} mesh: ${data.meta?.cellCount || 'unknown'} cells`);
    
    return meshData;
  } catch (error) {
    console.error(`❌ Failed to fetch ${size} mesh:`, error);
    meshLoadingStates.set(size, 'error');
    return null;
  }
}

/**
 * Preloads all mesh sizes from the server (non-blocking)
 */
async function preloadAllMeshes(): Promise<void> {
  const sizes: MapSize[] = ['small', 'medium', 'large', 'xl']; // TODO this is stinky
  
  console.log('Preloading all meshes from server...');
  
  // Start all fetches in parallel (non-blocking)
  const fetchPromises = sizes.map(async (size) => {
    try {
      await fetchMeshFromServer(size);
    } catch (error) {
      console.error(`Failed to preload ${size} mesh:`, error);
    }
  });
  
  // Don't wait for all to complete - they load in background
  Promise.all(fetchPromises).then(() => {
    console.log('All meshes preloaded!');
  });
}

/**
 * Loads or waits for mesh data for a specific size
 */
export async function loadOrGetMesh(size: MapSize): Promise<void> {
  console.time('loadOrGetMesh');
  
  // Check if mesh exists in cache
  if (meshCache.has(size)) {
    console.log(`Using cached mesh for size: ${size}`);
    meshData = meshCache.get(size)!;
    generateTerrain();
    console.timeEnd('loadOrGetMesh');
    return;
  }
  
  // Fetch from server
  const fetchedMesh = await fetchMeshFromServer(size);
  
  if (fetchedMesh) {
    meshData = fetchedMesh;
    generateTerrain();
  } else {
    showError(`Failed to load ${size} mesh from server`);
  }
  
  console.timeEnd('loadOrGetMesh');
}

/**
 * Shows an error message
 */
function showError(message: string): void {
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

export function generateTerrain() {
  if (!meshData) {
    console.warn('No mesh data available for terrain generation');
    return;
  }
  
  console.time('assignElevations');
  const elevationFunction = elevationConfig.useIslands ? assignIslandElevations : assignElevations;
  const cellElevations = elevationFunction(meshData.cellTriangleCenters, elevationConfig);
  console.timeEnd('assignElevations');

  console.time('assignBiomes');
  const cellBiomes = assignBiomes(
    meshData.cellTriangleCenters,
    cellElevations,
    meshData.cellNeighbors,
    meshData.cellOffsets,
    biomeConfig.waterLevel,
    {
      frequency: biomeConfig.moistureFrequency,
      amplitude: biomeConfig.moistureAmplitude,
      octaves: biomeConfig.moistureOctaves
    },
    {
      frequency: biomeConfig.temperatureFrequency,
      amplitude: biomeConfig.temperatureAmplitude,
      octaves: biomeConfig.temperatureOctaves
    }
  );
  console.timeEnd('assignBiomes');

  // Calculate stats
  const landCells = cellElevations.filter(e => e >= biomeConfig.waterLevel).length;
  const waterCells = cellElevations.length - landCells;
  const landPercentage = Math.round((landCells / cellElevations.length) * 100);
  
  // Calculate biome distribution
  const biomeCounts: { [key: number]: number } = {};
  for (let i = 0; i < cellBiomes.length; i++) {
    const biome = cellBiomes[i];
    biomeCounts[biome] = (biomeCounts[biome] || 0) + 1;
  }
  
  const biomeStatsHtml = Object.entries(biomeCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 6) // Show top 6 biomes
    .map(([biomeId, count]) => {
      const percentage = Math.round((count / cellBiomes.length) * 100);
      return `${getBiomeName(parseInt(biomeId))}: ${percentage}%`;
    })
    .join('<br>');
  
  document.getElementById('stats')!.innerHTML = `
    Land: ${landPercentage}% (${landCells} cells)<br>
    Water: ${100 - landPercentage}% (${waterCells} cells)<br>
    Mesh: ${currentMapSize} (${meshData.cellTriangleCenters.length / 2} cells)
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
}

// Initialize the application
async function initializeApp() {
  console.log('Initializing app...');
  
  // Create UI first
  createUI(elevationConfig, biomeConfig, currentMapSize);
  
  // Start preloading all meshes in background (non-blocking)
  preloadAllMeshes();
  
  // Load the default mesh (xl)
  await loadOrGetMesh(currentMapSize);
  
  console.log('✅ Application initialized');
}

// Start the application
initializeApp().catch(error => {
  console.error('Failed to initialize application:', error);
  showError('Failed to initialize application. Please check console.');
});