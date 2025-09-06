// server/src/routes/createGame.ts
import { CORS_HEADERS, MAP_SIZES, MAX_BIOME_ID, MAX_NATIONS } from "../constants";
import { GameService } from "../game-state";
import { encode } from "../serialization";
import type { MapSize } from "../types";

/**
 * Supported biome data formats for terrain upload
 */
const SUPPORTED_CONTENT_TYPES = [
  'application/octet-stream',  // Raw binary Uint8Array
] as const;

/**
 * Given client-generated binary terrain data, returns gameId and joinCode on success.
 */
export async function createGame(req: Request) {
  try {
    // Get cell count and map size from headers
    const cellCount = parseInt(req.headers.get("x-cell-count") || "0");
    const mapSizeHeader = (req.headers.get("x-map-size") as MapSize) || "xl";
    const nationCount = parseInt(req.headers.get("x-nation-count") || "0");
    const contentType = req.headers.get("content-type") || "application/octet-stream";

    // Validate inputs
    if (!cellCount || cellCount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid cell count" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    if (!nationCount || nationCount <= 0 || nationCount > MAX_NATIONS) {
      return new Response(
        JSON.stringify({ error: "Invalid nation count", max: MAX_NATIONS }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    if (!MAP_SIZES.includes(mapSizeHeader)) {
      return new Response(
        JSON.stringify({
          error: "Invalid map size",
          validSizes: MAP_SIZES,
          received: mapSizeHeader,
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Validate content type
    if (!SUPPORTED_CONTENT_TYPES.includes(contentType as any)) {
      return new Response(
        JSON.stringify({
          error: "Unsupported content type for biome data",
          supportedTypes: SUPPORTED_CONTENT_TYPES,
          received: contentType
        }),
        {
          status: 415, // Unsupported Media Type
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Parse biome data based on content type
    let biomes: Uint8Array;
    
    try {
      switch (contentType) {
        case 'application/octet-stream':
          // Raw binary data - should already be Uint8Array
          const arrayBuffer = await req.arrayBuffer();
          biomes = new Uint8Array(arrayBuffer);
          break;
          
        default:
          throw new Error(`Unsupported content type: ${contentType}`);
      }
    } catch (parseError: any) {
      return new Response(
        JSON.stringify({
          error: "Failed to parse biome data",
          contentType,
          details: parseError.message,
          hint: "Ensure data format matches content-type header"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Validate biome data length
    if (biomes.length !== cellCount) {
      return new Response(
        JSON.stringify({
          error: "Biome data length mismatch",
          expected: cellCount,
          received: biomes.length,
          hint: "Biome array length must match x-cell-count header"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Validate biome values are in valid range (0-MAX_BIOME_ID)
    const invalidIndices: number[] = [];
    for (let i = 0; i < biomes.length && invalidIndices.length < 5; i++) {
      if (biomes[i] > MAX_BIOME_ID) {
        invalidIndices.push(i);
      }
    }
    
    if (invalidIndices.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid biome values detected",
          invalidIndices: invalidIndices.slice(0, 5),
          maxValue: MAX_BIOME_ID,
          hint: `All biome values must be 0-${MAX_BIOME_ID}`
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Generate game ID and join code
    const gameId = GameService.generateGameId();
    const joinCode = GameService.generateJoinCode();

    // Create game and generate world
    const game = await GameService.createGame(
      gameId,
      joinCode,
      mapSizeHeader,
      cellCount,
      nationCount,
      biomes
    );

    console.log(
      `Created game ${gameId} with join code ${joinCode} (${mapSizeHeader}, ${cellCount} cells, ${contentType})`
    );

    const body = encode({
      gameId: game.meta.gameId,
      joinCode: game.meta.joinCode,
      players: game.meta.players,
      game,
    });

    return new Response(body, {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error("Game creation error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
}