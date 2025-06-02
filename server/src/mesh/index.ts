// Main exports for the mesh module
export { generateMesh } from "./generator";
export { saveMeshData, loadMeshData, meshDataExists } from "./storage";
export { serializeMeshData, deserializeMeshData } from "./serializer";
export { MESH_CONFIG, MESH_DATA_DIR, getMeshFileName } from "./config";
export * from "./types";
export { DualMesh } from "./dual-mesh";
