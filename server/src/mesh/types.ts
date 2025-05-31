export type MeshData = {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellTriangleCenters: Float64Array;
};

export type MapSize = "small" | "medium" | "large" | "xl";

export interface SerializedMeshData {
  allVertices: number[];
  cellOffsets: number[];
  cellVertexIndices: number[];
  cellNeighbors: number[];
  cellTriangleCenters: number[];
}

export interface MeshGenerationConfig {
  width: number;
  height: number;
  radiusOptions: Record<MapSize, number>;
}
