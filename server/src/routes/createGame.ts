// server/src/routes/createGame.ts
import { CORS_HEADERS, MAP_SIZES, MAX_BIOME_ID, MAX_NATIONS } from "../constants";
import { GameService } from "../game-state";
import { encode } from "../serialization";
import type { MapSize, NationCreationInput, NationPreset } from "../types";

/**
 * Supported biome data formats for terrain upload
 */
const SUPPORTED_CONTENT_TYPES = [
  'application/json',
] as const;

/**
 * Given client-generated binary terrain data, returns gameId and joinCode on success.
 */
export async function createGame(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "application/json";

    if (!SUPPORTED_CONTENT_TYPES.some(type => contentType.includes(type))) {
      return new Response(
        JSON.stringify({
          error: "Unsupported content type",
          supportedTypes: SUPPORTED_CONTENT_TYPES,
          received: contentType,
        }),
        {
          status: 415,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON payload", details: error?.message }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    const mapSize = (payload.mapSize || "xl") as MapSize;
    const cellCount = Number(payload.cellCount ?? (Array.isArray(payload.biomes) ? payload.biomes.length : 0));
    const biomesInput = payload.biomes;
    const nationsInput = payload.nations as Array<{ name: string; preset: string }> | undefined;
    const seed = payload.seed;

    if (!Number.isFinite(cellCount) || cellCount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid cell count" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS,
        },
      });
    }

    if (!MAP_SIZES.includes(mapSize)) {
      return new Response(
        JSON.stringify({
          error: "Invalid map size",
          validSizes: MAP_SIZES,
          received: mapSize,
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

    if (!Array.isArray(biomesInput)) {
      return new Response(
        JSON.stringify({ error: "Biomes must be an array of integers" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
          },
        }
      );
    }

    const biomes = new Uint8Array(biomesInput.length);
    for (let i = 0; i < biomesInput.length; i++) {
      const value = Number(biomesInput[i]);
      if (!Number.isFinite(value) || value < 0 || value > MAX_BIOME_ID) {
        return new Response(
          JSON.stringify({
            error: "Invalid biome values detected",
            index: i,
            maxValue: MAX_BIOME_ID,
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
      biomes[i] = value;
    }

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

    if (!Array.isArray(nationsInput) || nationsInput.length < 2) {
      return new Response(
        JSON.stringify({
          error: "At least two nations are required",
          min: 2,
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

    if (nationsInput.length > MAX_NATIONS) {
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

    const errors: Array<{ index: number; field: 'name' | 'preset'; message: string }> = [];
    const nameSet = new Map<string, number>();
    const duplicateFirst = new Set<number>();
    const nationInputs: NationCreationInput[] = nationsInput.map((nation, index) => {
      const trimmedName = (nation.name ?? '').toString().trim();
      const preset = nation.preset as NationPreset;

      if (trimmedName.length === 0) {
        errors.push({ index, field: 'name', message: 'Name is required' });
      } else {
        const key = trimmedName.toLowerCase();
        if (nameSet.has(key)) {
          errors.push({ index, field: 'name', message: 'Name must be unique' });
          const firstIndex = nameSet.get(key)!;
          if (!duplicateFirst.has(firstIndex)) {
            errors.push({ index: firstIndex, field: 'name', message: 'Name must be unique' });
            duplicateFirst.add(firstIndex);
          }
        } else {
          nameSet.set(key, index);
        }
      }

      const presetValid = (
        preset === 'Industrializing Exporter' ||
        preset === 'Agrarian Surplus' ||
        preset === 'Finance and Services Hub' ||
        preset === 'Research State' ||
        preset === 'Defense-Manufacturing Complex' ||
        preset === 'Balanced Mixed Economy'
      );
      if (!presetValid) {
        errors.push({ index, field: 'preset', message: 'Preset must be selected' });
      }

      return { name: trimmedName, preset: presetValid ? preset : 'Industrializing Exporter' };
    });

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid nation configuration', errors }),
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
      mapSize,
      cellCount,
      nationInputs,
      biomes,
      seed
    );

    console.log(
      `Created game ${gameId} with join code ${joinCode} (${mapSize}, ${cellCount} cells, ${contentType})`
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