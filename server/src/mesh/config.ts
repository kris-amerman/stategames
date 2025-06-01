import type { MeshConfig } from "./types";

export const MESH_CONFIG: MeshConfig = {
  width: 960,
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
