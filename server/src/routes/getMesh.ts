// server/src/routes/getMesh.ts
import { CORS_HEADERS, MAP_SIZES } from "../constants";
import type { MapSize } from "../types";
import { meshService } from "../mesh-service";
import { encode } from "../serialization";

/**
 * Dynamic routes for static map meshes. Returns binary JSON mesh data.
 */
export async function getMesh(sizeParam: string): Promise<Response> {
  if (!sizeParam || !MAP_SIZES.includes(sizeParam as MapSize)) {
    return new Response(
      JSON.stringify({
        error: "Invalid map size",
        validSizes: MAP_SIZES,
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
    const meshData = await meshService.getMeshData(size);
    const serializedData = encode(meshData);
    
    return new Response(serializedData, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
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