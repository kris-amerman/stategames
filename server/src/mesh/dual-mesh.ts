import Delaunator from "delaunator";
import type { MeshData } from "./types";

/**
 * DualMesh constructs the dual‐cell mesh of a Delaunay triangulation (using centroids),
 * but only for points strictly inside a rectangular region (excluding the boundary ring).
 */
export class DualMesh {
  private regionWidth: number;
  private regionHeight: number;

  // TODO clarify if these are in CCW order (where applicable)

  // raw points that make up cell vertices [x0,y0, x1,y1, …]
  // under the hood, these are the triangle centroids organized by triangle indices
  allVertices: Float64Array = new Float64Array(0);
  // offsets into cellVertexIndices and cellNeighbors, ordered by cell id (length = cellCount+1)
  cellOffsets: Uint32Array = new Uint32Array(0);
  // flattened list of vertex indices in CCW order for each cell, used to access allVertices
  cellVertexIndices: Uint32Array = new Uint32Array(0);
  // flattened list of neighboring cell ids for each cell (same structure as cellVertexIndices)
  cellNeighbors: Int32Array = new Int32Array(0);
  // locations of cell's associated triangle vertex [x0,y0, x1,y1, …] ordered by cell id
  cellTriangleCenters: Float64Array = new Float64Array(0);

  // helper data structures
  private cellOffsetIndices: Int32Array = new Int32Array(0);
  private firstEdge: Int32Array = new Int32Array(0);

  constructor(regionWidth: number, regionHeight: number) {
    this.regionWidth = regionWidth;
    this.regionHeight = regionHeight;
  }

  // helpers
  private triOfEdge(edgeIndex: number): number {
    return (edgeIndex / 3) | 0;
  }
  private nextEdge(edgeIndex: number): number {
    return edgeIndex % 3 === 2 ? edgeIndex - 2 : edgeIndex + 1;
  }

  generate(
    points: Float64Array,
    delaunay: Delaunator<ArrayLike<number>>
  ): MeshData {
    const triangles = delaunay.triangles;
    const halfedges = delaunay.halfedges;
    const width = this.regionWidth;
    const height = this.regionHeight;

    const numTriangles = triangles.length / 3;
    const numPoints = points.length >>> 1;

    // 1) compute triangle centroids
    if (this.allVertices.length !== numTriangles * 2) {
      this.allVertices = new Float64Array(numTriangles * 2);
    }
    for (let t = 0; t < numTriangles; t++) {
      const triOffset = 3 * t;
      // indices into the flat points[]
      const v0 = triangles[triOffset] * 2;
      const v1 = triangles[triOffset + 1] * 2;
      const v2 = triangles[triOffset + 2] * 2;

      // extract each vertex’s coords
      const x0 = points[v0],
        y0 = points[v0 + 1];
      const x1 = points[v1],
        y1 = points[v1 + 1];
      const x2 = points[v2],
        y2 = points[v2 + 1];

      // compute ordinary centroid
      let cx = (x0 + x1 + x2) / 3;
      let cy = (y0 + y1 + y2) / 3;

      // TODO fix the "5" boundary math (supposedly half of radius)
      // if any vertex sits on the left or right boundary, clamp x
      if (x0 === 0 || x1 === 0 || x2 === 0) cx = 5; 
      else if (x0 === width || x1 === width || x2 === width) cx = width - 5;

      // if any vertex sits on the top or bottom boundary, clamp y
      if (y0 === 0 || y1 === 0 || y2 === 0) cy = 5;
      else if (y0 === height || y1 === height || y2 === height) cy = height - 5;

      this.allVertices[2 * t] = cx;
      this.allVertices[2 * t + 1] = cy;
    }

    // 2) build first‐incident‐edge map for each point
    if (this.firstEdge.length < numPoints) {
      this.firstEdge = new Int32Array(numPoints);
    }
    this.firstEdge.fill(-1);
    for (let e = 0; e < triangles.length; e++) {
      const pt = triangles[e];
      if (this.firstEdge[pt] < 0) this.firstEdge[pt] = e;
    }

    // 3) assign a cell ID to each interior point
    if (this.cellOffsetIndices.length < numPoints) {
      this.cellOffsetIndices = new Int32Array(numPoints);
    }
    this.cellOffsetIndices.fill(-1);
    let cellCount = 0;
    for (let p = 0; p < numPoints; p++) {
      const x = points[2 * p],
        y = points[2 * p + 1];
      if (x > 0 && x < width && y > 0 && y < height) {
        this.cellOffsetIndices[p] = cellCount++;
      }
    }

    // 4) populate cellTriangleCenters with the original point coordinates (triangle vertex), ordered by cell ID
    if (this.cellTriangleCenters.length !== cellCount * 2) {
      this.cellTriangleCenters = new Float64Array(cellCount * 2);
    }
    for (let p = 0; p < numPoints; p++) {
      const cid = this.cellOffsetIndices[p];
      if (cid >= 0) {
        // Store the original point coordinates at the cell ID position
        this.cellTriangleCenters[2 * cid] = points[2 * p];
        this.cellTriangleCenters[2 * cid + 1] = points[2 * p + 1];
      }
    }

    // 5) compute offsets by counting edges per cell
    if (this.cellOffsets.length !== cellCount + 1) {
      this.cellOffsets = new Uint32Array(cellCount + 1);
    }
    let cumulativeVertexCount = 0;
    this.cellOffsets[0] = 0;
    for (let p = 0; p < numPoints; p++) {
      const cid = this.cellOffsetIndices[p];
      if (cid < 0) continue; // only interior points (valid cells)
      let edge = this.firstEdge[p];
      const startEdge = edge;
      let edgeCount = 0;
      do {
        edgeCount++;
        edge = this.nextEdge(halfedges[edge]);
      } while (edge !== startEdge);
      cumulativeVertexCount += edgeCount;
      this.cellOffsets[cid + 1] = cumulativeVertexCount;
    }

    // 6) fill cellVertexIndices and cellNeighbors with triangle IDs and neighbor cell IDs per cell
    if (this.cellVertexIndices.length !== cumulativeVertexCount) {
      this.cellVertexIndices = new Uint32Array(cumulativeVertexCount);
    }
    if (this.cellNeighbors.length !== cumulativeVertexCount) {
      this.cellNeighbors = new Int32Array(cumulativeVertexCount);
    }

    let writePointer = 0;
    for (let p = 0; p < numPoints; p++) {
      const cid = this.cellOffsetIndices[p];
      if (cid < 0) continue;

      let edge = this.firstEdge[p];
      const startEdge = edge;

      do {
        // Store the triangle index for this edge
        const triIndex = this.triOfEdge(edge);
        this.cellVertexIndices[writePointer] = triIndex;

        // Find the neighboring cell across this edge
        const oppositeEdge = halfedges[edge];
        let neighborCellId = -1; // -1 indicates boundary (no neighbor)

        if (oppositeEdge >= 0) {
          // In Delaunator: triangles[e] gives the vertex that edge e points TO
          // halfedges[e] gives the opposite halfedge that points back
          // For the opposite edge, we want to find which vertex "starts" from that edge
          // Since we're walking around vertex p, the current edge goes FROM p TO triangles[edge]
          // The opposite edge goes FROM triangles[oppositeEdge] back toward our edge
          // So the cell we want is centered at triangles[oppositeEdge]
          const neighborPoint = triangles[oppositeEdge];

          // Check if the neighbor point has a valid cell ID
          if (neighborPoint < numPoints) {
            neighborCellId = this.cellOffsetIndices[neighborPoint];
          }
        }

        this.cellNeighbors[writePointer] = neighborCellId;
        writePointer++;

        edge = this.nextEdge(halfedges[edge]);
      } while (edge !== startEdge);
    }

    return {
      allVertices: this.allVertices,
      cellOffsets: this.cellOffsets,
      cellVertexIndices: this.cellVertexIndices,
      cellNeighbors: this.cellNeighbors,
      cellTriangleCenters: this.cellTriangleCenters,
      cellCount: cellCount
    };
  }
}