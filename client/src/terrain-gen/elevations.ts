import { createNoise2D } from 'simplex-noise';

// TODO move somewhere
export interface ElevationConfig {
  amplitudes: number[];
  frequencies: number[];
  octaves: number;
  seed: number;
  waterLevel: number;
  redistribution: 'none' | 'linear' | 'exponential';
  exponentialPower: number;
  elevationShift: number; // Positive = more land, negative = more water
  useIslands: boolean;
}


// Returns a Float64Array indicating the elevation of each cell 
// (in order of cell id -- same order as offsets except length = cell count).
// Elevation is between 0 and 1 -- the water level is at 0.5 by default.

// TODO consider not using Float64 to save on memorys
// TODO consider having mountain ranges as opposed to just spikes of mountain!
export function assignElevations(
  cellCenters: Float64Array, 
  config: ElevationConfig
): Float64Array {
  const numCells = cellCenters.length / 2;
  const cellElevations = new Float64Array(numCells);

  // Default configuration for realistic terrain
  const {
    amplitudes = [0.5, 0.25, 0.125, 0.0625],
    frequencies = [0.01, 0.02, 0.04, 0.08],
    octaves = Math.min(amplitudes.length, frequencies.length),
    seed = Math.random(),
    waterLevel = 0.5,
    redistribution = 'exponential',
    exponentialPower = 1.2,
    elevationShift = 0
  } = config;

  // Create noise generator with seed
  const noise2D = createNoise2D(() => seed);

  for (let cid = 0; cid < numCells; cid++) {
    const x = cellCenters[2 * cid];
    const y = cellCenters[2 * cid + 1];

    // Generate multi-octave noise
    let e = 0;
    for (let i = 0; i < octaves; i++) {
      const amplitude = amplitudes[i] || amplitudes[amplitudes.length - 1];
      const frequency = frequencies[i] || frequencies[frequencies.length - 1];
      
      // Sample noise at different frequencies and combine
      e += amplitude * noise2D(x * frequency, y * frequency);
    }

    // Normalize from [-1, 1] to [0, 1]
    e = (e + 1) / 2;

    // Apply redistribution to create more interesting terrain
    switch (redistribution) {
      case 'linear':
        // Keep linear distribution
        break;
      case 'exponential':
        // Push values toward extremes for more dramatic terrain
        e = Math.pow(e, exponentialPower);
        break;
      case 'none':
      default:
        // Keep raw noise values
        break;
    }

    // Apply elevation shift to control land/water ratio
    e += elevationShift;

    // Ensure values stay in [0, 1] range
    e = Math.max(0, Math.min(1, e));

    cellElevations[cid] = e;
  }

  return cellElevations;
}

// Utility function to create island-like terrain
export function assignIslandElevations(
  cellCenters: Float64Array,
  config: ElevationConfig
): Float64Array {
  const numCells = cellCenters.length / 2;
  
  // Find the bounds of the terrain
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (let i = 0; i < numCells; i++) {
    const x = cellCenters[2 * i];
    const y = cellCenters[2 * i + 1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const maxDistance = Math.sqrt(
    Math.pow(maxX - centerX, 2) + Math.pow(maxY - centerY, 2)
  );

  // Get base elevations from noise
  const baseElevations = assignElevations(cellCenters, config);
  
  // Apply island mask
  for (let cid = 0; cid < numCells; cid++) {
    const x = cellCenters[2 * cid];
    const y = cellCenters[2 * cid + 1];
    
    // Calculate distance from center
    const distance = Math.sqrt(
      Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
    );
    
    // Create island falloff (higher in center, lower at edges)
    const falloff = 1 - Math.pow(distance / maxDistance, 2);
    
    // Combine base elevation with island falloff
    baseElevations[cid] = Math.max(0, baseElevations[cid] * falloff);
  }
  
  return baseElevations;
}

// ==============================================================================================
// ========================================== PRESETS ===========================================
// ==============================================================================================

// Preset configurations for different terrain types
export const TERRAIN_PRESETS = {
  rolling: {
    amplitudes: [0.4, 0.2, 0.1],
    frequencies: [0.005, 0.01, 0.02],
    redistribution: 'linear'
  },
  mountainous: {
    amplitudes: [0.6, 0.3, 0.15, 0.075],
    frequencies: [0.003, 0.006, 0.012, 0.024],
    redistribution: 'exponential',
    exponentialPower: 1.5
  },
  plains: {
    amplitudes: [0.2, 0.1, 0.05],
    frequencies: [0.002, 0.004, 0.008],
    redistribution: 'linear'
  },
  chaotic: {
    amplitudes: [0.5, 0.25, 0.125, 0.0625, 0.03125],
    frequencies: [0.01, 0.02, 0.04, 0.08, 0.16],
    redistribution: 'exponential',
    exponentialPower: 0.8
  },
  // Land/water ratio presets (combine with terrain types)
  mostlyWater: { elevationShift: -0.2 },    // ~30% land
  balancedTerrain: { elevationShift: 0 },   // ~50% land  
  mostlyLand: { elevationShift: 0.2 },      // ~70% land
  archipelago: { elevationShift: -0.1 },    // ~40% land
  continent: { elevationShift: 0.15 }       // ~65% land
};

// Example usage:
// const elevations = assignElevations(cellCenters, TERRAIN_PRESETS.mountainous);
// const islandElevations = assignIslandElevations(cellCenters, TERRAIN_PRESETS.rolling);