export type MapSize = "small" | "medium" | "large" | "xl";

export type MeshData = {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellTriangleCenters: Float64Array;
  cellCount: number;
};

export function deserializeTypedArrays(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'object' && obj.__typedArray === true) {
    const { type, data } = obj;
    switch (type) {
      case 'Float64Array': return new Float64Array(data);
      case 'Uint8Array': return new Uint8Array(data);
      case 'Uint32Array': return new Uint32Array(data);
      case 'Int32Array': return new Int32Array(data);
      case 'Float32Array': return new Float32Array(data);
      case 'Uint16Array': return new Uint16Array(data);
      case 'Int16Array': return new Int16Array(data);
      default: throw new Error(`Unknown TypedArray type: ${type}`);
    }
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deserializeTypedArrays(item));
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deserializeTypedArrays(value);
    }
    return result;
  }

  return obj;
}

function deserializeMeshData(serialized: any): MeshData {
  const deserialized = deserializeTypedArrays(serialized);
  return {
    allVertices: deserialized.allVertices,
    cellOffsets: deserialized.cellOffsets,
    cellVertexIndices: deserialized.cellVertexIndices,
    cellNeighbors: deserialized.cellNeighbors,
    cellTriangleCenters: deserialized.cellTriangleCenters,
    cellCount: deserialized.cellCount
  };
}

const meshCache = new Map<MapSize, MeshData>();
const meshLoadingStates = new Map<MapSize, 'loading' | 'loaded' | 'error'>();

export async function loadMesh(size: MapSize, baseUrl: string): Promise<MeshData | null> {
  if (meshLoadingStates.get(size) === 'loading') {
    while (meshLoadingStates.get(size) === 'loading') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return meshCache.get(size) || null;
  }

  if (meshCache.has(size)) {
    return meshCache.get(size)!;
  }

  meshLoadingStates.set(size, 'loading');
  try {
    console.log(`Fetching ${size} mesh from ${baseUrl}/api/mesh/${size}...`);
    console.time(`fetch-${size}`);
    const response = await fetch(`${baseUrl}/api/mesh/${size}`);
    if (!response.ok) {
      throw new Error(`\u274c ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    console.timeEnd(`fetch-${size}`);
    const meshData = deserializeMeshData(data);
    meshCache.set(size, meshData);
    meshLoadingStates.set(size, 'loaded');
    console.log(`\u2705 Loaded ${size} mesh: ${meshData.cellCount} cells`);
    return meshData;
  } catch (error) {
    console.error(error);
    meshLoadingStates.set(size, 'error');
    return null;
  }
}

export async function preloadAllMeshes(baseUrl: string): Promise<void> {
  const sizes: MapSize[] = ['small', 'medium', 'large', 'xl'];
  console.log('Preloading all meshes from server...');
  const fetchPromises = sizes.map(size => loadMesh(size, baseUrl).catch(err => {
    console.error(`Failed to preload ${size} mesh:`, err);
  }));
  Promise.all(fetchPromises).then(() => {
    console.log('All meshes preloaded!');
  });
}
