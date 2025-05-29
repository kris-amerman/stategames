// import Delaunator from 'delaunator';
// import { generatePoints } from './point-generation';
// import { DualMesh } from './dual-mesh';
// import { assignElevations, assignIslandElevations, TERRAIN_PRESETS } from './landmasses';
// import { assignBiomes, getBiomeName } from './biomes';
// import { findCoastlineCells } from './coastlines';
// import { GameWorld, Entity } from './game-world';

// const WIDTH  = 960;
// const HEIGHT = 600;
// const RADIUS_OPTIONS = {
//   'small': 20,
//   'medium': 15,
//   'large': 10,
//   'xl': 5
// };

// // Biome color scheme
// const BIOME_COLORS: { [key: number]: string } = {
//   0: "#88aa55",   // Plains - Grassland
//   1: "#679459",   // Woods - Temperate Deciduous Forest
//   2: "#337755",   // Rainforest - Tropical Rain Forest
//   3: "#2f6666",   // Wetlands - Marsh
//   4: "#889977",   // Hills - Shrubland
//   5: "#888888",   // Mountains - Bare
//   6: "#44447a",   // Shallow Ocean - Ocean
//   7: "#33335a",   // Deep Ocean - (darker)
//   8: "#bbbbaa",   // Tundra Plains - Tundra
//   9: "#99aa77",   // Tundra Woods - Taiga
//   10: "#bbbbaa",  // Tundra Hills - Tundra
//   11: "#ffffff",  // Tundra Mountains - Ice
//   12: "#d2b98b",  // Desert Plains - Subtropical Desert
//   13: "#c9d29b",  // Desert Hills - Temperate Desert
//   14: "#555555"   // Desert Mountains - Scorched
// };

// // Entity colors and shapes
// const ENTITY_STYLES = {
//   'village': { color: '#FFD700', shape: 'square', size: 8 },
//   'unit': { color: '#FF4444', shape: 'circle', size: 6 },
//   'resource': { color: '#44FF44', shape: 'triangle', size: 6 },
//   'monster': { color: '#AA44AA', shape: 'diamond', size: 7 }
// };

// // set up canvas
// const canvas = document.createElement('canvas');
// const container = document.getElementById('canvas-container')!;
// container.appendChild(canvas);
// canvas.width  = WIDTH;
// canvas.height = HEIGHT;

// const ctx = canvas.getContext('2d')!;

// const mesh = new DualMesh(WIDTH, HEIGHT);

// let meshConfig = {
//   radius: RADIUS_OPTIONS['large'] // default
// }

// export type MeshData = {
//   allVertices: Float64Array;
//   cellOffsets: Uint32Array;
//   cellVertexIndices: Uint32Array;
//   cellNeighbors: Int32Array;
//   cellTriangleCenters: Float64Array;
//   cellGeometricCenters: Float64Array;
// };

// // Global state for mesh data (persist between elevation updates)
// let meshData: MeshData | null = null;
// let gameWorld: GameWorld | null = null;

// // Game interaction state
// let gameMode: 'terrain' | 'game' = 'terrain';
// let selectedEntityType = 'unit';
// let selectedEntity: number | null = null;
// let cellBiomes: Uint8Array | null = null;
// let cellElevations: Float64Array | null = null;

// // Current elevation configuration
// let elevationConfig = {
//   amplitudes: [0.6, 0.3, 0.15, 0.075],
//   frequencies: [0.003, 0.006, 0.012, 0.024],
//   octaves: 4,
//   seed: Math.random(),
//   redistribution: 'exponential' as const,
//   exponentialPower: 1.5,
//   elevationShift: -0.1,
//   useIslands: false
// };

// // Biome configuration
// let biomeConfig = {
//   waterLevel: 0.5,
//   moistureFrequency: 0.02,
//   moistureAmplitude: 1.0,
//   moistureOctaves: 3,
//   temperatureFrequency: 0.015,
//   temperatureAmplitude: 1.0,
//   temperatureOctaves: 2,
//   smoothColors: true
// };

// function drawFilledCellsByBiome(
//   ctx: CanvasRenderingContext2D,
//   allVertices: Float64Array,
//   cellOffsets: Uint32Array,
//   cellVertexIndices: Uint32Array,
//   cellBiomes: Uint8Array,
//   cellNeighbors: Int32Array,
//   smoothColors: boolean = true
// ) {
//   const nCells = cellOffsets.length - 1;

//   // 1) collect all land-boundary segments
//   const coastSegments: [number, number][] = [];

//   for (let cellId = 0; cellId < nCells; cellId++) {
//     const start = cellOffsets[cellId];
//     const end   = cellOffsets[cellId + 1];
//     if (start >= end) continue;

//     // — fill & subtle stroke as before —
//     const biome = cellBiomes[cellId];
//     let color = BIOME_COLORS[biome] || "#888888";

//     // optional smoothing of fill‐colors
//     if (smoothColors) {
//       let totalWeight = 1;
//       let r = parseInt(color.substr(1,2),16),
//           g = parseInt(color.substr(3,2),16),
//           b = parseInt(color.substr(5,2),16);

//       const neighborCount = Math.min(3, end - start);
//       for (let k = 0; k < neighborCount; k++) {
//         const nbId = cellNeighbors[start + k];
//         if (nbId >= 0 && nbId < nCells) {
//           const nbColor = BIOME_COLORS[cellBiomes[nbId]] || "#888888";
//           const weight = 0.15;
//           const nr = parseInt(nbColor.substr(1,2),16),
//                 ng = parseInt(nbColor.substr(3,2),16),
//                 nb = parseInt(nbColor.substr(5,2),16);
//           r += nr * weight;
//           g += ng * weight;
//           b += nb * weight;
//           totalWeight += weight;
//         }
//       }
//       color = `rgb(${Math.round(r/totalWeight)}, ${Math.round(g/totalWeight)}, ${Math.round(b/totalWeight)})`;
//     }

//     // draw cell fill
//     ctx.fillStyle = color;
//     ctx.beginPath();
//     const v0 = cellVertexIndices[start];
//     ctx.moveTo(allVertices[v0*2], allVertices[v0*2+1]);
//     for (let j = start+1; j < end; j++) {
//       const vi = cellVertexIndices[j];
//       ctx.lineTo(allVertices[vi*2], allVertices[vi*2+1]);
//     }
//     ctx.closePath();
//     ctx.fill();

//     ctx.lineWidth   = 0.5;
//     ctx.strokeStyle = color;
//     ctx.stroke();

//     // — collect black‐stroke segments only for land cells —
//     const thisIsWater = (biome === 6 || biome === 7);
//     if (!thisIsWater) {
//       for (let i = start; i < end; i++) {
//         const nb = cellNeighbors[i];
//         let drawEdge = false;

//         // outer boundary
//         if (nb < 0) {
//           drawEdge = true;
//         } else {
//           // coastline: neighbor must be water
//           const nbIsWater = (cellBiomes[nb] === 6 || cellBiomes[nb] === 7);
//           if (nbIsWater) drawEdge = true;
//         }

//         if (drawEdge) {
//           const viA = cellVertexIndices[i];
//           const nxt = (i+1 < end ? i+1 : start);
//           const viB = cellVertexIndices[nxt];
//           coastSegments.push([viA, viB]);
//         }
//       }
//     }
//   }

//   // 2) build adjacency map
//   const adj = new Map<number, number[]>();
//   for (const [u,v] of coastSegments) {
//     if (!adj.has(u)) adj.set(u, []);
//     if (!adj.has(v)) adj.set(v, []);
//     adj.get(u)!.push(v);
//     adj.get(v)!.push(u);
//   }

//   // 3) extract each closed loop
//   const loops: number[][] = [];
//   const usedEdge = new Set<string>();

//   for (const startV of adj.keys()) {
//     const nbrs = adj.get(startV)!;
//     if (nbrs.every(nb => usedEdge.has(`${startV}->${nb}`))) continue;

//     const loop: number[] = [startV];
//     let prev = startV, curr = nbrs[0];

//     while (curr !== startV) {
//       loop.push(curr);
//       usedEdge.add(`${prev}->${curr}`);
//       const [a,b] = adj.get(curr)!;
//       const nxt = (a === prev ? b : a);
//       prev = curr;
//       curr = nxt;
//     }
//     loops.push(loop);
//   }

//   // 4) helper: stroke one loop with cubic Béziers (Catmull–Rom→Bezier)
//   function strokeSmoothLoop(loop: number[]) {
//     const pts = loop.map(vi => ({
//       x: allVertices[vi*2],
//       y: allVertices[vi*2 + 1]
//     }));
//     const n = pts.length;
//     if (n < 2) return;

//     ctx.beginPath();
//     ctx.moveTo(pts[0].x, pts[0].y);

//     for (let i = 0; i < n; i++) {
//       const p0 = pts[(i - 1 + n) % n];
//       const p1 = pts[i];
//       const p2 = pts[(i + 1) % n];
//       const p3 = pts[(i + 2) % n];

//       const cp1x = p1.x + (p2.x - p0.x) / 6;
//       const cp1y = p1.y + (p2.y - p0.y) / 6;
//       const cp2x = p2.x - (p3.x - p1.x) / 6;
//       const cp2y = p2.y - (p3.y - p1.y) / 6;

//       ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
//     }

//     ctx.closePath();
//     ctx.stroke();
//   }

//   // 5) stroke every loop in one go
//   ctx.lineWidth   = 2;
//   ctx.strokeStyle = "black";
//   for (const loop of loops) {
//     strokeSmoothLoop(loop);
//   }
// }

// function drawEntities(ctx: CanvasRenderingContext2D) {
//   if (!gameWorld || !meshData) return;

//   const entities = gameWorld.getEntitiesByType('village')
//     .concat(gameWorld.getEntitiesByType('unit'))
//     .concat(gameWorld.getEntitiesByType('resource'))
//     .concat(gameWorld.getEntitiesByType('monster'));

//   for (const entity of entities) {
//     const style = ENTITY_STYLES[entity.type as keyof typeof ENTITY_STYLES] || ENTITY_STYLES.unit;
//     const cellCenter = getCellCenter(entity.cellId);
    
//     ctx.save();
    
//     // Highlight selected entity
//     if (selectedEntity === entity.id) {
//       ctx.strokeStyle = '#FFFFFF';
//       ctx.lineWidth = 3;
//       ctx.beginPath();
//       ctx.arc(cellCenter.x, cellCenter.y, style.size + 4, 0, Math.PI * 2);
//       ctx.stroke();
//     }
    
//     ctx.fillStyle = style.color;
    
//     switch (style.shape) {
//       case 'circle':
//         ctx.beginPath();
//         ctx.arc(cellCenter.x, cellCenter.y, style.size, 0, Math.PI * 2);
//         ctx.fill();
//         break;
//       case 'square':
//         ctx.fillRect(cellCenter.x - style.size/2, cellCenter.y - style.size/2, style.size, style.size);
//         break;
//       case 'triangle':
//         ctx.beginPath();
//         ctx.moveTo(cellCenter.x, cellCenter.y - style.size);
//         ctx.lineTo(cellCenter.x - style.size, cellCenter.y + style.size);
//         ctx.lineTo(cellCenter.x + style.size, cellCenter.y + style.size);
//         ctx.closePath();
//         ctx.fill();
//         break;
//       case 'diamond':
//         ctx.beginPath();
//         ctx.moveTo(cellCenter.x, cellCenter.y - style.size);
//         ctx.lineTo(cellCenter.x + style.size, cellCenter.y);
//         ctx.lineTo(cellCenter.x, cellCenter.y + style.size);
//         ctx.lineTo(cellCenter.x - style.size, cellCenter.y);
//         ctx.closePath();
//         ctx.fill();
//         break;
//     }
    
//     ctx.restore();
//   }
// }

// function getCellCenter(cellId: number): { x: number; y: number } {
//   if (!meshData) return { x: 0, y: 0 };
//   const index = cellId * 2;
//   return {
//     x: meshData.cellGeometricCenters[index],
//     y: meshData.cellGeometricCenters[index + 1]
//   };
// }

// function getCellFromPoint(x: number, y: number): number | null {
//   if (!meshData) return null;
  
//   const nCells = meshData.cellOffsets.length - 1;
//   let closestCell = -1;
//   let closestDistance = Infinity;
  
//   for (let cellId = 0; cellId < nCells; cellId++) {
//     const center = getCellCenter(cellId);
//     const dx = x - center.x;
//     const dy = y - center.y;
//     const distance = dx * dx + dy * dy;
    
//     if (distance < closestDistance) {
//       closestDistance = distance;
//       closestCell = cellId;
//     }
//   }
  
//   return closestCell >= 0 ? closestCell : null;
// }

// function handleCanvasClick(event: MouseEvent) {
//   if (gameMode !== 'game' || !gameWorld || !meshData) return;
  
//   const rect = canvas.getBoundingClientRect();
//   const x = event.clientX - rect.left;
//   const y = event.clientY - rect.top;
  
//   const cellId = getCellFromPoint(x, y);
//   if (cellId === null) return;
  
//   // Check if there's an entity in this cell
//   const entitiesInCell = gameWorld.getEntitiesInCell(cellId);
  
//   if (event.shiftKey) {
//     // Shift+click: spawn new entity
//     if (cellElevations && cellElevations[cellId] >= biomeConfig.waterLevel) {
//       const entityId = gameWorld.spawnEntity(cellId, selectedEntityType);
//       selectedEntity = entityId;
//       updateGameStats();
//       render();
//     }
//   } else if (entitiesInCell.length > 0) {
//     // Click on entity: select it
//     selectedEntity = entitiesInCell[0].id;
//     render();
//   } else if (selectedEntity !== null) {
//     // Click on empty cell with entity selected: try to move
//     const entity = gameWorld.getEntity(selectedEntity);
//     if (entity && gameWorld.areCellsAdjacent(entity.cellId, cellId)) {
//       if (cellElevations && cellElevations[cellId] >= biomeConfig.waterLevel) {
//         gameWorld.moveEntity(selectedEntity, cellId);
//         updateGameStats();
//         render();
//       }
//     }
//   }
// }

// function createUI() {
//   // Create UI panel
//   const uiPanel = document.createElement('div');
//   uiPanel.style.cssText = `
//     position: fixed;
//     top: 10px;
//     right: 10px;
//     width: 300px;
//     background: rgba(0, 0, 0, 0.8);
//     color: white;
//     padding: 15px;
//     border-radius: 8px;
//     font-family: Arial, sans-serif;
//     font-size: 12px;
//     max-height: 90vh;
//     overflow-y: auto;
//     z-index: 1000;
//   `;
  
//   uiPanel.innerHTML = `
//     <h3 style="margin: 0 0 15px 0; color: #4CAF50;">Biome Terrain Controls</h3>
    
//     <div style="margin-bottom: 15px;">
//       <button id="newMesh" style="
//         background: #4CAF50; 
//         color: white; 
//         border: none; 
//         padding: 8px 16px; 
//         border-radius: 4px; 
//         cursor: pointer;
//         width: 100%;
//       ">Generate New Mesh</button>
//     </div>

//     <div style="margin-bottom: 15px;">
//       <label>Mode:</label>
//       <select id="gameMode" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
//         <option value="terrain">Terrain Editor</option>
//         <option value="game">Game Mode</option>
//       </select>
//     </div>

//     <div id="gameControls" style="display: none; margin-bottom: 15px;">
//       <div style="margin-bottom: 10px;">
//         <label>Entity Type:</label>
//         <select id="entityType" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
//           <option value="unit">Unit (Red Circle)</option>
//           <option value="village">Village (Gold Square)</option>
//           <option value="resource">Resource (Green Triangle)</option>
//           <option value="monster">Monster (Purple Diamond)</option>
//         </select>
//       </div>
      
//       <div style="margin-bottom: 10px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 4px;">
//         <div style="font-size: 11px; color: #ccc;">
//           <strong>Instructions:</strong><br>
//           • <strong>Shift+Click</strong> land cell: Spawn entity<br>
//           • <strong>Click entity</strong>: Select it<br>
//           • <strong>Click adjacent cell</strong>: Move selected entity<br>
//           • Can only spawn/move on land cells
//         </div>
//       </div>

//       <div style="margin-bottom: 15px;">
//         <button id="clearEntities" style="background: #ff4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; width: 100%;">
//           Clear All Entities
//         </button>
//       </div>
//     </div>
    
//     <div style="margin-bottom: 15px;">
//       <label>
//         <input type="checkbox" id="useIslands" ${elevationConfig.useIslands ? 'checked' : ''}> 
//         Island Mode
//       </label>
//     </div>

//     <div style="margin-bottom: 15px;">
//       <label>
//         <input type="checkbox" id="smoothColors" ${biomeConfig.smoothColors ? 'checked' : ''}> 
//         Smooth Colors
//       </label>
//     </div>

//     <div style="margin-bottom: 15px;">
//       <label>Map Size:</label>
//       <select id="mapSize" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
//         <option value="small">Small</option>
//         <option value="medium">Medium</option>
//         <option value="large" selected>Large</option>
//         <option value="xl">XL</option>
//       </select>
//     </div>
    
//     <div style="margin-bottom: 15px;">
//       <label>Preset:</label>
//       <select id="presetSelect" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
//         <option value="none">Custom</option>
//         <option value="rolling">Rolling Hills</option>
//         <option value="mountainous" selected>Mountainous</option>
//         <option value="plains">Plains</option>
//         <option value="chaotic">Chaotic</option>
//       </select>
//     </div>

//     <details style="margin-bottom: 15px;">
//       <summary style="cursor: pointer; margin-bottom: 10px;">Biome Settings</summary>
      
//       <div style="margin-bottom: 10px;">
//         <label>Water Level: <span id="waterLevelValue">${biomeConfig.waterLevel}</span></label>
//         <input type="range" id="waterLevel" min="0.2" max="0.8" step="0.05" value="${biomeConfig.waterLevel}" 
//                style="width: 100%; margin-top: 5px;">
//       </div>

//       <div style="margin-bottom: 10px;">
//         <label>Moisture Frequency: <span id="moistureFrequencyValue">${biomeConfig.moistureFrequency}</span></label>
//         <input type="range" id="moistureFrequency" min="0.005" max="0.05" step="0.005" value="${biomeConfig.moistureFrequency}" 
//                style="width: 100%; margin-top: 5px;">
//       </div>

//       <div style="margin-bottom: 10px;">
//         <label>Temperature Frequency: <span id="temperatureFrequencyValue">${biomeConfig.temperatureFrequency}</span></label>
//         <input type="range" id="temperatureFrequency" min="0.005" max="0.05" step="0.005" value="${biomeConfig.temperatureFrequency}" 
//                style="width: 100%; margin-top: 5px;">
//       </div>

//       <div style="margin-bottom: 10px;">
//         <label>Moisture Octaves: <span id="moistureOctavesValue">${biomeConfig.moistureOctaves}</span></label>
//         <input type="range" id="moistureOctaves" min="1" max="5" step="1" value="${biomeConfig.moistureOctaves}" 
//                style="width: 100%; margin-top: 5px;">
//       </div>

//       <div style="margin-bottom: 15px;">
//         <label>Temperature Octaves: <span id="temperatureOctavesValue">${biomeConfig.temperatureOctaves}</span></label>
//         <input type="range" id="temperatureOctaves" min="1" max="5" step="1" value="${biomeConfig.temperatureOctaves}" 
//                style="width: 100%; margin-top: 5px;">
//       </div>
//       <hr></hr>
//     </details>

//     <div style="margin-bottom: 10px;">
//       <label>Elevation Shift: <span id="elevationShiftValue">${elevationConfig.elevationShift}</span></label>
//       <input type="range" id="elevationShift" min="-0.4" max="0.4" step="0.01" value="${elevationConfig.elevationShift}" 
//              style="width: 100%; margin-top: 5px;">
//     </div>
    
//     <div style="margin-bottom: 10px;">
//       <label>Octaves: <span id="octavesValue">${elevationConfig.octaves}</span></label>
//       <input type="range" id="octaves" min="1" max="6" step="1" value="${elevationConfig.octaves}" 
//              style="width: 100%; margin-top: 5px;">
//     </div>
    
//     <div style="margin-bottom: 10px;">
//       <label>Redistribution:</label>
//       <select id="redistribution" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
//         <option value="none">None</option>
//         <option value="linear">Linear</option>
//         <option value="exponential" selected>Exponential</option>
//       </select>
//     </div>
    
//     <div id="exponentialPowerDiv" style="margin-bottom: 10px;">
//       <label>Exponential Power: <span id="exponentialPowerValue">${elevationConfig.exponentialPower}</span></label>
//       <input type="range" id="exponentialPower" min="0.5" max="3" step="0.1" value="${elevationConfig.exponentialPower}" 
//              style="width: 100%; margin-top: 5px;">
//     </div>
    
//     <div style="margin-bottom: 10px;">
//       <label>Seed:</label>
//       <div style="display: flex; gap: 5px; margin-top: 5px; align-items: center;">
//         <input type="number" id="seedInput" min="0" max="1" step="0.001" value="${elevationConfig.seed.toFixed(3)}" 
//                style="flex: 1; background: #333; color: white; border: 1px solid #555; padding: 4px; border-radius: 4px;">
//         <button id="randomSeed" style="background: #666; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Random</button>
//       </div>
//     </div>
    
//     <details style="margin-bottom: 10px;">
//       <summary style="cursor: pointer; margin-bottom: 10px;">Advanced (Amplitudes & Frequencies)</summary>
      
//       <div id="amplitudesContainer">
//         <label>Amplitudes:</label>
//         ${elevationConfig.amplitudes.map((amp, i) => 
//           `<div style="margin: 5px 0;">
//             <label>Octave ${i + 1}: <span id="amp${i}Value">${amp}</span></label>
//             <input type="range" id="amplitude${i}" min="0" max="1" step="0.025" value="${amp}" style="width: 100%;">
//            </div>`
//         ).join('')}
//       </div>
      
//       <div id="frequenciesContainer" style="margin-top: 10px;">
//         <label>Frequencies:</label>
//         ${elevationConfig.frequencies.map((freq, i) => 
//           `<div style="margin: 5px 0;">
//             <label>Octave ${i + 1}: <span id="freq${i}Value">${freq}</span></label>
//             <input type="range" id="frequency${i}" min="0.001" max="0.05" step="0.001" value="${freq}" style="width: 100%;">
//            </div>`
//         ).join('')}
//       </div>
//     </details>
    
//     <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
//       <div id="stats"></div>
//       <div id="biomeStats" style="margin-top: 10px;"></div>
//       <div id="gameStats" style="margin-top: 10px; display: none;"></div>
//     </div>
//   `;
  
//   document.body.appendChild(uiPanel);
  
//   // Add canvas click handler
//   canvas.addEventListener('click', handleCanvasClick);
  
//   // Event listeners
//   document.getElementById('newMesh')!.addEventListener('click', generateNewMesh);

//   // Game mode selector
//   document.getElementById('gameMode')!.addEventListener('change', (e) => {
//     gameMode = (e.target as HTMLSelectElement).value as 'terrain' | 'game';
//     const gameControls = document.getElementById('gameControls')!;
//     const gameStats = document.getElementById('gameStats')!;
    
//     if (gameMode === 'game') {
//       gameControls.style.display = 'block';
//       gameStats.style.display = 'block';
//       canvas.style.cursor = 'crosshair';
//       updateGameStats();
//     } else {
//       gameControls.style.display = 'none';
//       gameStats.style.display = 'none';
//       canvas.style.cursor = 'default';
//       selectedEntity = null;
//     }
//     render();
//   });

//   // Entity type selector
//   document.getElementById('entityType')!.addEventListener('change', (e) => {
//     selectedEntityType = (e.target as HTMLSelectElement).value;
//   });

//   // Clear entities button
//   document.getElementById('clearEntities')!.addEventListener('click', () => {
//     if (gameWorld) {
//       const entities = gameWorld.getEntitiesByType('village')
//         .concat(gameWorld.getEntitiesByType('unit'))
//         .concat(gameWorld.getEntitiesByType('resource'))
//         .concat(gameWorld.getEntitiesByType('monster'));
      
//       entities.forEach(entity => gameWorld!.removeEntity(entity.id));
//       selectedEntity = null;
//       updateGameStats();
//       render();
//     }
//   });

//   // Map size selectors
//   document.getElementById('mapSize')!.addEventListener('change', (e) => {
//     const size = (e.target as HTMLSelectElement).value;
//     if (size !== 'none' && RADIUS_OPTIONS[size as keyof typeof RADIUS_OPTIONS]) {
//       const radius = RADIUS_OPTIONS[size as keyof typeof RADIUS_OPTIONS];
//       meshConfig['radius'] = radius;
//       generateNewMesh();
//     }
//   });
  
//   document.getElementById('randomSeed')!.addEventListener('click', () => {
//     elevationConfig.seed = Math.random();
//     (document.getElementById('seedInput') as HTMLInputElement).value = elevationConfig.seed.toFixed(3);
//     regenerateElevations();
//   });
  
//   // Seed input
//   document.getElementById('seedInput')!.addEventListener('input', (e) => {
//     const value = parseFloat((e.target as HTMLInputElement).value);
//     if (!isNaN(value)) {
//       elevationConfig.seed = Math.max(0, Math.min(1, value));
//       regenerateElevations();
//     }
//   });
  
//   // Preset selectors
//   document.getElementById('presetSelect')!.addEventListener('change', (e) => {
//     const preset = (e.target as HTMLSelectElement).value;
//     if (preset !== 'none' && TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS]) {
//       const presetConfig = TERRAIN_PRESETS[preset as keyof typeof TERRAIN_PRESETS];
//       Object.assign(elevationConfig, presetConfig);
//       updateUIFromConfig();
//       regenerateElevations();
//     }
//   });
  
//   // Range inputs - all auto-regenerate
//   ['elevationShift', 'octaves', 'exponentialPower'].forEach(param => {
//     const element = document.getElementById(param)!;
//     element.addEventListener('input', (e) => {
//       const value = parseFloat((e.target as HTMLInputElement).value);
//       (elevationConfig as any)[param] = param === 'octaves' ? Math.floor(value) : value;
//       document.getElementById(param + 'Value')!.textContent = value.toString();
//       regenerateElevations();
//     });
//   });

//   // Biome config inputs
//   ['waterLevel', 'moistureFrequency', 'temperatureFrequency', 'moistureOctaves', 'temperatureOctaves'].forEach(param => {
//     const element = document.getElementById(param)!;
//     element.addEventListener('input', (e) => {
//       const value = parseFloat((e.target as HTMLInputElement).value);
//       (biomeConfig as any)[param] = ['moistureOctaves', 'temperatureOctaves'].includes(param) ? Math.floor(value) : value;
//       document.getElementById(param + 'Value')!.textContent = value.toString();
//       regenerateElevations();
//     });
//   });
  
//   // Redistribution
//   document.getElementById('redistribution')!.addEventListener('change', (e) => {
//     elevationConfig.redistribution = (e.target as HTMLSelectElement).value as any;
//     document.getElementById('exponentialPowerDiv')!.style.display = 
//       elevationConfig.redistribution === 'exponential' ? 'block' : 'none';
//     regenerateElevations();
//   });
  
//   // Islands checkbox
//   document.getElementById('useIslands')!.addEventListener('change', (e) => {
//     elevationConfig.useIslands = (e.target as HTMLInputElement).checked;
//     regenerateElevations();
//   });

//   // Smooth colors checkbox
//   document.getElementById('smoothColors')!.addEventListener('change', (e) => {
//     biomeConfig.smoothColors = (e.target as HTMLInputElement).checked;
//     render(); // Just re-render, don't regenerate elevations
//   });
  
//   // Amplitude and frequency controls - auto-regenerate
//   for (let i = 0; i < 4; i++) {
//     const ampElement = document.getElementById(`amplitude${i}`);
//     const freqElement = document.getElementById(`frequency${i}`);
    
//     if (ampElement) {
//       ampElement.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         elevationConfig.amplitudes[i] = value;
//         document.getElementById(`amp${i}Value`)!.textContent = value.toString();
//         regenerateElevations();
//       });
//     }
    
//     if (freqElement) {
//       freqElement.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         elevationConfig.frequencies[i] = value;
//         document.getElementById(`freq${i}Value`)!.textContent = value.toString();
//         regenerateElevations();
//       });
//     }
//   }
// }

// function updateUIFromConfig() {
//   (document.getElementById('elevationShift') as HTMLInputElement).value = elevationConfig.elevationShift.toString();
//   document.getElementById('elevationShiftValue')!.textContent = elevationConfig.elevationShift.toString();
  
//   (document.getElementById('octaves') as HTMLInputElement).value = elevationConfig.octaves.toString();
//   document.getElementById('octavesValue')!.textContent = elevationConfig.octaves.toString();
  
//   (document.getElementById('exponentialPower') as HTMLInputElement).value = elevationConfig.exponentialPower.toString();
//   document.getElementById('exponentialPowerValue')!.textContent = elevationConfig.exponentialPower.toString();
  
//   (document.getElementById('redistribution') as HTMLSelectElement).value = elevationConfig.redistribution;
  
//   for (let i = 0; i < 4; i++) {
//     const ampInput = document.getElementById(`amplitude${i}`) as HTMLInputElement;
//     const freqInput = document.getElementById(`frequency${i}`) as HTMLInputElement;
//     if (ampInput && elevationConfig.amplitudes[i] !== undefined) {
//       ampInput.value = elevationConfig.amplitudes[i].toString();
//       document.getElementById(`amp${i}Value`)!.textContent = elevationConfig.amplitudes[i].toString();
//     }
//     if (freqInput && elevationConfig.frequencies[i] !== undefined) {
//       freqInput.value = elevationConfig.frequencies[i].toString();
//       document.getElementById(`freq${i}Value`)!.textContent = elevationConfig.frequencies[i].toString();
//     }
//   }
// }

// function updateGameStats() {
//   if (!gameWorld) return;
  
//   const stats = gameWorld.getStats();
//   const gameStatsDiv = document.getElementById('gameStats')!;
  
//   let statsHtml = `<strong>Game Entities:</strong><br>`;
//   statsHtml += `Total: ${stats.totalEntities}<br>`;
  
//   if (stats.totalEntities > 0) {
//     Object.entries(stats.entitiesByType).forEach(([type, count]) => {
//       const style = ENTITY_STYLES[type as keyof typeof ENTITY_STYLES];
//       const color = style ? style.color : '#999';
//       statsHtml += `<span style="color: ${color};">${type}: ${count}</span><br>`;
//     });
//   }
  
//   if (selectedEntity !== null) {
//     const entity = gameWorld.getEntity(selectedEntity);
//     if (entity) {
//       statsHtml += `<br><strong>Selected:</strong> ${entity.type} #${entity.id}`;
//     }
//   }
  
//   gameStatsDiv.innerHTML = statsHtml;
// }

// function generateNewMesh() {
//   console.time('fullRender');
  
//   console.time('pointGeneration');
//   const points: Float64Array = generatePoints({ x: WIDTH, y: HEIGHT }, meshConfig.radius);
//   console.timeEnd('pointGeneration');
  
//   console.log(`Generated ${points.length / 2} points`);

//   console.time('triangulation');
//   const delaunay = new Delaunator(points);
//   console.timeEnd('triangulation');
  
//   console.log(`Created ${delaunay.triangles.length / 3} triangles`);

//   console.time('meshUpdate');
//   meshData = mesh.update(points, delaunay);
//   console.timeEnd('meshUpdate');

//   // Initialize game world with new mesh
//   gameWorld = new GameWorld(meshData);
//   selectedEntity = null;

//   regenerateElevations();
//   console.timeEnd('fullRender');
// }

// function regenerateElevations() {
//   if (!meshData) return;
  
//   console.time('assignElevations');
//   const elevationFunction = elevationConfig.useIslands ? assignIslandElevations : assignElevations;
//   cellElevations = elevationFunction(meshData.cellGeometricCenters, elevationConfig);
//   console.timeEnd('assignElevations');

//   console.time('assignBiomes');
//   cellBiomes = assignBiomes(
//     meshData.cellGeometricCenters,
//     cellElevations,
//     meshData.cellNeighbors,
//     meshData.cellOffsets,
//     biomeConfig.waterLevel,
//     {
//       frequency: biomeConfig.moistureFrequency,
//       amplitude: biomeConfig.moistureAmplitude,
//       octaves: biomeConfig.moistureOctaves
//     },
//     {
//       frequency: biomeConfig.temperatureFrequency,
//       amplitude: biomeConfig.temperatureAmplitude,
//       octaves: biomeConfig.temperatureOctaves
//     }
//   );
//   console.timeEnd('assignBiomes');

//   // Calculate stats
//   const landCells = cellElevations.filter(e => e >= biomeConfig.waterLevel).length;
//   const waterCells = cellElevations.length - landCells;
//   const landPercentage = Math.round((landCells / cellElevations.length) * 100);
  
//   // Calculate biome distribution
//   const biomeCounts: { [key: number]: number } = {};
//   for (let i = 0; i < cellBiomes.length; i++) {
//     const biome = cellBiomes[i];
//     biomeCounts[biome] = (biomeCounts[biome] || 0) + 1;
//   }
  
//   const biomeStatsHtml = Object.entries(biomeCounts)
//     .sort(([,a], [,b]) => b - a)
//     .slice(0, 6) // Show top 6 biomes
//     .map(([biomeId, count]) => {
//       const percentage = Math.round((count / cellBiomes!.length) * 100);
//       return `${getBiomeName(parseInt(biomeId))}: ${percentage}%`;
//     })
//     .join('<br>');
  
//   document.getElementById('stats')!.innerHTML = `
//     Land: ${landPercentage}% (${landCells} cells)<br>
//     Water: ${100 - landPercentage}% (${waterCells} cells)
//   `;
  
//   document.getElementById('biomeStats')!.innerHTML = `
//     <strong>Top Biomes:</strong><br>
//     ${biomeStatsHtml}
//   `;
  
//   updateGameStats();
//   render();
// }

// function render() {
//   if (!meshData || !cellBiomes) return;
  
//   console.time('drawFilled');
//   ctx.fillStyle = '#000';
//   ctx.fillRect(0, 0, WIDTH, HEIGHT);
//   drawFilledCellsByBiome(
//     ctx, 
//     meshData.allVertices, 
//     meshData.cellOffsets, 
//     meshData.cellVertexIndices, 
//     cellBiomes,
//     meshData.cellNeighbors,
//     biomeConfig.smoothColors
//   );
  
//   // Draw entities if in game mode
//   if (gameMode === 'game') {
//     drawEntities(ctx);
//   }
  
//   console.timeEnd('drawFilled');
// }

// // Initialize
// createUI();
// generateNewMesh();