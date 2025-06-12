import { CORS_HEADERS } from "..";
import { GameService } from "../game-state";
import type { MapSize } from "../types";
import pako from 'pako';

/**
 * Given client-generated terrain data (Uint8Array of biomes), returns gameId and joinCode on success.
 */
export async function createGame(req: Request) {
  try {
    // Get cell count and map size from headers
    const cellCount = parseInt(req.headers.get("x-cell-count") || "0");
    const mapSizeHeader = (req.headers.get("x-map-size") as MapSize) || "xl";

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

    const validMapSizes: MapSize[] = ["small", "medium", "large", "xl"]; // TODO LATER: move to a config
    if (!validMapSizes.includes(mapSizeHeader)) {
      return new Response(
        JSON.stringify({
          error: "Invalid map size",
          validSizes: validMapSizes,
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

    // Read and validate terrain data
    const arrayBuffer = await req.arrayBuffer();
    let biomes: Uint8Array;

    // Check if data is compressed
    const contentEncoding = req.headers.get("content-encoding");
    if (contentEncoding === "gzip") {
      const compressedData = new Uint8Array(arrayBuffer);
      biomes = pako.ungzip(compressedData);
    } else {
      biomes = new Uint8Array(arrayBuffer);
    }

    // Validate terrain data
    if (biomes.length !== cellCount) {
      return new Response(
        JSON.stringify({
          error: "Biome data length mismatch",
          expected: cellCount,
          received: biomes.length,
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

    // Create game state
    const gameState = await GameService.createGame(
      gameId,
      joinCode,
      mapSizeHeader,
      cellCount,
      "player1", // TODO LATER: change this to player account id/username
      biomes
    );

    // Save terrain data
    await GameService.saveTerrainData(gameId, biomes);

    console.log(
      `Created game ${gameId} with join code ${joinCode} (${mapSizeHeader}, ${cellCount} cells)`
    );

    return new Response(
      JSON.stringify({
        gameId: gameState.gameId,
        joinCode: gameState.joinCode,
      }),
      {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      }
    );
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
