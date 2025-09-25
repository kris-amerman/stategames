import type { PlantType, SectorType, TileType } from '../../types';

export interface WeightedLevel {
  level: number;
  weight: number;
}

export interface RangeConfig {
  min: number;
  max: number;
}

export const INITIALIZATION_CONFIG = {
  rng: {
    modulus: 2147483647,
    multiplier: 16807,
  },
  urbanization: {
    weights: [
      { level: 2, weight: 5 },
      { level: 3, weight: 4 },
      { level: 4, weight: 1 },
    ] as WeightedLevel[],
  },
  development: {
    meterPerLevel: 4,
    progress: { min: 0.25, max: 0.6 } as RangeConfig,
  },
  welfare: {
    educationTier: { min: 1, max: 2 },
    healthcareTier: { min: 1, max: 2 },
    socialSupportTier: 0,
    stocksPerLabor: {
      food: 1.1,
      luxury: 0.5,
    },
  },
  sectorAllocation: {
    shares: {
      agriculture: 0.16,
      extraction: 0.12,
      manufacturing: 0.17,
      defense: 0.1,
      luxury: 0.1,
      finance: 0.08,
      research: 0.1,
      logistics: 0.1,
      energy: 0.07,
    } as Record<SectorType, number>,
    activeFraction: { min: 0.45, max: 0.62 } as RangeConfig,
    idleFraction: { min: 0.12, max: 0.18 } as RangeConfig,
    lockedMinFraction: 0.15,
    minActiveSlots: {
      agriculture: 2,
      extraction: 1,
      manufacturing: 2,
      defense: 1,
      luxury: 1,
      finance: 1,
      research: 1,
      logistics: 2,
      energy: 0,
    } as Partial<Record<SectorType, number>>,
    minIdleSlots: 1,
  },
  geography: {
    coastal: {
      plains: 0.45,
      coast: 0.35,
      woods: 0.2,
    } as Record<TileType, number>,
    inland: {
      plains: 0.6,
      hills: 0.25,
      woods: 0.15,
    } as Record<TileType, number>,
  },
  energy: {
    plantSequence: ['hydro', 'coal', 'wind'] as PlantType[],
    reserveRatio: 1.1,
    fuelStockTurns: 3,
    essentialsFirst: false,
  },
  finance: {
    creditLimit: 1200,
    interestRate: 0.04,
    baseRevenuePerLabor: 2.6,
    revenueVariance: 0.4,
    fallbackRevenueBoost: 8,
    militaryBudget: 6,
    welfareDiscretionary: 0,
    maxAdjustIterations: 3,
    startingTreasury: 120,
  },
  resources: {
    baseMaterialsPerCanton: 18,
    baseProductionPerCanton: 12,
    fxReserves: 10,
  },
};

export type InitializationConfig = typeof INITIALIZATION_CONFIG;
