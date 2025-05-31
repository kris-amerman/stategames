import type { MeshGenerationConfig } from "./types";

export const MESH_CONFIG: MeshGenerationConfig = {
  width: 960, // Update these values to match your actual WIDTH/HEIGHT
  height: 600,
  radiusOptions: {
    small: 20,
    medium: 15,
    large: 10,
    xl: 5,
  },
};

// Directory where generated mesh files will be stored
export const MESH_DATA_DIR = "meshes";

// File naming pattern for generated meshes
export const getMeshFileName = (size: string): string => `${size}-mesh.json`;
