import {
  loadMeshData,
  generateMesh,
  saveMeshData,
  serializeMeshData,
} from "./mesh";
import type { MeshData, MapSize, SerializedMeshData } from "./mesh/types";

/**
 * In-memory cache for loaded mesh data to avoid repeated file I/O
 */
class MeshCache {
  private cache = new Map<MapSize, MeshData>();

  async get(size: MapSize): Promise<MeshData | null> {
    // Return cached version if available
    if (this.cache.has(size)) {
      return this.cache.get(size)!;
    }

    // Try to load from disk
    const meshData = await loadMeshData(size);
    if (meshData) {
      this.cache.set(size, meshData);
      return meshData;
    }

    return null;
  }

  set(size: MapSize, meshData: MeshData): void {
    this.cache.set(size, meshData);
  }

  clear(): void {
    this.cache.clear();
  }

  has(size: MapSize): boolean {
    return this.cache.has(size);
  }
}

class MeshService {
  private cache = new MeshCache();

  /**
   * Gets mesh data for a given size, with fallback to generation if not found
   */
  async getMeshData(size: MapSize): Promise<MeshData> {
    // Try cache/disk first
    let meshData = await this.cache.get(size);

    if (!meshData) {
      console.warn(`Mesh data for ${size} not found, generating on-the-fly...`);
      // Generate and cache for future requests
      meshData = generateMesh(size);
      this.cache.set(size, meshData);

      // Save to disk for next server restart
      try {
        await saveMeshData(size, meshData);
      } catch (error) {
        console.error(`Failed to save generated ${size} mesh:`, error);
        // Continue anyway since we have the data in memory
      }
    }

    return meshData;
  }

  /**
   * Gets serialized mesh data ready for JSON response
   */
  async getSerializedMeshData(size: MapSize): Promise<SerializedMeshData> {
    const meshData = await this.getMeshData(size);
    return serializeMeshData(meshData);
  }

  /**
   * Preloads all mesh sizes into cache (useful for server startup)
   */
  async preloadAllMeshes(): Promise<void> {
    const sizes: MapSize[] = ["small", "medium", "large", "xl"];

    console.log("Preloading mesh data...");
    const loadPromises = sizes.map(async (size) => {
      try {
        await this.getMeshData(size);
        console.log(`✅ Loaded ${size} mesh`);
      } catch (error) {
        console.error(`❌ Failed to load ${size} mesh:`, error);
      }
    });

    await Promise.all(loadPromises);
    console.log("Mesh preloading complete");
  }

  /**
   * Clears the mesh cache (useful for development/testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const meshService = new MeshService();
export { MeshService };
