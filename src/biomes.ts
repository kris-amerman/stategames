import { createNoise2D } from 'simplex-noise';

// Biome IDs
export const BIOMES = {
  PLAINS: 0,
  WOODS: 1,
  RAINFOREST: 2,
  WETLANDS: 3,
  HILLS: 4,
  MOUNTAINS: 5,
  SHALLOW_OCEAN: 6,
  DEEP_OCEAN: 7,
  TUNDRA_PLAINS: 8,
  TUNDRA_WOODS: 9,
  TUNDRA_HILLS: 10,
  TUNDRA_MOUNTAINS: 11,
  DESERT_PLAINS: 12,
  DESERT_HILLS: 13,
  DESERT_MOUNTAINS: 14
} as const;

// TODO normalize config struct across mapgen modules
interface NoiseConfig {
  frequency: number;
  amplitude: number;
  octaves: number;
}

// Returns the biome ID associated with each cell (in order of cell id).
// Each biome has a unique ID (e.g. 0, 1, 2, ...)

// TODO more realistic logic instead of just noise? Or doesn't matter for us?
// TODO more contiguous biomes instead of noisy patches? Just playing around w octaves?
export function assignBiomes(
  cellCenters: Float64Array,
  cellElevations: Float64Array,
  cellNeighbors: Int32Array, // flattened list of neighboring cell ids for each cell
  cellOffsets: Uint32Array,   // offsets into cellNeighbors, ordered by cell id (length = cellCount+1)
  waterLevel: number = 0.5,
  moistureConfig: NoiseConfig = { frequency: 0.02, amplitude: 1.0, octaves: 3 },
  temperatureConfig: NoiseConfig = { frequency: 0.015, amplitude: 1.0, octaves: 2 }
): Uint8Array {
  const numCells = cellCenters.length / 2;
  const cellBiomes = new Uint8Array(numCells);

  // Create noise generators
  const moistureNoise = createNoise2D();
  const temperatureNoise = createNoise2D();

  // Pre-calculate noise values for efficiency
  const moistureValues = new Float32Array(numCells);
  const temperatureValues = new Float32Array(numCells);

  for (let cid = 0; cid < numCells; cid++) {
    const x = cellCenters[2 * cid];
    const y = cellCenters[2 * cid + 1];

    // Calculate moisture using multiple octaves
    let moisture = 0;
    let tempFreq = moistureConfig.frequency;
    let tempAmp = moistureConfig.amplitude;
    for (let i = 0; i < moistureConfig.octaves; i++) {
      moisture += moistureNoise(x * tempFreq, y * tempFreq) * tempAmp;
      tempFreq *= 2;
      tempAmp *= 0.5;
    }
    moistureValues[cid] = (moisture + 1) * 0.5; // Normalize to 0-1

    // Calculate temperature using multiple octaves
    let temperature = 0;
    tempFreq = temperatureConfig.frequency;
    tempAmp = temperatureConfig.amplitude;
    for (let i = 0; i < temperatureConfig.octaves; i++) {
      temperature += temperatureNoise(x * tempFreq, y * tempFreq) * tempAmp;
      tempFreq *= 2;
      tempAmp *= 0.5;
    }
    temperatureValues[cid] = (temperature + 1) * 0.5; // Normalize to 0-1
  }

  // Assign biomes based on elevation, moisture, and temperature
  for (let cid = 0; cid < numCells; cid++) {
    const elevation = cellElevations[cid];
    const moisture = moistureValues[cid];
    const temperature = temperatureValues[cid];

    let biome: number;

    // Water biomes
    if (elevation <= waterLevel) {
      if (elevation < waterLevel - 0.1) {
        biome = BIOMES.DEEP_OCEAN;
      } else {
        biome = BIOMES.SHALLOW_OCEAN;
      }
    }
    // Land biomes
    else {
      // Determine base biome by elevation and moisture
      if (elevation > 0.8) {
        // Mountains
        if (temperature < 0.3) {
          biome = BIOMES.TUNDRA_MOUNTAINS;
        } else if (temperature > 0.7 && moisture < 0.3) {
          biome = BIOMES.DESERT_MOUNTAINS;
        } else {
          biome = BIOMES.MOUNTAINS;
        }
      } else if (elevation > 0.65) {
        // Hills
        if (temperature < 0.3) {
          biome = BIOMES.TUNDRA_HILLS;
        } else if (temperature > 0.7 && moisture < 0.3) {
          biome = BIOMES.DESERT_HILLS;
        } else {
          biome = BIOMES.HILLS;
        }
      } else {
        // Lower elevation terrain
        if (temperature < 0.3) {
          // Tundra conditions
          if (moisture > 0.6) {
            biome = BIOMES.TUNDRA_WOODS;
          } else {
            biome = BIOMES.TUNDRA_PLAINS;
          }
        } else if (temperature > 0.7 && moisture < 0.3) {
          // Desert conditions
          biome = BIOMES.DESERT_PLAINS;
        } else if (moisture > 0.8) {
          // Very wet
          biome = BIOMES.RAINFOREST;
        } else if (moisture > 0.6) {
          // Moderately wet
          if (elevation < waterLevel + 0.05) {
            biome = BIOMES.WETLANDS;
          } else {
            biome = BIOMES.WOODS;
          }
        } else if (moisture > 0.4) {
          // Moderate moisture
          biome = BIOMES.WOODS;
        } else {
          // Low moisture
          biome = BIOMES.PLAINS;
        }
      }
    }

    cellBiomes[cid] = biome;
  }

  return cellBiomes;
}

// Helper function to get biome name from ID
export function getBiomeName(biomeId: number): string {
  const biomeNames = [
    'Plains', 'Woods', 'Rainforest', 'Wetlands', 'Hills', 'Mountains',
    'Shallow Ocean', 'Deep Ocean', 'Tundra Plains', 'Tundra Woods',
    'Tundra Hills', 'Tundra Mountains', 'Desert Plains', 'Desert Hills',
    'Desert Mountains'
  ];
  return biomeNames[biomeId] || 'Unknown';
}