import {
  type Game,
  type PlayerId,
  type SectorType,
  type NationCreationInput,
  type NationState,
  type NationPreset,
  type NationMeta,
  type PlantRegistryEntry,
  type ResourceType,
} from '../types';
import { EconomyManager } from '../economy';
import { OM_COST_PER_SLOT } from '../budget/manager';
import { LP_PER_SLOT, OPERATING_LP_COST } from '../logistics/manager';
import {
  ENERGY_PER_SLOT,
  PLANT_ATTRIBUTES,
  type PlantType,
} from '../energy/manager';
import {
  EDUCATION_TIERS,
  HEALTHCARE_TIERS,
  SOCIAL_SUPPORT_COST,
} from '../welfare/manager';
import { SECTOR_LABOR_TYPES } from '../labor/manager';
import { DEBT_STRESS_TIERS } from '../finance/manager';
import { SeededRandom } from '../utils/random';
import { createEmptyStatusSummary, updateNationStatus } from '../status';

interface StockpileBands {
  food: [number, number];
  fuel: [number, number];
  materials: [number, number];
  fx: [number, number];
  luxury: [number, number];
  ordnance: [number, number];
  production: [number, number];
}

interface NationProfile {
  baseMix: Partial<Record<SectorType, number>>;
  welfare: { education: number; healthcare: number; socialSupport: number };
  projectSectors: SectorType[];
  plantOptions: PlantType[];
  fuelResource: ResourceType;
  stockpiles: StockpileBands;
  stableRevenueMultiplier: number;
  creditLimitMultiplier: number;
  militaryFocus: number;
  nonUniformityTag: string;
}

const IDLE_TAX_RATE = 0.25;
const MIN_LOGISTICS_SLOTS = 2;
const REVENUE_WEIGHTS: Partial<Record<SectorType, number>> = {
  agriculture: 2.5,
  extraction: 3.2,
  manufacturing: 5.0,
  defense: 4.6,
  luxury: 3.4,
  finance: 6.0,
  research: 4.2,
  logistics: 2.1,
};

const PROFILES: Record<NationPreset, NationProfile> = {
  'Industrializing Exporter': {
    baseMix: {
      agriculture: 4,
      extraction: 7,
      manufacturing: 8,
      defense: 2,
      finance: 2,
      logistics: 3,
      luxury: 2,
    },
    welfare: { education: 2, healthcare: 2, socialSupport: 1 },
    projectSectors: ['manufacturing', 'logistics', 'energy'],
    plantOptions: ['coal', 'gas'],
    fuelResource: 'coal',
    stockpiles: {
      food: [2.5, 3.5],
      fuel: [2.5, 3.0],
      materials: [2.6, 3.2],
      fx: [2.8, 3.4],
      luxury: [1.2, 1.5],
      ordnance: [2.0, 2.6],
      production: [2.6, 3.2],
    },
    stableRevenueMultiplier: 1.18,
    creditLimitMultiplier: 4.3,
    militaryFocus: 1.15,
    nonUniformityTag: 'exporter',
  },
  'Agrarian Surplus': {
    baseMix: {
      agriculture: 8,
      extraction: 3,
      manufacturing: 4,
      finance: 2,
      logistics: 3,
      luxury: 2,
      research: 2,
    },
    welfare: { education: 1, healthcare: 1, socialSupport: 1 },
    projectSectors: ['agriculture', 'logistics'],
    plantOptions: ['hydro', 'wind', 'gas'],
    fuelResource: 'oil',
    stockpiles: {
      food: [4.0, 5.0],
      fuel: [2.0, 2.4],
      materials: [2.0, 2.6],
      fx: [2.2, 3.0],
      luxury: [1.1, 1.3],
      ordnance: [1.8, 2.2],
      production: [2.0, 2.4],
    },
    stableRevenueMultiplier: 0.95,
    creditLimitMultiplier: 3.6,
    militaryFocus: 0.85,
    nonUniformityTag: 'agrarian',
  },
  'Finance and Services Hub': {
    baseMix: {
      agriculture: 3,
      manufacturing: 3,
      finance: 8,
      logistics: 3,
      luxury: 3,
      research: 3,
      extraction: 2,
    },
    welfare: { education: 3, healthcare: 2, socialSupport: 1 },
    projectSectors: ['finance', 'logistics', 'research'],
    plantOptions: ['gas', 'wind', 'solar'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.4, 3.2],
      fuel: [2.0, 2.4],
      materials: [2.0, 2.6],
      fx: [3.5, 4.0],
      luxury: [1.3, 1.6],
      ordnance: [1.5, 2.0],
      production: [2.0, 2.4],
    },
    stableRevenueMultiplier: 1.45,
    creditLimitMultiplier: 4.6,
    militaryFocus: 0.8,
    nonUniformityTag: 'finance',
  },
  'Research State': {
    baseMix: {
      agriculture: 4,
      manufacturing: 4,
      finance: 3,
      logistics: 3,
      luxury: 3,
      research: 8,
      extraction: 3,
    },
    welfare: { education: 3, healthcare: 3, socialSupport: 1 },
    projectSectors: ['research', 'energy'],
    plantOptions: ['nuclear', 'wind', 'solar'],
    fuelResource: 'uranium',
    stockpiles: {
      food: [3.0, 4.0],
      fuel: [2.0, 2.4],
      materials: [2.3, 3.0],
      fx: [2.6, 3.4],
      luxury: [1.2, 1.5],
      ordnance: [1.6, 2.0],
      production: [2.0, 2.6],
    },
    stableRevenueMultiplier: 1.32,
    creditLimitMultiplier: 4.2,
    militaryFocus: 0.9,
    nonUniformityTag: 'research',
  },
  'Defense-Manufacturing Complex': {
    baseMix: {
      agriculture: 4,
      extraction: 6,
      manufacturing: 7,
      defense: 6,
      finance: 2,
      logistics: 4,
      luxury: 1,
    },
    welfare: { education: 1, healthcare: 1, socialSupport: 0 },
    projectSectors: ['defense', 'manufacturing', 'energy'],
    plantOptions: ['coal', 'gas', 'oilPeaker'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.2, 3.0],
      fuel: [2.4, 3.0],
      materials: [2.5, 3.1],
      fx: [2.0, 2.8],
      luxury: [1.0, 1.2],
      ordnance: [2.6, 3.4],
      production: [2.6, 3.2],
    },
    stableRevenueMultiplier: 1.15,
    creditLimitMultiplier: 4.1,
    militaryFocus: 1.5,
    nonUniformityTag: 'defense',
  },
  'Balanced Mixed Economy': {
    baseMix: {
      agriculture: 5,
      extraction: 5,
      manufacturing: 5,
      defense: 3,
      finance: 3,
      research: 3,
      logistics: 3,
      luxury: 3,
    },
    welfare: { education: 2, healthcare: 2, socialSupport: 1 },
    projectSectors: ['manufacturing', 'research', 'logistics'],
    plantOptions: ['gas', 'wind', 'hydro'],
    fuelResource: 'oil',
    stockpiles: {
      food: [2.6, 3.4],
      fuel: [2.2, 2.8],
      materials: [2.3, 2.9],
      fx: [2.4, 3.2],
      luxury: [1.2, 1.4],
      ordnance: [2.0, 2.6],
      production: [2.3, 2.9],
    },
    stableRevenueMultiplier: 1.24,
    creditLimitMultiplier: 4.3,
    militaryFocus: 1.05,
    nonUniformityTag: 'balanced',
  },
};

interface CantonInfo {
  cantonId: string;
  capital: number;
  coastal: boolean;
}

function computeCoastal(
  capital: number,
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
): boolean {
  const start = offsets[capital];
  const end = offsets[capital + 1];
  for (let i = start; i < end; i++) {
    const nb = neighbors[i];
    if (nb < 0) continue;
    const biome = biomes[nb];
    if (biome === 6 || biome === 7) {
      return true;
    }
  }
  return false;
}

function computeLogisticsDemand(mix: Record<string, number>): number {
  let demand = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'logistics') continue;
    const cost = OPERATING_LP_COST[sector as SectorType] ?? 0;
    demand += (funded || 0) * cost;
  }
  return demand;
}

function scaleMixToLogistics(
  mix: Record<string, number>,
  logisticSlots: number,
): { demand: number; supply: number; slots: number } {
  let demand = computeLogisticsDemand(mix);
  let slots = Math.max(logisticSlots, MIN_LOGISTICS_SLOTS);
  if (demand <= 0) {
    demand = slots * LP_PER_SLOT;
  }
  const targetSupply = slots * LP_PER_SLOT;
  const scale = targetSupply / demand;
  if (scale > 1.05 || scale < 0.95) {
    for (const key of Object.keys(mix)) {
      if (key === 'logistics') continue;
      const current = mix[key];
      const adjusted = Math.max(1, Math.round(current * scale));
      mix[key] = adjusted;
    }
    demand = computeLogisticsDemand(mix);
  }
  let supply = slots * LP_PER_SLOT;
  if (demand > supply * 0.95) {
    while (demand > supply * 1.05) {
      slots += 1;
      supply = slots * LP_PER_SLOT;
      if (slots > 20) break;
    }
  } else {
    while (supply / demand > 1.5 && slots > MIN_LOGISTICS_SLOTS) {
      slots -= 1;
      supply = slots * LP_PER_SLOT;
      if (supply / demand <= 1.5) break;
    }
  }
  return { demand, supply, slots };
}
function computeEnergyDemand(mix: Record<string, number>): number {
  let demand = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'energy') continue;
    const cost = ENERGY_PER_SLOT[sector as SectorType] ?? 0;
    demand += (funded || 0) * cost;
  }
  return demand;
}

function choosePlants(
  profile: NationProfile,
  canton: string,
  demand: number,
  rng: SeededRandom,
): { plants: PlantRegistryEntry[]; supply: number; fuel: Partial<Record<ResourceType, number>> } {
  const entries: PlantRegistryEntry[] = [];
  const fuel: Partial<Record<ResourceType, number>> = {};
  if (demand <= 0) {
    return { plants: entries, supply: 0, fuel };
  }
  const types = [...profile.plantOptions];
  types.sort((a, b) => PLANT_ATTRIBUTES[b].baseOutput - PLANT_ATTRIBUTES[a].baseOutput);
  let remaining = demand;
  while (remaining > 0) {
    const type = rng.pick(types);
    const attrs = PLANT_ATTRIBUTES[type];
    entries.push({ canton, type, status: 'active' });
    if (attrs.fuelType) {
      fuel[attrs.fuelType] = (fuel[attrs.fuelType] ?? 0) + attrs.baseOutput;
    }
    remaining -= attrs.baseOutput;
    if (entries.length > 12) break;
  }
  let supply = entries.reduce((sum, plant) => sum + PLANT_ATTRIBUTES[plant.type].baseOutput, 0);
  if (supply < demand * 0.95) {
    const type = types[0];
    const attrs = PLANT_ATTRIBUTES[type];
    entries.push({ canton, type, status: 'active' });
    if (attrs.fuelType) {
      fuel[attrs.fuelType] = (fuel[attrs.fuelType] ?? 0) + attrs.baseOutput;
    }
    supply += attrs.baseOutput;
  }
  return { plants: entries, supply, fuel };
}

function computeStableRevenue(
  mix: Record<string, number>,
  multiplier: number,
  rng: SeededRandom,
): number {
  let base = 0;
  for (const [sector, funded] of Object.entries(mix)) {
    if (sector === 'logistics') continue;
    const weight = REVENUE_WEIGHTS[sector as SectorType] ?? 1.8;
    base += funded * weight;
  }
  const variation = 0.9 + rng.nextRange(0, 0.2);
  return Math.round(base * multiplier * variation);
}

function computeLaborMix(
  mix: Record<string, number>,
): { demand: Record<string, number>; total: number } {
  const demand: Record<string, number> = { general: 0, skilled: 0, specialist: 0 };
  for (const [sector, funded] of Object.entries(mix)) {
    const type = SECTOR_LABOR_TYPES[sector as SectorType];
    if (!type) continue;
    demand[type] += funded;
  }
  const total = demand.general + demand.skilled + demand.specialist;
  return { demand, total };
}

function computeWelfareCost(
  tiers: { education: number; healthcare: number; socialSupport: number },
  labor: number,
): number {
  const edu = EDUCATION_TIERS[tiers.education].cost * labor;
  const health = HEALTHCARE_TIERS[tiers.healthcare].cost * labor;
  const social = SOCIAL_SUPPORT_COST[tiers.socialSupport] * labor;
  return edu + health + social;
}

function resolveWelfare(
  desired: { education: number; healthcare: number; socialSupport: number },
  labor: number,
  available: number,
): { tiers: { education: number; healthcare: number; socialSupport: number }; cost: number; downshifted: boolean } {
  const tiers = { ...desired };
  let cost = computeWelfareCost(tiers, labor);
  let downshifted = false;
  const order: (keyof typeof tiers)[] = ['socialSupport', 'healthcare', 'education'];
  while (cost > available && (tiers.education > 0 || tiers.healthcare > 0 || tiers.socialSupport > 0)) {
    let adjusted = false;
    for (const key of order) {
      if (tiers[key] > 0) {
        tiers[key] -= 1;
        adjusted = true;
        break;
      }
    }
    if (!adjusted) break;
    cost = computeWelfareCost(tiers, labor);
    downshifted = true;
  }
  if (cost > available) {
    return { tiers: { education: 0, healthcare: 0, socialSupport: 0 }, cost: 0, downshifted: true };
  }
  return { tiers, cost, downshifted };
}
function ensureCanton(
  game: Game,
  playerId: PlayerId,
  biomes: Uint8Array,
  neighbors: Int32Array,
  offsets: Uint32Array,
): CantonInfo | null {
  const cells = game.state.playerCells[playerId] ?? [];
  if (cells.length === 0) {
    return null;
  }
  const capital = cells[0];
  const cantonId = String(capital);
  if (!game.state.economy.cantons[cantonId]) {
    EconomyManager.addCanton(game.state.economy, cantonId);
  }
  return {
    cantonId,
    capital,
    coastal: computeCoastal(capital, biomes, neighbors, offsets),
  };
}

function cloneSectorStates(
  sectors: Partial<Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>>,
): Partial<Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }>> {
  const clone: typeof sectors = {};
  for (const [key, value] of Object.entries(sectors)) {
    clone[key as SectorType] = value ? { ...value } : undefined;
  }
  return clone;
}

export class InMediaResInitializer {
  static initialize(
    game: Game,
    inputs: NationCreationInput[],
    biomes: Uint8Array,
    neighbors: Int32Array,
    offsets: Uint32Array,
    seed?: string | number,
  ): NationMeta[] {
    const players = Object.keys(game.state.playerCells);
    if (inputs.length !== players.length) {
      throw new Error('Nation configuration does not match player count');
    }

    const rng = new SeededRandom(seed ?? game.meta.seed ?? null);
    const economy = game.state.economy;

    // Reset aggregate economy pools before seeding nations.
    economy.resources = {
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
    };
    economy.energy.plants = [];
    economy.energy.state = { supply: 0, demand: 0, ratio: 1 };
    economy.energy.demandBySector = {};
    economy.energy.brownouts = [];
    economy.energy.fuelUsed = {};
    economy.energy.oAndMSpent = 0;
    economy.projects.projects = [];
    economy.projects.nextId = 1;
    economy.finance.debt = 0;
    economy.finance.creditLimit = 0;
    economy.finance.defaulted = false;
    economy.finance.debtStress = [];
    economy.finance.summary = {
      revenues: 0,
      expenditures: 0,
      netBorrowing: 0,
      interest: 0,
      defaulted: false,
    };

    const aggregate = {
      gold: 0,
      food: 0,
      materials: 0,
      fx: 0,
      luxury: 0,
      ordnance: 0,
      production: 0,
      uranium: 0,
      coal: 0,
      oil: 0,
      energySupply: 0,
      energyDemand: 0,
      logisticsSupply: 0,
      logisticsDemand: 0,
      revenues: 0,
      expenditures: 0,
      interest: 0,
      debt: 0,
      creditLimit: 0,
      plants: [] as PlantRegistryEntry[],
      fuelUsed: {} as Partial<Record<ResourceType, number>>,
      oAndM: 0,
      demandBySector: {} as Partial<Record<SectorType, number>>,
      projectId: 1,
    };

    const nationStates: Record<PlayerId, NationState> = {};
    const metas: NationMeta[] = [];

    players.forEach((playerId, index) => {
      const input = inputs[index];
      const profile = PROFILES[input.preset];
      if (!profile) {
        throw new Error(`Unknown preset for nation ${input.name}`);
      }
      const cantonInfo = ensureCanton(game, playerId, biomes, neighbors, offsets);
      if (!cantonInfo) {
        return;
      }
      const { cantonId, coastal } = cantonInfo;
      const canton = economy.cantons[cantonId];

      // Generate a working mix of funded slots per sector with slight variation.
      const mix: Record<string, number> = {};
      for (const [sector, value] of Object.entries(profile.baseMix)) {
        const variation = 0.9 + rng.nextRange(0, 0.2);
        mix[sector] = Math.max(1, Math.round(value * variation));
      }
      mix.logistics = Math.max(mix.logistics ?? MIN_LOGISTICS_SLOTS, MIN_LOGISTICS_SLOTS);
      const logistics = scaleMixToLogistics(mix, mix.logistics);
      mix.logistics = logistics.slots;

      const energyDemand = computeEnergyDemand(mix);
      const plantPlan = choosePlants(profile, cantonId, energyDemand, rng);
      const rawEnergyRatio = energyDemand > 0 ? plantPlan.supply / energyDemand : 1;
      const energyRatio = Math.min(Math.max(rawEnergyRatio, 0.95), 1.05);
      const effectiveEnergySupply = energyDemand * energyRatio;

      const stableRevenue = Math.max(20, computeStableRevenue(mix, profile.stableRevenueMultiplier, rng));
      const labor = computeLaborMix(mix);
      const laborBuffer = {
        general: labor.demand.general + Math.max(1, Math.round(labor.demand.general * 0.1)),
        skilled: labor.demand.skilled + Math.max(1, Math.round(labor.demand.skilled * 0.1)),
        specialist: labor.demand.specialist + Math.max(1, Math.round(labor.demand.specialist * 0.15)),
      };
      const lai = 1 + rng.nextRange(0, 0.05);

      const foodTurns = rng.nextRange(profile.stockpiles.food[0], profile.stockpiles.food[1]);
      const foodStock = Math.max(labor.total, Math.round(foodTurns * labor.total));
      const fuelPerTurn = Object.values(plantPlan.fuel).reduce((sum, value) => sum + (value ?? 0), 0);
      const fuelTurns = profile.stockpiles.fuel[0] + rng.nextRange(0, profile.stockpiles.fuel[1] - profile.stockpiles.fuel[0]);
      const fuelStock = Math.round(fuelPerTurn * fuelTurns);
      const materialsPerTurn = Math.max(
        2,
        Math.round(
          (mix.manufacturing ?? 0) * 1.3 +
            (mix.defense ?? 0) * 1.2 +
            (mix.extraction ?? 0) * 0.6 +
            (mix.logistics ?? 0) * 0.3,
        ),
      );
      const materialTurns = rng.nextRange(profile.stockpiles.materials[0], profile.stockpiles.materials[1]);
      const materialsStock = Math.round(materialsPerTurn * materialTurns);
      const fxReserves = Math.round(stableRevenue * rng.nextRange(profile.stockpiles.fx[0], profile.stockpiles.fx[1]));
      const luxuryStock = Math.max(
        labor.total,
        Math.round(labor.total * rng.nextRange(profile.stockpiles.luxury[0], profile.stockpiles.luxury[1])),
      );
      const ordnanceStock = Math.max(
        1,
        Math.round((mix.defense ?? 0) * rng.nextRange(profile.stockpiles.ordnance[0], profile.stockpiles.ordnance[1])),
      );
      const productionStock = Math.max(
        1,
        Math.round((mix.manufacturing ?? 0) * rng.nextRange(profile.stockpiles.production[0], profile.stockpiles.production[1])),
      );

      const interestRate = economy.finance.interestRate ?? 0.05;
      const debtSample = Math.round(stableRevenue * rng.nextRange(0.4, 0.7));
      const startInDebt = rng.nextBoolean();
      const debt = startInDebt ? debtSample : 0;
      const interest = Math.round(debt * interestRate * 100) / 100;
      const creditLimit = Math.max(debtSample + 20, Math.round(stableRevenue * profile.creditLimitMultiplier));

      const sectorStates: Record<SectorType, { capacity: number; funded: number; idle: number; utilization?: number }> = {} as any;
      let omCost = 0;
      let idleCost = 0;
      for (const [sectorKey, funded] of Object.entries(mix)) {
        const sector = sectorKey as SectorType;
        const idle = funded > 0 ? (rng.nextBoolean() ? 1 : 0) : 0;
        const capacity = funded + idle;
        const state = {
          capacity,
          funded,
          idle,
          utilization: funded,
        };
        sectorStates[sector] = state;
        const costPer = OM_COST_PER_SLOT[sector] ?? 1;
        omCost += funded * costPer;
        idleCost += idle * costPer * IDLE_TAX_RATE;
        if (ENERGY_PER_SLOT[sector] ?? 0) {
          aggregate.demandBySector[sector] =
            (aggregate.demandBySector[sector] ?? 0) + funded * (ENERGY_PER_SLOT[sector] ?? 0);
        }
      }
      const energyOM = plantPlan.plants.reduce(
        (sum, plant) => sum + (PLANT_ATTRIBUTES[plant.type].oAndMCost ?? 0),
        0,
      );
      omCost += energyOM;
      aggregate.oAndM += energyOM;

      const desiredWelfare = { ...profile.welfare };
      const availableForWelfare = Math.max(0, stableRevenue * 0.6);
      const welfarePlan = resolveWelfare(desiredWelfare, labor.total, availableForWelfare);
      const projectSector = rng.pick(profile.projectSectors);
      const projectTier = rng.pick(['small', 'medium', 'large'] as const);
      const tierWeight = projectTier === 'large' ? 3 : projectTier === 'medium' ? 2 : 1;
      const projectGoldCost = 12 * tierWeight;
      const projectProductionCost = 6 * tierWeight;
      let projectTurns = rng.nextInt(3) + 2;
      const projectSpendPerTurn = Math.max(2, Math.round(projectGoldCost / projectTurns));

      const militaryUpkeep = Math.max(
        3,
        Math.round(((mix.defense ?? 0) * 2.5 + (mix.manufacturing ?? 0) * 0.5 + 4) * profile.militaryFocus),
      );
      const discretionaryMilitary = Math.max(0, Math.round(militaryUpkeep * 0.15));
      const militarySpend = militaryUpkeep + discretionaryMilitary;

      const buffer = Math.max(8, Math.round(stableRevenue * 0.25));
      const totalOps = omCost + idleCost;
      const totalObligations = interest + totalOps + welfarePlan.cost + militarySpend + projectSpendPerTurn;
      let treasury = startInDebt ? 0 : buffer;
      const initialTreasury = totalObligations + treasury;

      const energyShort = energyRatio < 0.98;
      const logisticsRatio = logistics.demand > 0 ? logistics.supply / logistics.demand : 1;
      const logisticsShort = logisticsRatio < 0.98;
      const debtStress = creditLimit > 0 ? debt / creditLimit > 0.85 : false;
      const projectDelayed = energyShort || logisticsShort || debtStress;
      if (projectDelayed) {
        projectTurns += 1;
      }

      const plantsEffective = plantPlan.plants.map((plant) => ({ ...plant }));
      aggregate.plants.push(...plantsEffective);
      for (const [resource, amount] of Object.entries(plantPlan.fuel)) {
        aggregate.fuelUsed[resource as ResourceType] =
          (aggregate.fuelUsed[resource as ResourceType] ?? 0) + amount!;
      }

      // Update canton economic details.
      canton.sectors = sectorStates;
      canton.labor = { ...laborBuffer };
      canton.laborDemand = {};
      canton.laborAssigned = {};
      for (const [sectorKey, funded] of Object.entries(mix)) {
        const sector = sectorKey as SectorType;
        const type = SECTOR_LABOR_TYPES[sector];
        if (!type) continue;
        const demand: any = { general: 0, skilled: 0, specialist: 0 };
        demand[type] = funded;
        canton.laborDemand[sector] = demand;
        const assigned: any = { general: 0, skilled: 0, specialist: 0 };
        assigned[type] = funded;
        canton.laborAssigned[sector] = assigned;
      }
      canton.lai = lai;
      canton.happiness = rng.nextRange(0.3, 0.8) + (luxuryStock >= labor.total ? 0.4 : 0);
      canton.consumption = {
        foodRequired: labor.total,
        foodProvided: Math.min(foodStock, labor.total),
        luxuryRequired: labor.total,
        luxuryProvided: Math.min(luxuryStock, labor.total),
      };
      canton.shortages = { food: false, luxury: false };
      canton.urbanizationLevel = 4 + rng.nextInt(3);
      canton.nextUrbanizationLevel = canton.urbanizationLevel;
      canton.development = rng.nextRange(1, 2);
      canton.geography = coastal
        ? { plains: 0.5, coast: 0.3, hills: 0.2 }
        : { plains: 0.6, hills: 0.25, woods: 0.15 };
      canton.suitability = {};
      canton.suitabilityMultipliers = {};
      for (const sector of Object.keys(mix)) {
        canton.suitability[sector as SectorType] = Math.round((0.75 + rng.nextRange(0, 0.2)) * 100);
        canton.suitabilityMultipliers[sector as SectorType] = 1 + rng.nextRange(-0.05, 0.05);
      }

      // Prepare project entry.
      const project = {
        id: aggregate.projectId++,
        canton: cantonId,
        sector: projectSector,
        tier: projectTier,
        slots: tierWeight,
        status: 'building' as const,
        owner: playerId,
        turns_remaining: projectTurns,
        cost: { gold: projectGoldCost, production: projectProductionCost },
      };
      economy.projects.projects.push(project);
      economy.projects.nextId = aggregate.projectId;

      const nationState: NationState = {
        id: playerId,
        name: input.name,
        preset: input.preset,
        canton: cantonId,
        coastal,
        signature: `${profile.nonUniformityTag}-${mix.finance ?? 0}-${mix.research ?? 0}-${mix.defense ?? 0}`,
        energy: {
          supply: Math.round(effectiveEnergySupply * 100) / 100,
          demand: energyDemand,
          ratio: Math.round(energyRatio * 1000) / 1000,
          plants: plantsEffective,
          throttledSectors: {},
        },
        logistics: {
          supply: Math.round(Math.min(logistics.supply, logistics.demand * 1.05) * 100) / 100,
          demand: Math.round(logistics.demand * 100) / 100,
          ratio:
            logistics.demand > 0
              ? Math.round(Math.min(Math.max(logistics.supply / logistics.demand, 0.95), 1.05) * 1000) / 1000
              : 1,
          slots: mix.logistics,
          throttledSectors: {},
        },
        welfare: {
          education: welfarePlan.tiers.education,
          healthcare: welfarePlan.tiers.healthcare,
          socialSupport: welfarePlan.tiers.socialSupport,
          cost: Math.round(welfarePlan.cost * 100) / 100,
          autoDownshifted: welfarePlan.downshifted,
        },
        finance: {
          treasury,
          stableRevenue,
          creditLimit,
          debt,
          interest,
          waterfall: {
            initial: initialTreasury,
            interest,
            operations: Math.round(totalOps * 100) / 100,
            welfare: Math.round(welfarePlan.cost * 100) / 100,
            military: militarySpend,
            projects: projectSpendPerTurn,
            surplus: treasury,
          },
        },
        labor: {
          available: laborBuffer,
          assigned: labor.demand,
          lai,
          happiness: canton.happiness,
          consumption: { ...canton.consumption },
        },
        stockpiles: {
          food: foodStock,
          fuel: fuelStock,
          materials: materialsStock,
          fx: fxReserves,
          luxury: luxuryStock,
          ordnance: ordnanceStock,
          production: productionStock,
        },
        military: {
          upkeep: militaryUpkeep,
          funded: militarySpend,
          discretionary: discretionaryMilitary,
        },
        sectors: cloneSectorStates(sectorStates),
        projects: [
          {
            id: project.id,
            sector: project.sector,
            tier: project.tier,
            turnsRemaining: project.turns_remaining,
            delayed: projectDelayed,
          },
        ],
        idleCost: Math.round(idleCost * 100) / 100,
        omCost: Math.round(totalOps * 100) / 100,
        status: createEmptyStatusSummary(),
      };

      updateNationStatus(nationState);

      nationStates[playerId] = nationState;
      metas.push({ id: playerId, name: input.name, preset: input.preset });

      // Aggregate resources across all nations.
      aggregate.gold += treasury;
      aggregate.food += foodStock;
      aggregate.materials += materialsStock;
      aggregate.fx += fxReserves;
      aggregate.luxury += luxuryStock;
      aggregate.ordnance += ordnanceStock;
      aggregate.production += productionStock;
      aggregate.energySupply += effectiveEnergySupply;
      aggregate.energyDemand += energyDemand;
      aggregate.logisticsSupply += Math.min(logistics.supply, logistics.demand * 1.05);
      aggregate.logisticsDemand += logistics.demand;
      aggregate.revenues += stableRevenue;
      aggregate.expenditures += totalObligations;
      aggregate.interest += interest;
      aggregate.debt += debt;
      aggregate.creditLimit += creditLimit;

      if (plantPlan.fuel.coal) aggregate.coal += Math.round(fuelStock * (plantPlan.fuel.coal / (fuelPerTurn || 1)));
      if (plantPlan.fuel.oil) aggregate.oil += Math.round(fuelStock * (plantPlan.fuel.oil / (fuelPerTurn || 1)));
      if (plantPlan.fuel.uranium)
        aggregate.uranium += Math.round(fuelStock * (plantPlan.fuel.uranium / (fuelPerTurn || 1)));
    });

    economy.resources.gold = aggregate.gold;
    economy.resources.food = aggregate.food;
    economy.resources.materials = aggregate.materials;
    economy.resources.fx = aggregate.fx;
    economy.resources.luxury = aggregate.luxury;
    economy.resources.ordnance = aggregate.ordnance;
    economy.resources.production = aggregate.production;
    economy.resources.coal = aggregate.coal;
    economy.resources.oil = aggregate.oil;
    economy.resources.uranium = aggregate.uranium;
    economy.resources.energy = 0;
    economy.resources.research = 0;
    economy.resources.logistics = 0;
    economy.resources.labor = 0;

    economy.energy.plants = aggregate.plants;
    const overallRatio = aggregate.energyDemand > 0 ? aggregate.energySupply / aggregate.energyDemand : 1;
    economy.energy.state = {
      supply: Math.round(aggregate.energySupply * 100) / 100,
      demand: Math.round(aggregate.energyDemand * 100) / 100,
      ratio: Math.round(Math.min(Math.max(overallRatio, 0.95), 1.05) * 1000) / 1000,
    };
    economy.energy.demandBySector = aggregate.demandBySector;
    economy.energy.fuelUsed = aggregate.fuelUsed;
    economy.energy.oAndMSpent = Math.round(aggregate.oAndM * 100) / 100;
    economy.energy.brownouts = [];

    economy.finance.debt = aggregate.debt;
    economy.finance.creditLimit = aggregate.creditLimit;
    economy.finance.debtStress = DEBT_STRESS_TIERS.map((tier) => aggregate.debt >= tier);
    economy.finance.summary = {
      revenues: Math.round(aggregate.revenues * 100) / 100,
      expenditures: Math.round(aggregate.expenditures * 100) / 100,
      netBorrowing: 0,
      interest: Math.round(aggregate.interest * 100) / 100,
      defaulted: false,
    };

    const firstNation = nationStates[players[0]];
    if (firstNation) {
      economy.welfare.current = {
        education: firstNation.welfare.education,
        healthcare: firstNation.welfare.healthcare,
        socialSupport: firstNation.welfare.socialSupport,
      };
      economy.welfare.next = { ...economy.welfare.current };
    }

    game.state.nations = nationStates;
    return metas;
  }
}

export const __test = {
  resolveWelfare,
};
