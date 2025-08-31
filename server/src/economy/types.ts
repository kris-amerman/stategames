// server/src/economy/types.ts
// Scaffolding for core economy types, resources and sectors.

/** Resource types that are tracked in the game economy. */
export type ResourceType =
  | 'gold'
  | 'fx'
  | 'food'
  | 'materials'
  | 'production'
  | 'ordnance'
  | 'luxuryGoods'
  | 'energy'
  | 'research'
  | 'logistics'
  | 'laborGeneral'
  | 'laborSkilled'
  | 'laborSpecialist'
  | StrategicResource;

/** Strategic resources are special materials used by advanced sectors. */
export type StrategicResource = 'uranium' | 'coal' | 'oil' | 'rareEarths';

/** Labor categories generated per canton by Urbanization Level and Welfare. */
export type LaborType = 'general' | 'skilled' | 'specialist';

/** Stockpiles of all resource types. */
export interface ResourceStockpiles {
  gold: number;
  fx: number;
  food: number;
  materials: number;
  production: number;
  ordnance: number;
  luxuryGoods: number;
  energy: number;
  research: number;
  logistics: number;
  strategics: Record<StrategicResource, number>;
  labor: Record<LaborType, number>;
}

/** Enumeration of all economic sectors. */
export type SectorType =
  | 'agriculture'
  | 'extraction'
  | 'manufacturing'
  | 'defense'
  | 'luxury'
  | 'finance'
  | 'research'
  | 'logistics'
  | 'energy';

/** Basic definition of sector inputs and outputs. */
export interface SectorDefinition {
  /** Resources generated when a slot is fully utilized. */
  produces: ResourceType[];
  /** Resources consumed when a slot runs. */
  inputs: ResourceType[];
}

/** Mapping of sector types to their definitions. */
export const SECTOR_DEFINITIONS: Record<SectorType, SectorDefinition> = {
  agriculture: {
    produces: ['food'],
    inputs: ['gold', 'laborGeneral', 'energy', 'logistics']
  },
  extraction: {
    produces: ['materials', 'uranium', 'coal', 'oil', 'rareEarths'],
    inputs: ['gold', 'laborGeneral', 'energy', 'logistics']
  },
  manufacturing: {
    produces: ['production'],
    inputs: ['gold', 'materials', 'energy', 'laborSkilled', 'logistics']
  },
  defense: {
    produces: ['ordnance'],
    inputs: [
      'gold',
      'production',
      'materials',
      'energy',
      'laborSkilled',
      'logistics'
    ]
  },
  luxury: {
    produces: ['luxuryGoods'],
    inputs: ['gold', 'production', 'energy', 'laborSkilled', 'logistics']
  },
  finance: {
    produces: ['gold'],
    inputs: ['gold', 'laborSkilled', 'logistics']
  },
  research: {
    produces: ['research'],
    inputs: ['gold', 'laborSpecialist', 'energy', 'logistics']
  },
  logistics: {
    produces: ['logistics'],
    inputs: ['gold', 'laborGeneral', 'energy']
  },
  energy: {
    produces: ['energy'],
    inputs: ['materials'] // fuel types will be refined in future systems
  }
};

/**
 * A sector's slot state within a canton.
 * - capacity: total slots that exist
 * - utilization: slots currently funded and able to run
 * - retooling: slots being converted to another sector and thus unavailable
 */
export interface SectorSlotState {
  capacity: number;
  utilization: number;
  retooling: number;
}

/** Economy state for a single canton. */
export interface CantonEconomy {
  sectors: Record<SectorType, SectorSlotState>;
  /** Suitability multiplier applied to sector output. */
  suitability: Partial<Record<SectorType, number>>;
}

/** Complete economy state for a game. */
export interface EconomyState {
  /** National stockpiles. */
  stockpiles: ResourceStockpiles;
  /** Per-canton economic data. */
  cantons: Record<number, CantonEconomy>;
}

/** Helper to create an empty ResourceStockpiles object. */
export function createEmptyStockpiles(): ResourceStockpiles {
  const strategics: Record<StrategicResource, number> = {
    uranium: 0,
    coal: 0,
    oil: 0,
    rareEarths: 0
  };
  const labor: Record<LaborType, number> = {
    general: 0,
    skilled: 0,
    specialist: 0
  };
  return {
    gold: 0,
    fx: 0,
    food: 0,
    materials: 0,
    production: 0,
    ordnance: 0,
    luxuryGoods: 0,
    energy: 0,
    research: 0,
    logistics: 0,
    strategics,
    labor
  };
}

/** Creates an initial empty economy state. */
export function createInitialEconomyState(): EconomyState {
  return {
    stockpiles: createEmptyStockpiles(),
    cantons: {}
  };
}
