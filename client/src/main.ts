import { assignElevations, assignIslandElevations, TERRAIN_PRESETS } from './terrain-gen/elevations';
import { assignBiomes, getBiomeName } from './terrain-gen/biomes';

type MapSize = "small" | "medium" | "large" | "xl";

const WIDTH  = 960;
const HEIGHT = 600;

// Server configuration
const SERVER_BASE_URL = 'http://localhost:3000'; // Update this to match your server

// Biome color scheme
const BIOME_COLORS: { [key: number]: string } = {
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
let elevationConfig = {
  amplitudes: [0.6, 0.3, 0.15, 0.075],
  frequencies: [0.003, 0.006, 0.012, 0.024],
  octaves: 4,
  seed: Math.random(),
  redistribution: 'exponential' as const,
  exponentialPower: 1.5,
  elevationShift: -0.1,
  useIslands: false
};

// Biome configuration
let biomeConfig = {
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
    console.log(`🌐 Fetching ${size} mesh from server...`);
    console.time(`fetch-${size}`);
    
    const response = await fetch(`${SERVER_BASE_URL}/api/mesh/${size}`);
    
    // DEBUG: Log response details
    console.log(`📡 Response status: ${response.status}`);
    console.log(`📡 Response headers:`, [...response.headers.entries()]);
    console.log(`📡 Response URL: ${response.url}`);
    console.log(`📡 Response type: ${response.type}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${size} mesh: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.timeEnd(`fetch-${size}`);
    
    // DEBUG: Log data structure
    console.log(`📦 Data keys:`, Object.keys(data));
    console.log(`📦 Has meshData:`, !!data.meshData);
    console.log(`📦 MeshData keys:`, data.meshData ? Object.keys(data.meshData) : 'none');
    
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
  const sizes: MapSize[] = ['small', 'medium', 'large', 'xl'];
  
  console.log('🚀 Preloading all meshes from server...');
  
  // Start all fetches in parallel (non-blocking)
  const fetchPromises = sizes.map(async (size) => {
    try {
      await fetchMeshFromServer(size);
      updateLoadingStatus();
    } catch (error) {
      console.error(`Failed to preload ${size} mesh:`, error);
    }
  });
  
  // Don't wait for all to complete - they load in background
  Promise.all(fetchPromises).then(() => {
    console.log('🎉 All meshes preloaded!');
    updateLoadingStatus();
  });
}

/**
 * Updates UI to show loading status
 */
function updateLoadingStatus(): void {
  const sizes: MapSize[] = ['small', 'medium', 'large', 'xl'];
  const loadedCount = sizes.filter(size => meshLoadingStates.get(size) === 'loaded').length;
  const loadingCount = sizes.filter(size => meshLoadingStates.get(size) === 'loading').length;
  const errorCount = sizes.filter(size => meshLoadingStates.get(size) === 'error').length;
  
  // Update the map size selector to show loading status
  const mapSizeSelect = document.getElementById('mapSize') as HTMLSelectElement;
  if (mapSizeSelect) {
    for (const option of mapSizeSelect.options) {
      const size = option.value as MapSize;
      const state = meshLoadingStates.get(size);
      
      if (state === 'loading') {
        option.textContent = `${size.charAt(0).toUpperCase() + size.slice(1)} (Loading...)`;
        option.disabled = true;
      } else if (state === 'error') {
        option.textContent = `${size.charAt(0).toUpperCase() + size.slice(1)} (Error)`;
        option.disabled = true;
      } else if (state === 'loaded') {
        option.textContent = size.charAt(0).toUpperCase() + size.slice(1);
        option.disabled = false;
      }
    }
  }
  
  // Update stats in UI if element exists
  const statsElement = document.getElementById('loadingStats');
  if (statsElement) {
    statsElement.innerHTML = `
      Meshes: ${loadedCount}/4 loaded${loadingCount > 0 ? `, ${loadingCount} loading` : ''}${errorCount > 0 ? `, ${errorCount} failed` : ''}
    `;
  }
}

/**
 * Loads or waits for mesh data for a specific size
 */
async function loadOrGetMesh(size: MapSize): Promise<void> {
  console.time('loadOrGetMesh');
  
  // Check if mesh exists in cache
  if (meshCache.has(size)) {
    console.log(`Using cached mesh for size: ${size}`);
    meshData = meshCache.get(size)!;
    generateTerrain();
    console.timeEnd('loadOrGetMesh');
    return;
  }
  
  // Show loading state
  showLoadingIndicator(`Loading ${size} mesh...`);
  
  // Fetch from server
  const fetchedMesh = await fetchMeshFromServer(size);
  hideLoadingIndicator();
  
  if (fetchedMesh) {
    meshData = fetchedMesh;
    generateTerrain();
  } else {
    showError(`Failed to load ${size} mesh from server`);
  }
  
  console.timeEnd('loadOrGetMesh');
}

/**
 * Shows a loading indicator
 */
function showLoadingIndicator(message: string): void {
  let indicator = document.getElementById('loadingIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'loadingIndicator';
    indicator.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      z-index: 2000;
    `;
    document.body.appendChild(indicator);
  }
  indicator.textContent = message;
  indicator.style.display = 'block';
}

/**
 * Hides the loading indicator
 */
function hideLoadingIndicator(): void {
  const indicator = document.getElementById('loadingIndicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
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
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    errorElement!.style.display = 'none';
  }, 5000);
}

function drawFilledCellsByBiome(
  ctx: CanvasRenderingContext2D,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  cellBiomes: Uint8Array,
  cellNeighbors: Int32Array,
  smoothColors: boolean = true
) {
  const nCells = cellOffsets.length - 1;

  for (let cellId = 0; cellId < nCells; cellId++) {
    const start = cellOffsets[cellId];
    const end   = cellOffsets[cellId + 1];
    if (start >= end) continue;

    const biome = cellBiomes[cellId];
    let color = BIOME_COLORS[biome] || "#888888";

    // optional smoothing of fill‐colors
    if (smoothColors) {
      let totalWeight = 1;
      let r = parseInt(color.substr(1,2),16),
          g = parseInt(color.substr(3,2),16),
          b = parseInt(color.substr(5,2),16);

      const neighborCount = Math.min(3, end - start);
      for (let k = 0; k < neighborCount; k++) {
        const nbId = cellNeighbors[start + k];
        if (nbId >= 0 && nbId < nCells) {
          const nbColor = BIOME_COLORS[cellBiomes[nbId]] || "#888888";
          const weight = 0.15;
          const nr = parseInt(nbColor.substr(1,2),16),
                ng = parseInt(nbColor.substr(3,2),16),
                nb = parseInt(nbColor.substr(5,2),16);
          r += nr * weight;
          g += ng * weight;
          b += nb * weight;
          totalWeight += weight;
        }
      }
      color = `rgb(${Math.round(r/totalWeight)}, ${Math.round(g/totalWeight)}, ${Math.round(b/totalWeight)})`;
    }

    // draw cell fill
    ctx.fillStyle = color;
    ctx.beginPath();
    const v0 = cellVertexIndices[start];
    ctx.moveTo(allVertices[v0*2], allVertices[v0*2+1]);
    for (let j = start+1; j < end; j++) {
      const vi = cellVertexIndices[j];
      ctx.lineTo(allVertices[vi*2], allVertices[vi*2+1]);
    }
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth   = 0.5;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function createUI() {
  // Create UI panel
  const uiPanel = document.createElement('div');
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
        <input type="checkbox" id="useIslands" ${elevationConfig.useIslands ? 'checked' : ''}> 
        Island Mode
      </label>
    </div>

    <div style="margin-bottom: 15px;">
      <label>
        <input type="checkbox" id="smoothColors" ${biomeConfig.smoothColors ? 'checked' : ''}> 
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
    
    <div style="margin-bottom: 15px;">
      <label>Preset:</label>
      <select id="presetSelect" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
        <option value="none">Custom</option>
        <option value="rolling">Rolling Hills</option>
        <option value="mountainous" selected>Mountainous</option>
        <option value="plains">Plains</option>
        <option value="chaotic">Chaotic</option>
      </select>
    </div>

    <details style="margin-bottom: 15px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Biome Settings</summary>
      
      <div style="margin-bottom: 10px;">
        <label>Water Level: <span id="waterLevelValue">${biomeConfig.waterLevel}</span></label>
        <input type="range" id="waterLevel" min="0.2" max="0.8" step="0.05" value="${biomeConfig.waterLevel}" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Moisture Frequency: <span id="moistureFrequencyValue">${biomeConfig.moistureFrequency}</span></label>
        <input type="range" id="moistureFrequency" min="0.005" max="0.05" step="0.005" value="${biomeConfig.moistureFrequency}" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Temperature Frequency: <span id="temperatureFrequencyValue">${biomeConfig.temperatureFrequency}</span></label>
        <input type="range" id="temperatureFrequency" min="0.005" max="0.05" step="0.005" value="${biomeConfig.temperatureFrequency}" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 10px;">
        <label>Moisture Octaves: <span id="moistureOctavesValue">${biomeConfig.moistureOctaves}</span></label>
        <input type="range" id="moistureOctaves" min="1" max="5" step="1" value="${biomeConfig.moistureOctaves}" 
               style="width: 100%; margin-top: 5px;">
      </div>

      <div style="margin-bottom: 15px;">
        <label>Temperature Octaves: <span id="temperatureOctavesValue">${biomeConfig.temperatureOctaves}</span></label>
        <input type="range" id="temperatureOctaves" min="1" max="5" step="1" value="${biomeConfig.temperatureOctaves}" 
               style="width: 100%; margin-top: 5px;">
      </div>
      <hr></hr>
    </details>

    <div style="margin-bottom: 10px;">
      <label>Elevation Shift: <span id="elevationShiftValue">${elevationConfig.elevationShift}</span></label>
      <input type="range" id="elevationShift" min="-0.4" max="0.4" step="0.01" value="${elevationConfig.elevationShift}" 
             style="width: 100%; margin-top: 5px;">
    </div>
    
    <div style="margin-bottom: 10px;">
      <label>Octaves: <span id="octavesValue">${elevationConfig.octaves}</span></label>
      <input type="range" id="octaves" min="1" max="6" step="1" value="${elevationConfig.octaves}" 
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
      <label>Exponential Power: <span id="exponentialPowerValue">${elevationConfig.exponentialPower}</span></label>
      <input type="range" id="exponentialPower" min="0.5" max="3" step="0.1" value="${elevationConfig.exponentialPower}" 
             style="width: 100%; margin-top: 5px;">
    </div>
    
    <div style="margin-bottom: 10px;">
      <label>Seed:</label>
      <div style="display: flex; gap: 5px; margin-top: 5px; align-items: center;">
        <input type="number" id="seedInput" min="0" max="1" step="0.001" value="${elevationConfig.seed.toFixed(3)}" 
               style="flex: 1; background: #333; color: white; border: 1px solid #555; padding: 4px; border-radius: 4px;">
        <button id="randomSeed" style="background: #666; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Random</button>
      </div>
    </div>
    
    <details style="margin-bottom: 10px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Advanced (Amplitudes & Frequencies)</summary>
      
      <div id="amplitudesContainer">
        <label>Amplitudes:</label>
        ${elevationConfig.amplitudes.map((amp, i) => 
          `<div style="margin: 5px 0;">
            <label>Octave ${i + 1}: <span id="amp${i}Value">${amp}</span></label>
            <input type="range" id="amplitude${i}" min="0" max="1" step="0.025" value="${amp}" style="width: 100%;">
           </div>`
        ).join('')}
      </div>
      
      <div id="frequenciesContainer" style="margin-top: 10px;">
        <label>Frequencies:</label>
        ${elevationConfig.frequencies.map((freq, i) => 
          `<div style="margin: 5px 0;">
            <label>Octave ${i + 1}: <span id="freq${i}Value">${freq}</span></label>
            <input type="range" id="frequency${i}" min="0.001" max="0.05" step="0.001" value="${freq}" style="width: 100%;">
           </div>`
        ).join('')}
      </div>
    </details>
    
    <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
      <div id="loadingStats" style="margin-bottom: 5px;"></div>
      <div id="stats"></div>
      <div id="biomeStats" style="margin-top: 10px;"></div>
    </div>
  `;
  
  document.body.appendChild(uiPanel);
  
  // Map size selectors
  document.getElementById('mapSize')!.addEventListener('change', async (e) => {
    const size = (e.target as HTMLSelectElement).value as MapSize;
    if (size) {
      currentMapSize = size;
      await loadOrGetMesh(currentMapSize);
    }
  });
  
  document.getElementById('randomSeed')!.addEventListener('click', () => {
    elevationConfig.seed = Math.random();
    (document.getElementById('seedInput') as HTMLInputElement).value = elevationConfig.seed.toFixed(3);
    generateTerrain();
  });
  
  // Seed input
  document.getElementById('seedInput')!.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      elevationConfig.seed = Math.max(0, Math.min(1, value));
      generateTerrain();
    }
  });
  
  // Preset selectors
  document.getElementById('presetSelect')!.addEventListener('change', (e) => {
    const preset = (e.target as HTMLSelectElement).value;
    if (preset !== 'none' && TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS]) {
      const presetConfig = TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS];
      Object.assign(elevationConfig, presetConfig);
      updateUIFromConfig();
      generateTerrain();
    }
  });
  
  // Range inputs - all auto-regenerate
  ['elevationShift', 'octaves', 'exponentialPower'].forEach(param => {
    const element = document.getElementById(param)!;
    element.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (elevationConfig as any)[param] = param === 'octaves' ? Math.floor(value) : value;
      document.getElementById(param + 'Value')!.textContent = value.toString();
      generateTerrain();
    });
  });

  // Biome config inputs
  ['waterLevel', 'moistureFrequency', 'temperatureFrequency', 'moistureOctaves', 'temperatureOctaves'].forEach(param => {
    const element = document.getElementById(param)!;
    element.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (biomeConfig as any)[param] = ['moistureOctaves', 'temperatureOctaves'].includes(param) ? Math.floor(value) : value;
      document.getElementById(param + 'Value')!.textContent = value.toString();
      generateTerrain();
    });
  });
  
  // Redistribution
  document.getElementById('redistribution')!.addEventListener('change', (e) => {
    elevationConfig.redistribution = (e.target as HTMLSelectElement).value as any;
    document.getElementById('exponentialPowerDiv')!.style.display = 
      elevationConfig.redistribution === 'exponential' ? 'block' : 'none';
    generateTerrain();
  });
  
  // Islands checkbox
  document.getElementById('useIslands')!.addEventListener('change', (e) => {
    elevationConfig.useIslands = (e.target as HTMLInputElement).checked;
    generateTerrain();
  });

  // Smooth colors checkbox
  document.getElementById('smoothColors')!.addEventListener('change', (e) => {
    biomeConfig.smoothColors = (e.target as HTMLInputElement).checked;
    generateTerrain(); // Re-render with new color smoothing
  });
  
  // Amplitude and frequency controls - auto-regenerate
  for (let i = 0; i < 4; i++) {
    const ampElement = document.getElementById(`amplitude${i}`);
    const freqElement = document.getElementById(`frequency${i}`);
    
    if (ampElement) {
      ampElement.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.amplitudes[i] = value;
        document.getElementById(`amp${i}Value`)!.textContent = value.toString();
        generateTerrain();
      });
    }
    
    if (freqElement) {
      freqElement.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.frequencies[i] = value;
        document.getElementById(`freq${i}Value`)!.textContent = value.toString();
        generateTerrain();
      });
    }
  }
}

function updateUIFromConfig() {
  (document.getElementById('elevationShift') as HTMLInputElement).value = elevationConfig.elevationShift.toString();
  document.getElementById('elevationShiftValue')!.textContent = elevationConfig.elevationShift.toString();
  
  (document.getElementById('octaves') as HTMLInputElement).value = elevationConfig.octaves.toString();
  document.getElementById('octavesValue')!.textContent = elevationConfig.octaves.toString();
  
  (document.getElementById('exponentialPower') as HTMLInputElement).value = elevationConfig.exponentialPower.toString();
  document.getElementById('exponentialPowerValue')!.textContent = elevationConfig.exponentialPower.toString();
  
  (document.getElementById('redistribution') as HTMLSelectElement).value = elevationConfig.redistribution;
  
  for (let i = 0; i < 4; i++) {
    const ampInput = document.getElementById(`amplitude${i}`) as HTMLInputElement;
    const freqInput = document.getElementById(`frequency${i}`) as HTMLInputElement;
    if (ampInput && elevationConfig.amplitudes[i] !== undefined) {
      ampInput.value = elevationConfig.amplitudes[i].toString();
      document.getElementById(`amp${i}Value`)!.textContent = elevationConfig.amplitudes[i].toString();
    }
    if (freqInput && elevationConfig.frequencies[i] !== undefined) {
      freqInput.value = elevationConfig.frequencies[i].toString();
      document.getElementById(`freq${i}Value`)!.textContent = elevationConfig.frequencies[i].toString();
    }
  }
}

function generateTerrain() {
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

  console.time('drawFilled');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawFilledCellsByBiome(
    ctx, 
    meshData.allVertices, 
    meshData.cellOffsets, 
    meshData.cellVertexIndices, 
    cellBiomes,
    meshData.cellNeighbors,
    biomeConfig.smoothColors
  );
  console.timeEnd('drawFilled');
}

// Initialize the application
async function initializeApp() {
  console.log('🚀 Initializing terrain generator...');
  
  // Create UI first
  createUI();
  
  // Start preloading all meshes in background (non-blocking)
  preloadAllMeshes();
  
  // Load the default mesh (xl) - this will show loading indicator if needed
  await loadOrGetMesh(currentMapSize);
  
  console.log('✅ Application initialized');
}

// Start the application
initializeApp().catch(error => {
  console.error('Failed to initialize application:', error);
  showError('Failed to initialize application. Please check server connection.');
});