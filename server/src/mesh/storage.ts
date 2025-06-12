// server/src/mesh/storage.ts
import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { encode, decode } from '@msgpack/msgpack';
import type { MeshData, MapSize } from "../types";
import { MESH_DATA_DIR } from "../constants";

/**
 * Ensures the mesh data directory exists
 */
async function ensureMeshDataDir(): Promise<void> {
  if (!existsSync(MESH_DATA_DIR)) {
    await mkdir(MESH_DATA_DIR, { recursive: true });
  }
}

/**
 * Gets the full file path for a mesh file (always binary)
 */
function getMeshFilePath(size: MapSize): string {
  const filename = `${size}-mesh.msgpack`;
  return join(MESH_DATA_DIR, filename);
}

/**
 * Saves generated mesh data to disk as MessagePack binary (only if file doesn't exist)
 */
export async function saveMeshData(
  size: MapSize,
  meshData: MeshData
): Promise<void> {
  await ensureMeshDataDir();

  const filePath = getMeshFilePath(size);

  // Safety check: never overwrite existing mesh files
  if (existsSync(filePath)) {
    throw new Error(
      `❌ Mesh file ${filePath} already exists! ` +
      `Overwriting would break existing saved games. ` +
      `Delete the file manually if you're certain you want to regenerate it.`
    );
  }

  const binaryData = encode(meshData);
  await writeFile(filePath, binaryData);

  console.log(`✅ Saved ${size} mesh to ${filePath}`);
}

/**
 * Loads mesh data from disk
 */
export async function loadMeshData(size: MapSize): Promise<MeshData | null> {
  const filePath = getMeshFilePath(size);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const binaryData = await readFile(filePath);
    return decode(binaryData) as MeshData;
  } catch (error) {
    console.error(`Failed to load mesh data for ${size}:`, error);
    return null;
  }
}

/**
 * Checks if mesh data exists for a given size
 */
export function meshDataExists(size: MapSize): boolean {
  const filePath = getMeshFilePath(size);
  return existsSync(filePath);
}