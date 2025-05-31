// Main exports for the mesh module
export { generateMesh } from "./generator";
export { saveMeshData, loadMeshData, meshDataExists } from "./storage";
export { serializeMeshData, deserializeMeshData } from "./serializer";
export { MESH_CONFIG, MESH_DATA_DIR, getMeshFileName } from "./config";
export * from "./types";

// Re-export DualMesh class for direct usage if needed
export { DualMesh } from "./dual-mesh";
