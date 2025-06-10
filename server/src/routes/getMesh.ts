import { CORS_HEADERS } from "..";
import type { MapSize, SerializedMeshData } from "../mesh";
import { meshService } from "../mesh-service";

/**
 * Dynamic routes for static map meshes. Returns SerializedMeshData on success.
 */
export async function getMesh(sizeParam: string): Promise<Response> {
  const validSizes: MapSize[] = ["small", "medium", "large", "xl"]; // TODO move to a config outside (single source of truth)

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
    const meshData: SerializedMeshData = await meshService.getSerializedMeshData(size);
    return new Response(
      JSON.stringify({
        meshData,
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
