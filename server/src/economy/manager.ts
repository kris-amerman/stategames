import type {
  EconomyState,
  SectorDefinition,
  SectorState,
  SectorType,
  CantonEconomy,
} from '../types';

// Definitions for each sector's input and output resources.
export const SECTOR_DEFINITIONS: Record<SectorType, SectorDefinition> = {
  agriculture: {
    outputs: ['food'],
    inputs: ['gold', 'labor', 'energy', 'logistics'],
  },
  extraction: {
    outputs: ['materials', 'uranium', 'coal', 'oil', 'rareEarths'],
    inputs: ['gold', 'labor', 'energy', 'logistics'],
  },
  manufacturing: {
    outputs: ['production'],
    inputs: ['gold', 'materials', 'labor', 'energy', 'logistics'],
  },
  defense: {
    outputs: ['ordnance'],
    inputs: ['gold', 'production', 'materials', 'labor', 'energy', 'logistics'],
  },
  luxury: {
    outputs: ['luxury'],
    inputs: ['gold', 'production', 'labor', 'energy', 'logistics'],
  },
  finance: {
    outputs: ['gold'],
    inputs: ['gold', 'labor', 'logistics'],
  },
  research: {
    outputs: ['research'],
    inputs: ['gold', 'labor', 'energy', 'logistics'],
  },
  logistics: {
    outputs: ['logistics'],
    inputs: ['gold', 'labor', 'energy'],
  },
  energy: {
    outputs: ['energy'],
    inputs: ['gold', 'materials'],
  },
};

/** Basic management utilities for the economy state. */
export class EconomyManager {
  /** Create an empty economy state for a new game. */
  static createInitialState(): EconomyState {
    return {
      resources: {
        gold: 0,
        fx: 0,
        food: 0,
        materials: 0,
        production: 0,
        ordnance: 0,
        luxury: 0,
        energy: 0,
        uranium: 0,
        coal: 0,
        oil: 0,
        rareEarths: 0,
        research: 0,
        logistics: 0,
      labor: 0,
      },
      cantons: {},
      retoolQueue: [],
    };
  }

  /** Register a new canton with empty sector and labor data. */
  static addCanton(state: EconomyState, cantonId: string): void {
    state.cantons[cantonId] = {
      sectors: {} as Record<SectorType, SectorState>,
      labor: { general: 0, skilled: 0, specialist: 0 },
      suitability: {},
    };
  }

  /** Placeholder for slot retooling logic. */
  static retoolSlot(
    _state: EconomyState,
    _cantonId: string,
    _from: SectorType,
    _to: SectorType,
  ): void {
    // TODO: Implement retooling cost and delay mechanics.
  }

  /** Placeholder to advance retool timers each turn. */
  static advanceRetools(_state: EconomyState): void {
    // TODO: Reduce retool counters and activate completed slots.
  }
}

