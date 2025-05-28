import Delaunator from 'delaunator';
import { generatePoints } from './point-generation';
import { DualMesh } from './dual-mesh';
import { assignElevations, assignIslandElevations, TERRAIN_PRESETS } from './landmasses';

const WIDTH  = 960;
const HEIGHT = 600;
const RADIUS_OPTIONS = {
  'small': 20,
  'medium': 15,
  'large': 10,
  'xl': 5
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
  radius: 5
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

function drawFilledCellsByElevation(
  ctx: CanvasRenderingContext2D,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  cellElevations: Float64Array,
  waterColor: string = '#2c5aa0',
  landColor: string = '#7cb342'
) {
  const nCells = cellOffsets.length - 1;
  for (let cellId = 0; cellId < nCells; cellId++) {
    const start = cellOffsets[cellId];
    const end = cellOffsets[cellId + 1];
    
    if (start >= end) continue;
    
    const elevation = cellElevations[cellId];
    
    // Create gradient colors based on elevation
    if (elevation < 0.5) {
      // Water: deeper = darker blue
      const intensity = Math.max(0.3, elevation * 2);
      const blue = Math.floor(160 * intensity);
      const green = Math.floor(90 * intensity);
      ctx.fillStyle = `rgb(44, ${green}, ${blue})`;
    } else {
      // Land: higher = lighter green/brown
      const landHeight = (elevation - 0.5) * 2;
      if (landHeight > 0.7) {
        // Mountains: brown/gray
        const intensity = Math.min(1, landHeight);
        const val = Math.floor(80 + 100 * intensity);
        ctx.fillStyle = `rgb(${val}, ${val - 20}, ${val - 40})`;
      } else {
        // Hills/plains: green
        const intensity = Math.max(0.4, landHeight);
        const green = Math.floor(124 + 60 * intensity);
        const red = Math.floor(66 + 40 * intensity);
        ctx.fillStyle = `rgb(${red}, ${green}, 66)`;
      }
    }
    
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

    ctx.lineWidth    = 1;
    ctx.lineJoin     = 'round';       // helps avoid little miter spikes
    ctx.strokeStyle  = ctx.fillStyle; // exactly the same as your fill
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
    <h3 style="margin: 0 0 15px 0; color: #4CAF50;">Terrain Controls</h3>
    
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
    
    <div style="margin-bottom: 10px;">
      <label>Elevation Shift: <span id="elevationShiftValue">${elevationConfig.elevationShift}</span></label>
      <input type="range" id="elevationShift" min="-0.4" max="0.4" step="0.05" value="${elevationConfig.elevationShift}" 
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
      <div>Water Level: 0.5 (fixed)</div>
      <div id="stats"></div>
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

  // Calculate stats
  const landCells = cellElevations.filter(e => e >= 0.5).length;
  const waterCells = cellElevations.length - landCells;
  const landPercentage = Math.round((landCells / cellElevations.length) * 100);
  
  document.getElementById('stats')!.innerHTML = `
    Land: ${landPercentage}% (${landCells} cells)<br>
    Water: ${100 - landPercentage}% (${waterCells} cells)
  `;
  
  console.time('drawFilled');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawFilledCellsByElevation(ctx, meshData.allVertices, meshData.cellOffsets, meshData.cellVertexIndices, cellElevations);
  console.timeEnd('drawFilled');
}

// Initialize
createUI();
generateNewMesh();