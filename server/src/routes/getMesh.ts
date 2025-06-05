import { CORS_HEADERS } from "..";
import type { MapSize } from "../mesh";
import { meshService } from "../mesh-service";

/**
 * Dynamic routes for static map meshes
 */
export async function getMesh(sizeParam: string): Promise<Response> {
  const validSizes: MapSize[] = ["small", "medium", "large", "xl"];

  if (!sizeParam || !validSizes.includes(sizeParam as MapSize)) {
    return new Response(
      JSON.stringify({
        error: "Invalid map size",
        validSizes,
        received: sizeParam,
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  const size = sizeParam as MapSize;

  try {
    console.log(`Serving ${size} mesh data...`);
    const startTime = Date.now();

    const meshData = await meshService.getSerializedMeshData(size);

    const duration = Date.now() - startTime;
    console.log(`✅ Served ${size} mesh in ${duration}ms`);

    return new Response(
      JSON.stringify({
        size,
        meshData,
        meta: {
          cellCount: meshData.cellOffsets.length - 1,
          vertexCount: meshData.allVertices.length / 2,
          generatedAt: new Date().toISOString(),
          responseTimeMs: duration,
        },
      }),
      {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error: any) {
    console.error(`❌ Failed to serve ${size} mesh:`, error);
    return new Response(
      JSON.stringify({
        error: "Failed to serve mesh data",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
}
