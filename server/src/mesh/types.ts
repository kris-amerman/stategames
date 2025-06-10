export type MapSize = "small" | "medium" | "large" | "xl";

export type MeshData = {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellTriangleCenters: Float64Array;
  cellCount: number;
};

export interface SerializedMeshData {
  allVertices: number[];
  cellOffsets: number[];
  cellVertexIndices: number[];
  cellNeighbors: number[];
  cellTriangleCenters: number[];
  cellCount: number;
}

export interface MeshConfig {
  width: number;
  height: number;
  radiusOptions: Record<MapSize, number>;
}
