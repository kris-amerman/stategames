import type { MeshData, SerializedMeshData } from "./types";

/**
 * Serializes MeshData for JSON storage/transmission.
 * Converts TypedArrays to regular arrays to preserve precision.
 */
export function serializeMeshData(meshData: MeshData): SerializedMeshData {
  return {
    allVertices: Array.from(meshData.allVertices),
    cellOffsets: Array.from(meshData.cellOffsets),
    cellVertexIndices: Array.from(meshData.cellVertexIndices),
    cellNeighbors: Array.from(meshData.cellNeighbors),
    cellTriangleCenters: Array.from(meshData.cellTriangleCenters),
  };
}

/**
 * Deserializes JSON data back to MeshData with proper TypedArrays.
 * This ensures the client receives the data in the expected format.
 */
export function deserializeMeshData(serialized: SerializedMeshData): MeshData {
  return {
    allVertices: new Float64Array(serialized.allVertices),
    cellOffsets: new Uint32Array(serialized.cellOffsets),
    cellVertexIndices: new Uint32Array(serialized.cellVertexIndices),
    cellNeighbors: new Int32Array(serialized.cellNeighbors),
    cellTriangleCenters: new Float64Array(serialized.cellTriangleCenters),
  };
}
