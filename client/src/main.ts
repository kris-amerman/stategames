import { assignElevations, assignIslandElevations, ElevationConfig } from './terrain-gen/elevations';
import { assignBiomes, BiomeConfig, getBiomeName } from './terrain-gen/biomes';
import { drawCells } from './drawCells';

import pako from 'pako';

let currentTerritoryData: { [cellId: string]: string } = {};
let currentGameTerrain: Uint8Array | null = null;

// WebSocket connection and game state
let socket: WebSocket | null = null;
let currentGameId: string | null = null;
let currentPlayerName: string | null = null;
let isGameCreator: boolean = false;

let currentCellBiomes: Uint8Array = new Uint8Array(0);
let currentCellCount: number = 0;

export type MapSize = "small" | "medium" | "large" | "xl";

// TODO we need to standardize/centralize this configuration between client and server
const WIDTH  = 960;
const HEIGHT = 600;

// Server configuration
const SERVER_BASE_URL: string = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

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

// TODO ship over cell count for easy calcs?
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
    console.log(`Fetching ${size} mesh from ${SERVER_BASE_URL}/api/mesh/${size}...`);
    console.time(`fetch-${size}`);
    
    const response = await fetch(`${SERVER_BASE_URL}/api/mesh/${size}`);
    
    if (!response.ok) {
      throw new Error(`❌ Failed to fetch ${size} mesh: ${response.status} ${response.statusText}`);
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
    console.log('All meshes preloaded!'); // TODO only log if successful!
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

    currentCellCount = meshData.cellOffsets.length - 1; // TODO make this calculation more graceful by sending over cellCount or something
    if (currentCellBiomes.length !== currentCellCount) {
      currentCellBiomes = new Uint8Array(currentCellCount);
    }

    generateTerrain();
    console.timeEnd('loadOrGetMesh');
    return;
  }
  
  // Fetch from server
  const fetchedMesh = await fetchMeshFromServer(size);
  
  if (fetchedMesh) {
    meshData = fetchedMesh;

    currentCellCount = meshData.cellOffsets.length - 1; // TODO make this calculation more graceful by sending over cellCount or something
    if (currentCellBiomes.length !== currentCellCount) {
      currentCellBiomes = new Uint8Array(currentCellCount);
    }

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
  const cellBiomes: Uint8Array = assignBiomes(
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
  currentCellBiomes = cellBiomes;
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
  createUI();
  
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


/**
 * ===========================================================================================
 * ======================================== CREATE UI ========================================
 * ===========================================================================================
 */

function createUI() {
  // Create UI panel
  const uiPanel = document.createElement("div");
  uiPanel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 300px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 15px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 12px;
    max-height: 90vh;
    overflow-y: auto;
    z-index: 1000;
  `;

  uiPanel.innerHTML = `
    <h3 style="margin: 0 0 15px 0; color: #4CAF50;">Biome Terrain Controls</h3>
    
    <div style="margin-bottom: 15px;">
      <label>
        <input type="checkbox" id="useIslands" ${
          elevationConfig.useIslands ? "checked" : ""
        }> 
        Island Mode
      </label>
    </div>

    <div style="margin-bottom: 15px;">
      <label>
        <input type="checkbox" id="smoothColors" ${
          biomeConfig.smoothColors ? "checked" : ""
        }> 
        Smooth Colors
      </label>
    </div>

    <div style="margin-bottom: 15px;">
      <label>Map Size:</label>
      <select id="mapSize" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
        <option value="small">Small</option>
        <option value="medium">Medium</option>
        <option value="large">Large</option>
        <option value="xl" selected>XL</option>
      </select>
    </div>

    <details style="margin-bottom: 15px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Biome Settings</summary>
      
      <div style="margin-bottom: 10px;">
        <label>Water Level: <span id="waterLevelValue">${
          biomeConfig.waterLevel
        }</span></label>
        <input type="range" id="waterLevel" min="0.2" max="0.8" step="0.05" value="${
          biomeConfig.waterLevel
        }" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Moisture Frequency: <span id="moistureFrequencyValue">${
          biomeConfig.moistureFrequency
        }</span></label>
        <input type="range" id="moistureFrequency" min="0.005" max="0.05" step="0.005" value="${
          biomeConfig.moistureFrequency
        }" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Temperature Frequency: <span id="temperatureFrequencyValue">${
          biomeConfig.temperatureFrequency
        }</span></label>
        <input type="range" id="temperatureFrequency" min="0.005" max="0.05" step="0.005" value="${
          biomeConfig.temperatureFrequency
        }" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Moisture Octaves: <span id="moistureOctavesValue">${
          biomeConfig.moistureOctaves
        }</span></label>
        <input type="range" id="moistureOctaves" min="1" max="5" step="1" value="${
          biomeConfig.moistureOctaves
        }" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 15px;">
        <label>Temperature Octaves: <span id="temperatureOctavesValue">${
          biomeConfig.temperatureOctaves
        }</span></label>
        <input type="range" id="temperatureOctaves" min="1" max="5" step="1" value="${
          biomeConfig.temperatureOctaves
        }" 
               style="width: 100%; margin-top: 5px;">
      </div>
      <hr></hr>
    </details>

    <div style="margin-bottom: 10px;">
      <label>Elevation Shift: <span id="elevationShiftValue">${
        elevationConfig.elevationShift
      }</span></label>
      <input type="range" id="elevationShift" min="-0.4" max="0.4" step="0.01" value="${
        elevationConfig.elevationShift
      }" 
             style="width: 100%; margin-top: 5px;">
    </div>
    
    <div style="margin-bottom: 10px;">
      <label>Octaves: <span id="octavesValue">${
        elevationConfig.octaves
      }</span></label>
      <input type="range" id="octaves" min="1" max="6" step="1" value="${
        elevationConfig.octaves
      }" 
             style="width: 100%; margin-top: 5px;">
    </div>
    
    <div style="margin-bottom: 10px;">
      <label>Redistribution:</label>
      <select id="redistribution" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
        <option value="none">None</option>
        <option value="linear">Linear</option>
        <option value="exponential" selected>Exponential</option>
      </select>
    </div>
    
    <div id="exponentialPowerDiv" style="margin-bottom: 10px;">
      <label>Exponential Power: <span id="exponentialPowerValue">${
        elevationConfig.exponentialPower
      }</span></label>
      <input type="range" id="exponentialPower" min="0.5" max="3" step="0.1" value="${
        elevationConfig.exponentialPower
      }" 
             style="width: 100%; margin-top: 5px;">
    </div>
    
    <div style="margin-bottom: 10px;">
      <label>Seed:</label>
      <div style="display: flex; gap: 5px; margin-top: 5px; align-items: center;">
        <input type="number" id="seedInput" min="0" max="1" step="0.001" value="${elevationConfig.seed.toFixed(
          3
        )}" 
               style="flex: 1; background: #333; color: white; border: 1px solid #555; padding: 4px; border-radius: 4px;">
        <button id="randomSeed" style="background: #666; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Random</button>
      </div>
    </div>
    
    <details style="margin-bottom: 10px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Advanced (Amplitudes & Frequencies)</summary>
      
      <div id="amplitudesContainer">
        <label>Amplitudes:</label>
        ${elevationConfig.amplitudes
          .map(
            (amp, i) =>
              `<div style="margin: 5px 0;">
            <label>Octave ${
              i + 1
            }: <span id="amp${i}Value">${amp}</span></label>
            <input type="range" id="amplitude${i}" min="0" max="1" step="0.025" value="${amp}" style="width: 100%;">
           </div>`
          )
          .join("")}
      </div>
      
      <div id="frequenciesContainer" style="margin-top: 10px;">
        <label>Frequencies:</label>
        ${elevationConfig.frequencies
          .map(
            (freq, i) =>
              `<div style="margin: 5px 0;">
            <label>Octave ${
              i + 1
            }: <span id="freq${i}Value">${freq}</span></label>
            <input type="range" id="frequency${i}" min="0.001" max="0.05" step="0.001" value="${freq}" style="width: 100%;">
           </div>`
          )
          .join("")}
      </div>
    </details>
    
    <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
      <div id="stats"></div>
      <div id="biomeStats" style="margin-top: 10px;"></div>
    </div>

    <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
      <div style="display: flex; gap: 10px; margin-bottom: 10px;">
        <button id="createGame" style="flex: 1; background: #4CAF50; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Create Game</button>
        <button id="joinGame" style="flex: 1; background: #2196F3; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Join Game</button>
      </div>
    </div>
  `;

  document.body.appendChild(uiPanel);

  // Map size selectors
  document.getElementById("mapSize")!.addEventListener("change", async (e) => {
    const size = (e.target as HTMLSelectElement).value as MapSize;
    if (size) {
      currentMapSize = size;
      await loadOrGetMesh(currentMapSize);
    }
  });

  document.getElementById("randomSeed")!.addEventListener("click", () => {
    elevationConfig.seed = Math.random();
    (document.getElementById("seedInput") as HTMLInputElement).value =
      elevationConfig.seed.toFixed(3);
    generateTerrain();
  });

  // Seed input
  document.getElementById("seedInput")!.addEventListener("input", (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      elevationConfig.seed = Math.max(0, Math.min(1, value));
      generateTerrain();
    }
  });

  // Range inputs - all auto-regenerate
  ["elevationShift", "octaves", "exponentialPower"].forEach((param) => {
    const element = document.getElementById(param)!;
    element.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (elevationConfig as any)[param] =
        param === "octaves" ? Math.floor(value) : value;
      document.getElementById(param + "Value")!.textContent = value.toString();
      generateTerrain();
    });
  });

  // Biome config inputs
  [
    "waterLevel",
    "moistureFrequency",
    "temperatureFrequency",
    "moistureOctaves",
    "temperatureOctaves",
  ].forEach((param) => {
    const element = document.getElementById(param)!;
    element.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (biomeConfig as any)[param] = [
        "moistureOctaves",
        "temperatureOctaves",
      ].includes(param)
        ? Math.floor(value)
        : value;
      document.getElementById(param + "Value")!.textContent = value.toString();
      generateTerrain();
    });
  });

  // Redistribution
  document.getElementById("redistribution")!.addEventListener("change", (e) => {
    elevationConfig.redistribution = (e.target as HTMLSelectElement)
      .value as any;
    document.getElementById("exponentialPowerDiv")!.style.display =
      elevationConfig.redistribution === "exponential" ? "block" : "none";
    generateTerrain();
  });

  // Islands checkbox
  document.getElementById("useIslands")!.addEventListener("change", (e) => {
    elevationConfig.useIslands = (e.target as HTMLInputElement).checked;
    generateTerrain();
  });

  // Smooth colors checkbox
  document.getElementById("smoothColors")!.addEventListener("change", (e) => {
    biomeConfig.smoothColors = (e.target as HTMLInputElement).checked;
    generateTerrain(); // Re-render with new color smoothing
  });

  // Amplitude and frequency controls - auto-regenerate
  for (let i = 0; i < 4; i++) {
    const ampElement = document.getElementById(`amplitude${i}`);
    const freqElement = document.getElementById(`frequency${i}`);

    if (ampElement) {
      ampElement.addEventListener("input", (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.amplitudes[i] = value;
        document.getElementById(`amp${i}Value`)!.textContent = value.toString();
        generateTerrain();
      });
    }

    if (freqElement) {
      freqElement.addEventListener("input", (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.frequencies[i] = value;
        document.getElementById(`freq${i}Value`)!.textContent =
          value.toString();
        generateTerrain();
      });
    }
  }
}













document.getElementById("createGame")!.addEventListener("click", async () => {
  console.log(`SENDING ${currentCellCount} BIOMES TO ${SERVER_BASE_URL}/api/games`);
  console.time('createGame');
  
  // Disable buttons during creation
  setGameButtonsState(false, "Creating...", "Join Game");
  
  try {
    // Compress the data
    const compressed = pako.gzip(currentCellBiomes);

    const response = await fetch(`${SERVER_BASE_URL}/api/games/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Cell-Count': currentCellCount.toString(),
        'X-Map-Size': currentMapSize,
        'Content-Encoding': 'gzip'
      },
      body: compressed
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create game: ${response.status}`);
    }
    
    const gameData = await response.json();
    console.log('Game created:', gameData);
    
    // Show creator's game state UI
    showCreatorGameUI(gameData);
    
  } catch (error) {
    console.error('Game creation failed:', error);
    // Reset buttons on error
    setGameButtonsState(true, "Create Game", "Join Game");
  }
  console.timeEnd('createGame');
});

document.getElementById("joinGame")!.addEventListener("click", () => {
  showJoinGameForm();
});

// Utility function to manage game button states
function setGameButtonsState(enabled: boolean, createText: string = "Create Game", joinText: string = "Join Game") {
  const createButton = document.getElementById("createGame") as HTMLButtonElement;
  const joinButton = document.getElementById("joinGame") as HTMLButtonElement;
  
  createButton.disabled = !enabled;
  createButton.textContent = createText;
  joinButton.disabled = !enabled;
  joinButton.textContent = joinText;
}

// Utility function to hide/show game buttons
function toggleGameButtons(visible: boolean) {
  const createButton = document.getElementById("createGame") as HTMLButtonElement;
  const joinButton = document.getElementById("joinGame") as HTMLButtonElement;
  
  createButton.style.display = visible ? "block" : "none";
  joinButton.style.display = visible ? "block" : "none";
}

// Creator's game state UI (has Start Game button)
function showCreatorGameUI(gameData: any) {
  hideAllGameUI();
  
  const gameStateDiv = createGameStateContainer();
  
  gameStateDiv.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: #4CAF50;">Game Created!</h4>
    
    <div style="margin-bottom: 10px;">
      <strong>Join Code:</strong> 
      <span style="
        font-family: monospace; 
        font-size: 16px; 
        background: rgba(255,255,255,0.1); 
        padding: 4px 8px; 
        border-radius: 4px;
        letter-spacing: 2px;
      ">${gameData.joinCode}</span>
      <button id="copyJoinCode" style="
        margin-left: 8px;
        background: #666; 
        color: white; 
        border: none; 
        padding: 4px 8px; 
        border-radius: 4px; 
        cursor: pointer;
        font-size: 11px;
      ">Copy</button>
    </div>
    
    <div style="margin-bottom: 10px;">
      <strong>Game ID:</strong> 
      <span style="font-family: monospace; font-size: 12px; color: #aaa;">${gameData.gameId}</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Status:</strong> 
      <span id="gameStatus" style="color: #FFA500;">Waiting for players...</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Players:</strong>
      <ul id="playersList" style="
        margin: 5px 0 0 0; 
        padding-left: 20px; 
        color: #ccc;
      ">
        <li>player1 (you)</li>
      </ul>
    </div>
    
    <button id="startGame" style="
      width: 100%;
      background: #666; 
      color: white; 
      border: none; 
      padding: 10px; 
      border-radius: 4px; 
      cursor: pointer;
      font-size: 14px;
    " disabled>Start Game (Need more players)</button>
  `;
  
  // Add event listeners
  setupCopyJoinCodeButton(gameData.joinCode);
  setupStartGameButton();
  
  // Join WebSocket room as creator
  joinGameRoom(gameData.gameId, 'player1', true);
  
  toggleGameButtons(false);
}

// Joiner's game state UI (no Start Game button)
function showJoinerGameUI(gameData: any) {
  hideAllGameUI();
  
  const gameStateDiv = createGameStateContainer();
  
  gameStateDiv.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: #4CAF50;">Joined Game!</h4>
    
    <div style="margin-bottom: 10px;">
      <strong>Game ID:</strong> 
      <span style="font-family: monospace; font-size: 12px; color: #aaa;">${gameData.gameId}</span>
    </div>
    
    <div style="margin-bottom: 10px;">
      <strong>Your Player:</strong> 
      <span style="color: #4CAF50;">${gameData.playerName}</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Status:</strong> 
      <span id="gameStatus" style="color: #FFA500;">Waiting for game to start...</span>
    </div>
    
    <div style="margin-bottom: 15px;">
      <strong>Players:</strong>
      <ul id="playersList" style="
        margin: 5px 0 0 0; 
        padding-left: 20px; 
        color: #ccc;
      ">
        ${gameData.players.map((player: string) => 
          `<li>${player}${player === gameData.playerName ? ' (you)' : ''}</li>`
        ).join('')}
      </ul>
    </div>
    
    <div style="
      padding: 10px;
      background: rgba(255, 193, 7, 0.2);
      border: 1px solid #FFC107;
      border-radius: 4px;
      text-align: center;
      color: #FFC107;
      font-size: 14px;
    "
    id="waitingForStart">
      Waiting for the host to start the game...
    </div>
  `;
  
  // Join WebSocket room as joiner
  joinGameRoom(gameData.gameId, gameData.playerName, false);
  
  toggleGameButtons(false);
}

function showJoinGameForm() {
  hideAllGameUI();
  toggleGameButtons(false);
  
  let joinFormDiv = document.getElementById("joinGameForm");
  
  if (!joinFormDiv) {
    joinFormDiv = document.createElement("div");
    joinFormDiv.id = "joinGameForm";
    joinFormDiv.style.cssText = `
      margin-top: 15px;
      padding: 15px;
      background: rgba(0, 0, 100, 0.2);
      border: 1px solid #2196F3;
      border-radius: 8px;
    `;
    
    // Insert after the buttons
    const buttonsDiv = document.querySelector('#createGame')!.parentElement;
    buttonsDiv!.parentNode!.insertBefore(joinFormDiv, buttonsDiv!.nextSibling);
  }
  
  joinFormDiv.style.display = "block";
  joinFormDiv.innerHTML = `
    <h4 style="margin: 0 0 15px 0; color: #2196F3;">Join Game</h4>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px;">Enter Join Code:</label>
      <input type="text" id="joinCodeInput" placeholder="ABC123" style="
        width: 100%;
        padding: 10px;
        background: #333;
        color: white;
        border: 1px solid #555;
        border-radius: 4px;
        font-family: monospace;
        font-size: 16px;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-align: center;
        box-sizing: border-box;
      " maxlength="6">
    </div>
    
    <div style="display: flex; gap: 10px;">
      <button id="submitJoinCode" style="
        flex: 1;
        background: #2196F3;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 4px;
        cursor: pointer;
      ">Join</button>
      
      <button id="cancelJoinForm" style="
        flex: 1;
        background: #666;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 4px;
        cursor: pointer;
      ">Cancel</button>
    </div>
    
    <div id="joinError" style="
      margin-top: 10px;
      color: #f44336;
      font-size: 12px;
      display: none;
    "></div>
  `;
  
  // Auto-format join code input
  const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
  joinCodeInput.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  
  // Handle Enter key
  joinCodeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleJoinGameSubmit();
    }
  });
  
  // Focus the input
  setTimeout(() => joinCodeInput.focus(), 100);
  
  // Add event listeners
  document.getElementById("submitJoinCode")!.addEventListener("click", handleJoinGameSubmit);
  document.getElementById("cancelJoinForm")!.addEventListener("click", cancelJoinForm);
}

function cancelJoinForm() {
  hideAllGameUI();
  setGameButtonsState(true);
  toggleGameButtons(true);
}

async function handleJoinGameSubmit() {
  const joinCodeInput = document.getElementById("joinCodeInput") as HTMLInputElement;
  const submitButton = document.getElementById("submitJoinCode") as HTMLButtonElement;
  const errorDiv = document.getElementById("joinError")!;
  
  const joinCode = joinCodeInput.value.trim();
  
  if (!joinCode || joinCode.length < 3) {
    showJoinError("Please enter a valid join code");
    return;
  }
  
  // Disable button during request
  submitButton.disabled = true;
  submitButton.textContent = "Joining...";
  errorDiv.style.display = "none";
  
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/games/${joinCode}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const gameData = await response.json();
    console.log('Successfully joined game:', gameData);
    
    showJoinerGameUI(gameData);
    
  } catch (error: any) {
    console.error('Failed to join game:', error);
    showJoinError(error.message || 'Failed to join game');
    
    // Re-enable button
    submitButton.disabled = false;
    submitButton.textContent = "Join";
  }
}

// Utility functions
function hideAllGameUI() {
  const gameStateDiv = document.getElementById("gameState");
  const joinFormDiv = document.getElementById("joinGameForm");
  
  if (gameStateDiv) gameStateDiv.style.display = "none";
  if (joinFormDiv) joinFormDiv.style.display = "none";
}

function createGameStateContainer() {
  let gameStateDiv = document.getElementById("gameState");
  
  if (!gameStateDiv) {
    gameStateDiv = document.createElement("div");
    gameStateDiv.id = "gameState";
    gameStateDiv.style.cssText = `
      margin-top: 15px;
      padding: 15px;
      background: rgba(0, 100, 0, 0.2);
      border: 1px solid #4CAF50;
      border-radius: 8px;
    `;
    
    const buttonsDiv = document.querySelector('#createGame')!.parentElement;
    buttonsDiv!.parentNode!.insertBefore(gameStateDiv, buttonsDiv!.nextSibling);
  }
  
  gameStateDiv.style.display = "block";
  return gameStateDiv;
}

function setupCopyJoinCodeButton(joinCode: string) {
  document.getElementById("copyJoinCode")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(joinCode);
      const button = document.getElementById("copyJoinCode") as HTMLButtonElement;
      const originalText = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy join code:', err);
    }
  });
}

function setupStartGameButton() {
  document.getElementById("startGame")!.addEventListener("click", async () => {
    if (!currentGameId) {
      console.error('No current game ID');
      return;
    }

    const startButton = document.getElementById("startGame") as HTMLButtonElement;
    startButton.disabled = true;
    startButton.textContent = "Starting...";

    try {
      const response = await fetch(`${SERVER_BASE_URL}/api/games/${currentGameId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const gameData = await response.json();
      console.log('Game started successfully:', gameData);
      
      // The WebSocket will handle the UI update via 'game_started' event
      
    } catch (error: any) {
      console.error('Failed to start game:', error);
      showGameNotification(error.message || 'Failed to start game', 'error');
      
      // Re-enable button on error
      startButton.disabled = false;
      startButton.textContent = "Start Game";
    }
  });
}

function showJoinError(message: string) {
  const errorDiv = document.getElementById("joinError")!;
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

function updatePlayersList(players: string[], currentPlayerName?: string) {
  const playersList = document.getElementById("playersList");
  if (playersList) {
    playersList.innerHTML = players.map((player) => 
      `<li>${player}${player === currentPlayerName || (currentPlayerName === undefined && player === 'player1') ? ' (you)' : ''}</li>`
    ).join('');
    
    // Only update start game button if it exists (creator only)
    const startButton = document.getElementById("startGame") as HTMLButtonElement;
    if (startButton) {
      if (players.length >= 2) {
        startButton.disabled = false;
        startButton.textContent = "Start Game";
        startButton.style.background = "#4CAF50";
      } else {
        startButton.disabled = true;
        startButton.textContent = "Start Game (Need more players)";
        startButton.style.background = "#666";
      }
    }
  }
}














// Initialize WebSocket connection
function initializeWebSocket() {
  if (socket) {
    socket.close();
  }
  
  // Convert HTTP URL to WebSocket URL
  const wsUrl = SERVER_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';

  console.log(`Connecting to WebSocket at: ${wsUrl}`);
  
  socket = new WebSocket(wsUrl);
  
  // Connection events
  socket.onopen = () => {
    console.log('Connected to game server');
  };
  
  socket.onclose = (event) => {
    console.log('Disconnected from game server:', event.code, event.reason);
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket connection error:', error);
  };
  
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(message: { event: string, data: any }) {
  const { event, data } = message;
  
  switch (event) {
    case 'player_joined':
      handlePlayerJoined(data);
      break;
      
    case 'game_state_update':
      handleGameStateUpdate(data);
      break;
      
    case 'game_started':
      handleGameStarted(data);
      break;
      
    case 'game_error':
      handleGameError(data);
      break;
      
    default:
      console.log(`Unknown WebSocket event: ${event}`);
  }
}

// Send WebSocket message
function sendWebSocketMessage(event: string, data: any) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ event, data }));
  } else {
    console.error('WebSocket not connected');
  }
}

// Handle player joining
function handlePlayerJoined(data: { gameId: string, players: string[], newPlayer: string }) {
  console.log('Player joined:', data);
  
  if (data.gameId === currentGameId) {
    // Update the player list in real-time
    updatePlayersList(data.players, currentPlayerName || undefined);
    
    // Show notification for new player
    showGameNotification(`${data.newPlayer} joined the game!`, 'success');
  }
}

// Handle game state updates
function handleGameStateUpdate(data: { gameId: string, status: string, players: string[] }) {
  console.log('Game state update:', data);
  
  if (data.gameId === currentGameId) {
    updateGameStatus(data.status);
    updatePlayersList(data.players, currentPlayerName || undefined);
  }
}

// Handle game start
function handleGameStarted(data: any) {
  console.log('Game started with complete data:', data);
  
  if (data.gameId === currentGameId) {
    updateGameStatus('in_progress');
    showGameNotification('Game has started!', 'success');

    const startButton = document.getElementById("startGame") as HTMLButtonElement;
    if (startButton) startButton.remove();

    const waitingForStartDiv = document.getElementById("waitingForStart");
    if (waitingForStartDiv) waitingForStartDiv.style.display = "none";
    
    // Process all the game data received in the WebSocket event
    processGameData(data);
  }
}

// Handle errors
function handleGameError(data: { error: string, gameId?: string }) {
  console.error('Game error:', data);
  
  if (!data.gameId || data.gameId === currentGameId) {
    showGameNotification(data.error, 'error');
  }
}

// Join a game room via WebSocket
function joinGameRoom(gameId: string, playerName: string, creator: boolean = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }
  
  currentGameId = gameId;
  currentPlayerName = playerName;
  isGameCreator = creator;
  
  sendWebSocketMessage('join_game_room', {
    gameId: gameId,
    playerName: playerName,
    isCreator: creator
  });
  
  console.log(`Joined game room: ${gameId} as ${playerName} (creator: ${creator})`);
}

// Leave current game room
function leaveGameRoom() {
  if (!socket || !currentGameId) return;
  
  sendWebSocketMessage('leave_game_room', {
    gameId: currentGameId,
    playerName: currentPlayerName
  });
  
  console.log(`Left game room: ${currentGameId}`);
  
  currentGameId = null;
  currentPlayerName = null;
  isGameCreator = false;
}

// Initialize WebSocket when the page loads
document.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket();
});

// Clean up WebSocket connection when leaving
window.addEventListener('beforeunload', () => {
  leaveGameRoom();
  if (socket) {
    socket.close();
  }
});








// Utility function to show game notifications
function showGameNotification(message: string, type: 'success' | 'warning' | 'error' = 'success') {
  // Create notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    border-radius: 6px;
    color: white;
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 2000;
    opacity: 0;
    transition: opacity 0.3s ease;
    max-width: 400px;
    text-align: center;
  `;
  
  // Set color based on type
  switch (type) {
    case 'success':
      notification.style.background = 'rgba(76, 175, 80, 0.9)';
      break;
    case 'warning':
      notification.style.background = 'rgba(255, 193, 7, 0.9)';
      break;
    case 'error':
      notification.style.background = 'rgba(244, 67, 54, 0.9)';
      break;
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 100);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Update game status display
function updateGameStatus(status: string) {
  const statusElement = document.getElementById('gameStatus');
  if (!statusElement) return;
  
  switch (status) {
    case 'waiting':
      statusElement.textContent = 'Waiting for players...';
      statusElement.style.color = '#FFA500';
      break;
    case 'in_progress':
      statusElement.textContent = 'Game in progress';
      statusElement.style.color = '#4CAF50';
      break;
    case 'finished':
      statusElement.textContent = 'Game finished';
      statusElement.style.color = '#666';
      break;
    default:
      statusElement.textContent = status;
      statusElement.style.color = '#FFA500';
  }
}















/**
 * Fetches complete game data (terrain + territories) from server
 * Used for reconnections and page refreshes
 */
async function fetchGameData(gameId: string): Promise<void> {
  try {
    console.log(`Fetching game data for game ${gameId}...`);
    
    // Use the single endpoint with terrain parameter
    const response = await fetch(`${SERVER_BASE_URL}/api/games/${gameId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch game data: ${response.status}`);
    }
    
    const gameData = await response.json();
    console.log('Received game data from HTTP:', gameData);
    
    // Process the received data
    processGameData(gameData);
    
  } catch (error: any) {
    console.error('Failed to fetch game data:', error);
    showError(`Failed to load game data: ${error.message}`);
  }
}

/**
 * Processes game data received from either WebSocket or HTTP
 */
function processGameData(gameData: any): void {
  try {
    // Store game information
    currentGameId = gameData.gameId;
    currentTerritoryData = gameData.territoryData;
    
    // Decode terrain data from base64
    const terrainBuffer = Uint8Array.from(atob(gameData.terrain), c => c.charCodeAt(0));
    currentGameTerrain = terrainBuffer;
    
    // Verify terrain data matches expected size
    if (terrainBuffer.length !== gameData.cellCount) {
      throw new Error(`Terrain data size mismatch: expected ${gameData.cellCount}, got ${terrainBuffer.length}`);
    }
    
    console.log(`✅ Game data processed: ${gameData.cellCount} cells, ${Object.keys(gameData.territoryData).length} owned cells`);
    
    // Update the current biomes with the game terrain
    currentCellBiomes = terrainBuffer;
    currentCellCount = gameData.cellCount;
    
    // Update the map size to match the game
    currentMapSize = gameData.mapSize as MapSize;
    
    // Load the appropriate mesh if we don't have it
    if (!meshData || meshData.cellOffsets.length - 1 !== gameData.cellCount) {
      console.log(`Loading ${gameData.mapSize} mesh for game...`);
      loadOrGetMesh(gameData.mapSize as MapSize).then(() => {
        renderGameState();
      });
    } else {
      // Render immediately if we have the right mesh
      renderGameState();
    }
    
  } catch (error: any) {
    console.error('Failed to process game data:', error);
    showError(`Failed to process game data: ${error.message}`);
  }
}

/**
 * Renders the current game state with terrain and territories
 */
function renderGameState(): void {
  if (!meshData || !currentGameTerrain) {
    console.warn('Cannot render game state: missing mesh data or terrain');
    return;
  }
  
  console.time('renderGameState');
  
  // Use the game terrain instead of generated terrain
  const cellBiomes = currentGameTerrain;
  
  // Draw the base terrain
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
  
  // Overlay territory ownership
  drawTerritoryOverlay();
  
  console.timeEnd('renderGameState');
}

/**
 * Draws territory ownership overlay on the map
 */
function drawTerritoryOverlay(): void {
  if (!meshData || Object.keys(currentTerritoryData).length === 0) {
    return;
  }
  
  // Territory colors for each player
  const territoryColors: { [playerId: string]: string } = {
    'player1': 'rgba(255, 0, 0, 0.3)',   // Red
    'player2': 'rgba(0, 0, 255, 0.3)',   // Blue
    'player3': 'rgba(0, 255, 0, 0.3)',   // Green
    'player4': 'rgba(255, 255, 0, 0.3)', // Yellow
    'player5': 'rgba(255, 0, 255, 0.3)', // Magenta
    'player6': 'rgba(0, 255, 255, 0.3)', // Cyan
  };
  
  // Draw territory ownership
  for (const [cellIdStr, playerId] of Object.entries(currentTerritoryData)) {
    const cellId = parseInt(cellIdStr);
    const color = territoryColors[playerId] || 'rgba(128, 128, 128, 0.3)';
    
    // Get cell boundaries
    const start = meshData.cellOffsets[cellId];
    const end = meshData.cellOffsets[cellId + 1];
    
    if (start >= end) continue;
    
    // Draw territory overlay
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

// Add a function to refresh game data (useful for reconnecting players)
async function refreshGameData(): Promise<void> {
  if (currentGameId) {
    await fetchGameData(currentGameId);
  }
}