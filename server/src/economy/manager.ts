import type {
  EconomyState,
  SectorDefinition,
  SectorState,
  SectorType,
  CantonEconomy,
  TileType,
} from '../types';
import {
  SECTOR_BASE_OUTPUT,
  SLOT_REQUIREMENTS,
  type SlotRequirement,
  type SectorOutputTable,
} from './data';
export { SECTOR_BASE_OUTPUT, SLOT_REQUIREMENTS } from './data';

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
      energy: {
        plants: [],
        state: { supply: 0, demand: 0, ratio: 1 },
        demandBySector: {},
        brownouts: [],
        essentialsFirst: false,
        fuelUsed: {},
        oAndMSpent: 0,
      },
      infrastructure: {
        airports: {},
        ports: {},
        railHubs: {},
        national: {},
      },
      projects: { nextId: 1, projects: [] },
      finance: {
        debt: 0,
        creditLimit: 1000,
        interestRate: 0.05,
        defaulted: false,
        debtStress: [],
        summary: {
          revenues: 0,
          expenditures: 0,
          netBorrowing: 0,
          interest: 0,
          defaulted: false,
        },
      },
      welfare: {
        current: { education: 0, healthcare: 0, socialSupport: 0 },
        next: { education: 0, healthcare: 0, socialSupport: 0 },
      },
      trade: { pendingImports: {}, pendingExports: {} },
    };
  }

  /** Lookup base output per active slot for a sector. */
  static getBaseOutput(sector: SectorType): SectorOutputTable {
    return SECTOR_BASE_OUTPUT[sector] || {};
  }

  /** Lookup per-slot operating requirements for a sector. */
  static getSlotRequirements(sector: SectorType): SlotRequirement {
    return (
      SLOT_REQUIREMENTS[sector] || { energy: 0, logistics: 0, inputs: {} }
    );
  }

  /** Register a new canton with empty sector and labor data. */
  static addCanton(state: EconomyState, cantonId: string, initial?: Partial<CantonEconomy>): void {
    const normalizeGeography = (geo?: Record<TileType, number>): Record<TileType, number> => {
      if (!geo) return { plains: 1 } as Record<TileType, number>;
      let total = 0;
      for (const value of Object.values(geo)) {
        if (Number.isFinite(value)) {
          total += Math.max(0, value);
        }
      }
      if (total <= 0) {
        return { plains: 1 } as Record<TileType, number>;
      }
      const normalized: Record<TileType, number> = {} as any;
      for (const [key, value] of Object.entries(geo)) {
        const numeric = Math.max(0, value ?? 0);
        if (numeric > 0) {
          normalized[key as TileType] = numeric / total;
        }
      }
      return Object.keys(normalized).length > 0 ? normalized : ({ plains: 1 } as Record<TileType, number>);
    };

    if (state.cantons[cantonId]) {
      if (!initial) return;
      const canton = state.cantons[cantonId];
      if (initial.sectors) {
        canton.sectors = { ...canton.sectors, ...initial.sectors };
      }
      if (initial.labor) {
        canton.labor = { ...canton.labor, ...initial.labor };
      }
      if (initial.laborDemand) {
        canton.laborDemand = { ...initial.laborDemand };
      }
      if (initial.laborAssigned) {
        canton.laborAssigned = { ...initial.laborAssigned };
      }
      if (initial.geography) {
        canton.geography = normalizeGeography(initial.geography);
      }
      if (initial.suitability) {
        canton.suitability = { ...initial.suitability };
      }
      if (initial.suitabilityMultipliers) {
        canton.suitabilityMultipliers = { ...initial.suitabilityMultipliers };
      }
      if (initial.urbanizationLevel !== undefined) {
        canton.urbanizationLevel = initial.urbanizationLevel;
      }
      if (initial.nextUrbanizationLevel !== undefined) {
        canton.nextUrbanizationLevel = initial.nextUrbanizationLevel;
      }
      if (initial.development !== undefined) {
        canton.development = initial.development;
      }
      return;
    }

    const canton: CantonEconomy = {
      sectors: {} as Record<SectorType, SectorState>,
      labor: { general: 0, skilled: 0, specialist: 0 },
      laborDemand: {},
      laborAssigned: {},
      lai: 1,
      happiness: 0,
      consumption: {
        foodRequired: 0,
        foodProvided: 0,
        luxuryRequired: 0,
        luxuryProvided: 0,
      },
      shortages: { food: false, luxury: false },
      urbanizationLevel: 1,
      development: 0,
      nextUrbanizationLevel: 1,
      geography: normalizeGeography(initial?.geography as Record<TileType, number> | undefined),
      suitability: {},
      suitabilityMultipliers: {},
    };

    if (initial) {
      if (initial.sectors) {
        canton.sectors = { ...initial.sectors } as Record<SectorType, SectorState>;
      }
      if (initial.labor) {
        canton.labor = { ...canton.labor, ...initial.labor };
      }
      if (initial.laborDemand) {
        canton.laborDemand = { ...initial.laborDemand };
      }
      if (initial.laborAssigned) {
        canton.laborAssigned = { ...initial.laborAssigned };
      }
      if (initial.suitability) {
        canton.suitability = { ...initial.suitability };
      }
      if (initial.suitabilityMultipliers) {
        canton.suitabilityMultipliers = { ...initial.suitabilityMultipliers };
      }
      if (initial.urbanizationLevel !== undefined) {
        canton.urbanizationLevel = initial.urbanizationLevel;
      }
      if (initial.nextUrbanizationLevel !== undefined) {
        canton.nextUrbanizationLevel = initial.nextUrbanizationLevel;
      }
      if (initial.development !== undefined) {
        canton.development = initial.development;
      }
    }

    state.cantons[cantonId] = canton;
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

