import Delaunator from 'delaunator';
import { generatePoints } from './point-generation';
import { DualMesh } from './dual-mesh';
import { assignElevations, assignIslandElevations, TERRAIN_PRESETS } from './landmasses';

const WIDTH  = 1000;
const HEIGHT = 600;
const RADIUS = 5;

// set up canvas
const canvas = document.createElement('canvas');
const container = document.getElementById('canvas-container')!;
container.appendChild(canvas);
canvas.width  = WIDTH;
canvas.height = HEIGHT;

const ctx = canvas.getContext('2d')!;

const mesh = new DualMesh(WIDTH, HEIGHT);

function drawCells(
  ctx: CanvasRenderingContext2D,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  cellCenters: Float64Array
) {
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  
  const path = new Path2D();
  const seen = new Set<string>();
  const nCells = cellOffsets.length - 1;

  let edgeCount = 0;
  let duplicateCount = 0;
  
  function drawCell(ci: number) {
    const start = cellOffsets[ci];
    const end   = cellOffsets[ci + 1];

    for (let j = start; j < end; j++) {
      // take the edge from cellIndices[j] → nextIndex
      const a = cellVertexIndices[j];
      const b = (j + 1 < end ? cellVertexIndices[j + 1] : cellVertexIndices[start]);

      // dedupe by sorting the pair into a string key
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);

      // now emit exactly one moveTo/lineTo for that edge
      const t0 = 2 * a, t1 = 2 * b;
      path.moveTo(allVertices[t0],     allVertices[t0 + 1]);
      path.lineTo(allVertices[t1],     allVertices[t1 + 1]);
      edgeCount++;
    }
  }

  // walk each cell's boundary
  for (let ci = 0; ci < nCells; ci++) {
    // const neighbors = mesh.getCellNeighbors(ci)
    // if (!neighbors.includes(-1)) {
    //   continue
    // }
    drawCell(ci)
  }

  // const cid = 51
  // drawCell(cid)
  // drawCellCenter(ctx, cid, cellCenters)

  // single draw call, just like drawEdges
  ctx.stroke(path);
}

function drawTriangles(ctx: CanvasRenderingContext2D, delaunay: Delaunator<ArrayLike<number>>, points: Float64Array) {
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth   = 2;
  for (let t = 0; t < delaunay.triangles.length; t += 3) {
    // each entry in .triangles is an index into the "points" array,
    // but it's an index of the *point*, so we have to multiply by 2
    const i0 = delaunay.triangles[t + 0] * 2;
    const i1 = delaunay.triangles[t + 1] * 2;
    const i2 = delaunay.triangles[t + 2] * 2;

    const x0 = points[i0], y0 = points[i0 + 1];
    const x1 = points[i1], y1 = points[i1 + 1];
    const x2 = points[i2], y2 = points[i2 + 1];

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.stroke();
  }
}

function drawPoints(ctx: CanvasRenderingContext2D, points: Float64Array) {
  ctx.fillStyle = '#f00';
  for (let i = 0; i < points.length; i += 2) {
    drawPoint(ctx, i, points);
  }
}

function drawPoint(ctx: CanvasRenderingContext2D, idx: number, points: Float64Array) {
  ctx.beginPath();
  ctx.arc(points[idx], points[idx + 1], 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCellCenter(ctx: CanvasRenderingContext2D, cid: number, cellCenters: Float64Array, cellElevations?: Float64Array) {
  const idx = 2 * cid;
  drawPoint(ctx, idx, cellCenters);
}

function drawCellCenters(ctx: CanvasRenderingContext2D, cellCenters: Float64Array, cellElevations?: Float64Array) {
  ctx.fillStyle = '#0f0';
  
  const numCells = cellCenters.length / 2;

  for (let cid = 0; cid < numCells; cid++) {
    if (cellElevations && cellElevations[cid] < 0) {
      console.log(cellElevations[cid])
      ctx.fillStyle = '#f00';
    }
    drawCellCenter(ctx, cid, cellCenters);
  }
}


// Function to draw a single filled cell
function drawFilledCell(
  ctx: CanvasRenderingContext2D,
  cellId: number,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  fillStyle: string | CanvasGradient | CanvasPattern = '#fff'
) {
  const start = cellOffsets[cellId];
  const end = cellOffsets[cellId + 1];
  
  if (start >= end) return; // Skip empty cells
  
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  
  // Move to the first vertex
  const firstVertexIndex = cellVertexIndices[start];
  const firstX = allVertices[firstVertexIndex * 2];
  const firstY = allVertices[firstVertexIndex * 2 + 1];
  ctx.moveTo(firstX, firstY);
  
  // Draw lines to all other vertices
  for (let j = start + 1; j < end; j++) {
    const vertexIndex = cellVertexIndices[j];
    const x = allVertices[vertexIndex * 2];
    const y = allVertices[vertexIndex * 2 + 1];
    ctx.lineTo(x, y);
  }
  
  ctx.closePath();
  ctx.fill();
}

// Function to draw filled cells based on elevation data (example usage)
function drawFilledCellsByElevation(
  ctx: CanvasRenderingContext2D,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  cellElevations: Float64Array,
  waterColor: string = '#4a90e2',
  landColor: string = '#8fbc8f'
) {
  const nCells = cellOffsets.length - 1;
  for (let cellId = 0; cellId < nCells; cellId++) {
    const start = cellOffsets[cellId];
    const end = cellOffsets[cellId + 1];
    
    if (start >= end) continue; // Skip empty cells
    
    // Choose color based on elevation
    const elevation = cellElevations[cellId];
    ctx.fillStyle = elevation < 0.5 ? waterColor : landColor;
    
    ctx.beginPath();
    
    // Move to the first vertex
    const firstVertexIndex = cellVertexIndices[start];
    const firstX = allVertices[firstVertexIndex * 2];
    const firstY = allVertices[firstVertexIndex * 2 + 1];
    ctx.moveTo(firstX, firstY);
    
    // Draw lines to all other vertices
    for (let j = start + 1; j < end; j++) {
      const vertexIndex = cellVertexIndices[j];
      const x = allVertices[vertexIndex * 2];
      const y = allVertices[vertexIndex * 2 + 1];
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();
  }
}

function render() {
  console.time('render');

  // 1) generate flat [x0, y0, x1, y1, …] array
  console.time('pointGeneration');
  const points: Float64Array = generatePoints({ x: WIDTH, y: HEIGHT }, RADIUS);
  console.timeEnd('pointGeneration');
  
  console.log(`Generated ${points.length / 2} points`);

  // 2) clear background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 3) triangulate
  console.time('triangulation');
  const delaunay = new Delaunator(points);
  console.timeEnd('triangulation');
  
  console.log(`Created ${delaunay.triangles.length / 3} triangles`);

  // 4) draw each triangle
  // drawTriangles(ctx, delaunay, points);

  // 5) draw the points on top
  // drawPoints(ctx, points);

  console.time('meshUpdate');
  const { allVertices, cellOffsets, cellVertexIndices, cellNeighbors, cellTriangleCenters, cellGeometricCenters } = mesh.update(points, delaunay);
  console.timeEnd('meshUpdate');

  console.log(`Generated ${allVertices.length / 2} vertices, ${cellOffsets.length - 1} cells`);
  
  // 6) draw allVertices (centroids) in red
  // drawPoints(ctx, allVertices);

  // drawPoints(ctx, cellTriangleCenters)
  // drawPoints(ctx, cellGeometricCenters)
  
  console.time('drawCells');
  // drawCells(ctx, allVertices, cellOffsets, cellVertexIndices, cellGeometricCenters);
  console.timeEnd('drawCells');

  // const cellElevations = assignElevations(cellGeometricCenters, TERRAIN_PRESETS.mountainous);

  console.time(`assignElevations`)
  const cellElevations = assignElevations(cellGeometricCenters, {
    ...TERRAIN_PRESETS.mountainous,
    elevationShift: -0.1
  } as any);
  console.timeEnd(`assignElevations`)

  // drawCellCenters(ctx, cellGeometricCenters, cellElevations);

  console.time(`drawFilled`)
  drawFilledCellsByElevation(ctx, allVertices, cellOffsets, cellVertexIndices, cellElevations);
  console.timeEnd(`drawFilled`)

  console.timeEnd('render');
}

// initial draw
render();

// wire up the refresh button
document.getElementById('refresh')!
  .addEventListener('click', render);