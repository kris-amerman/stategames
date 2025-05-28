import Delaunator from 'delaunator';
import { generatePoints } from './point-generation';
import { DualMesh } from './dual-mesh';
import { assignElevations, assignIslandElevations, TERRAIN_PRESETS } from './landmasses';
import { assignBiomes, getBiomeName } from './biomes';

const WIDTH  = 960;
const HEIGHT = 600;
const RADIUS_OPTIONS = {
  'small': 20,
  'medium': 15,
  'large': 10,
  'xl': 5
};

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

const mesh = new DualMesh(WIDTH, HEIGHT);

let meshConfig = {
  radius: RADIUS_OPTIONS['large'] // default
}

export type MeshData = {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellTriangleCenters: Float64Array;
  cellGeometricCenters: Float64Array;
};

// Global state for mesh data (persist between elevation updates)
let meshData: MeshData | null = null;

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

// Helper function to blend two colors
function blendColors(color1: string, color2: string, ratio: number): string {
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  
  const r1 = parseInt(hex1.substr(0, 2), 16);
  const g1 = parseInt(hex1.substr(2, 2), 16);
  const b1 = parseInt(hex1.substr(4, 2), 16);
  
  const r2 = parseInt(hex2.substr(0, 2), 16);
  const g2 = parseInt(hex2.substr(2, 2), 16);
  const b2 = parseInt(hex2.substr(4, 2), 16);
  
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  
  return `rgb(${r}, ${g}, ${b})`;
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
    const end = cellOffsets[cellId + 1];
    
    if (start >= end) continue;
    
    const biome = cellBiomes[cellId];
    let color = BIOME_COLORS[biome] || "#888888";
    
    // Color smoothing: blend with neighbor colors
    if (smoothColors && cellNeighbors && meshData) {
      const neighborStart = meshData.cellOffsets[cellId];
      const neighborEnd = meshData.cellOffsets[cellId + 1];
      
      if (neighborEnd > neighborStart) {
        let totalWeight = 1;
        let r = parseInt(color.substr(1, 2), 16);
        let g = parseInt(color.substr(3, 2), 16);
        let b = parseInt(color.substr(5, 2), 16);
        
        // Sample a few neighbors for blending
        const maxNeighbors = Math.min(3, neighborEnd - neighborStart);
        for (let i = 0; i < maxNeighbors; i++) {
          const neighborIdx = neighborStart + i;
          if (neighborIdx < neighborEnd) {
            const neighborId = cellNeighbors[neighborIdx];
            if (neighborId >= 0 && neighborId < nCells) {
              const neighborBiome = cellBiomes[neighborId];
              const neighborColor = BIOME_COLORS[neighborBiome] || "#888888";
              
              const weight = 0.15; // Light blending to maintain distinct biomes
              const nr = parseInt(neighborColor.substr(1, 2), 16);
              const ng = parseInt(neighborColor.substr(3, 2), 16);
              const nb = parseInt(neighborColor.substr(5, 2), 16);
              
              r += nr * weight;
              g += ng * weight;
              b += nb * weight;
              totalWeight += weight;
            }
          }
        }
        
        r = Math.round(r / totalWeight);
        g = Math.round(g / totalWeight);
        b = Math.round(b / totalWeight);
        
        color = `rgb(${r}, ${g}, ${b})`;
      }
    }
    
    ctx.fillStyle = color;
    ctx.beginPath();
    
    const firstVertexIndex = cellVertexIndices[start];
    const firstX = allVertices[firstVertexIndex * 2];
    const firstY = allVertices[firstVertexIndex * 2 + 1];
    ctx.moveTo(firstX, firstY);
    
    for (let j = start + 1; j < end; j++) {
      const vertexIndex = cellVertexIndices[j];
      const x = allVertices[vertexIndex * 2];
      const y = allVertices[vertexIndex * 2 + 1];
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();

    // Subtle stroke to avoid gaps
    ctx.lineWidth = 0.5;
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
      <button id="newMesh" style="
        background: #4CAF50; 
        color: white; 
        border: none; 
        padding: 8px 16px; 
        border-radius: 4px; 
        cursor: pointer;
        width: 100%;
      ">Generate New Mesh</button>
    </div>
    
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
        <option value="large" selected>Large</option>
        <option value="xl">XL</option>
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
      <div id="stats"></div>
      <div id="biomeStats" style="margin-top: 10px;"></div>
    </div>
  `;
  
  document.body.appendChild(uiPanel);
  
  // Event listeners
  document.getElementById('newMesh')!.addEventListener('click', generateNewMesh);

  // Map size selectors
  document.getElementById('mapSize')!.addEventListener('change', (e) => {
    const size = (e.target as HTMLSelectElement).value;
    if (size !== 'none' && RADIUS_OPTIONS[size as keyof typeof RADIUS_OPTIONS]) {
      const radius = RADIUS_OPTIONS[size as keyof typeof RADIUS_OPTIONS];
      meshConfig['radius'] = radius;
      generateNewMesh();
    }
  });
  
  document.getElementById('randomSeed')!.addEventListener('click', () => {
    elevationConfig.seed = Math.random();
    (document.getElementById('seedInput') as HTMLInputElement).value = elevationConfig.seed.toFixed(3);
    regenerateElevations();
  });
  
  // Seed input
  document.getElementById('seedInput')!.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      elevationConfig.seed = Math.max(0, Math.min(1, value));
      regenerateElevations();
    }
  });
  
  // Preset selectors
  document.getElementById('presetSelect')!.addEventListener('change', (e) => {
    const preset = (e.target as HTMLSelectElement).value;
    if (preset !== 'none' && TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS]) {
      const presetConfig = TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS];
      Object.assign(elevationConfig, presetConfig);
      updateUIFromConfig();
      regenerateElevations();
    }
  });
  
  // Range inputs - all auto-regenerate
  ['elevationShift', 'octaves', 'exponentialPower'].forEach(param => {
    const element = document.getElementById(param)!;
    element.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (elevationConfig as any)[param] = param === 'octaves' ? Math.floor(value) : value;
      document.getElementById(param + 'Value')!.textContent = value.toString();
      regenerateElevations();
    });
  });

  // Biome config inputs
  ['waterLevel', 'moistureFrequency', 'temperatureFrequency', 'moistureOctaves', 'temperatureOctaves'].forEach(param => {
    const element = document.getElementById(param)!;
    element.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (biomeConfig as any)[param] = ['moistureOctaves', 'temperatureOctaves'].includes(param) ? Math.floor(value) : value;
      document.getElementById(param + 'Value')!.textContent = value.toString();
      regenerateElevations();
    });
  });
  
  // Redistribution
  document.getElementById('redistribution')!.addEventListener('change', (e) => {
    elevationConfig.redistribution = (e.target as HTMLSelectElement).value as any;
    document.getElementById('exponentialPowerDiv')!.style.display = 
      elevationConfig.redistribution === 'exponential' ? 'block' : 'none';
    regenerateElevations();
  });
  
  // Islands checkbox
  document.getElementById('useIslands')!.addEventListener('change', (e) => {
    elevationConfig.useIslands = (e.target as HTMLInputElement).checked;
    regenerateElevations();
  });

  // Smooth colors checkbox
  document.getElementById('smoothColors')!.addEventListener('change', (e) => {
    biomeConfig.smoothColors = (e.target as HTMLInputElement).checked;
    regenerateElevations();
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
        regenerateElevations();
      });
    }
    
    if (freqElement) {
      freqElement.addEventListener('input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.frequencies[i] = value;
        document.getElementById(`freq${i}Value`)!.textContent = value.toString();
        regenerateElevations();
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

function generateNewMesh() {
  console.time('fullRender');
  
  console.time('pointGeneration');
  const points: Float64Array = generatePoints({ x: WIDTH, y: HEIGHT }, meshConfig.radius);
  console.timeEnd('pointGeneration');
  
  console.log(`Generated ${points.length / 2} points`);

  console.time('triangulation');
  const delaunay = new Delaunator(points);
  console.timeEnd('triangulation');
  
  console.log(`Created ${delaunay.triangles.length / 3} triangles`);

  console.time('meshUpdate');
  meshData = mesh.update(points, delaunay);
  console.timeEnd('meshUpdate');

  regenerateElevations();
  console.timeEnd('fullRender');
}

function regenerateElevations() {
  if (!meshData) return;
  
  console.time('assignElevations');
  const elevationFunction = elevationConfig.useIslands ? assignIslandElevations : assignElevations;
  const cellElevations = elevationFunction(meshData.cellGeometricCenters, elevationConfig);
  console.timeEnd('assignElevations');

  console.time('assignBiomes');
  const cellBiomes = assignBiomes(
    meshData.cellGeometricCenters,
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
    Water: ${100 - landPercentage}% (${waterCells} cells)
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

// Initialize
createUI();
generateNewMesh();