import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { MESH_DATA_DIR, getMeshFileName } from "./config";
import { serializeMeshData, deserializeMeshData } from "./serializer";
import type { MeshData, SerializedMeshData, MapSize } from "./types";

/**
 * Ensures the mesh data directory exists
 */
async function ensureMeshDataDir(): Promise<void> {
  if (!existsSync(MESH_DATA_DIR)) {
    await mkdir(MESH_DATA_DIR, { recursive: true });
  }
}

/**
 * Saves generated mesh data to disk as JSON
 */
export async function saveMeshData(
  size: MapSize,
  meshData: MeshData
): Promise<void> {
  await ensureMeshDataDir();

  const serialized = serializeMeshData(meshData);
  const filePath = join(MESH_DATA_DIR, getMeshFileName(size));

  await writeFile(filePath, JSON.stringify(serialized, null, 2));
  console.log(`Saved ${size} mesh to ${filePath}`);
}

/**
 * Loads mesh data from disk
 */
export async function loadMeshData(size: MapSize): Promise<MeshData | null> {
  const filePath = join(MESH_DATA_DIR, getMeshFileName(size));

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const fileContent = await readFile(filePath, "utf-8");
    const serialized: SerializedMeshData = JSON.parse(fileContent);
    return deserializeMeshData(serialized);
  } catch (error) {
    console.error(`Failed to load mesh data for ${size}:`, error);
    return null;
  }
}

/**
 * Checks if mesh data exists for a given size
 */
export function meshDataExists(size: MapSize): boolean {
  const filePath = join(MESH_DATA_DIR, getMeshFileName(size));
  return existsSync(filePath);
}
