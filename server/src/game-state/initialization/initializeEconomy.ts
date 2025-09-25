import { BudgetManager, OM_COST_PER_SLOT } from '../../budget/manager';
import { SECTOR_SLOTS_BY_UL } from '../../development/manager';
import {
  EnergyManager,
  PLANT_ATTRIBUTES,
  ENERGY_PER_SLOT,
  RENEWABLE_CAPACITY_FACTOR,
} from '../../energy/manager';
import { FinanceManager } from '../../finance/manager';
import { InfrastructureManager } from '../../infrastructure/manager';
import { LogisticsManager } from '../../logistics/manager';
import { SuitabilityManager } from '../../suitability/manager';
import { LaborManager } from '../../labor/manager';
import { WelfareManager } from '../../welfare/manager';
import { SECTOR_DEFINITIONS } from '../../economy/manager';
import {
  type EconomyState,
  type GameState,
  type SectorType,
  type PlantType,
  type WelfarePolicies,
} from '../../types';
import { INITIALIZATION_CONFIG, type RangeConfig, type WeightedLevel } from './config';

export interface InitializationOptions {
  seed?: number;
}

interface SectorFractions {
  active: number;
  idle: number;
}

interface CantonPlan {
  active: Partial<Record<SectorType, number>>;
  capacity: Partial<Record<SectorType, number>>;
}

interface FinancePlan {
  revenues: number;
  expenditures: number;
}

function createSeededRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  const modulus = INITIALIZATION_CONFIG.rng.modulus;
  const multiplier = INITIALIZATION_CONFIG.rng.multiplier;
  let state = seed % modulus;
  if (state <= 0) state += modulus - 1;
  return () => {
    state = (state * multiplier) % modulus;
    return (state - 1) / (modulus - 1);
  };
}

function pickWeightedLevel(weights: WeightedLevel[], rng: () => number): number {
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const roll = rng() * total;
  let accum = 0;
  for (const item of weights) {
    accum += item.weight;
    if (roll <= accum) return item.level;
  }
  return weights[weights.length - 1]?.level ?? 1;
}

function sampleRange(range: RangeConfig, rng: () => number): number {
  return range.min + rng() * (range.max - range.min);
}

function assignGeography(economy: EconomyState, cantonId: string, coastal: boolean): void {
  const mix = coastal
    ? INITIALIZATION_CONFIG.geography.coastal
    : INITIALIZATION_CONFIG.geography.inland;
  economy.cantons[cantonId].geography = { ...mix };
}

function computeFractions(rng: () => number): Record<SectorType, SectorFractions> {
  const fractions: Partial<Record<SectorType, SectorFractions>> = {};
  for (const sector of Object.keys(INITIALIZATION_CONFIG.sectorAllocation.shares) as SectorType[]) {
    const active = sampleRange(INITIALIZATION_CONFIG.sectorAllocation.activeFraction, rng);
    let idle = sampleRange(INITIALIZATION_CONFIG.sectorAllocation.idleFraction, rng);
    const maxIdle = 1 - INITIALIZATION_CONFIG.sectorAllocation.lockedMinFraction - active;
    if (idle > maxIdle) idle = Math.max(0, maxIdle);
    fractions[sector] = { active, idle };
  }
  return fractions as Record<SectorType, SectorFractions>;
}

function planCantonSectors(
  economy: EconomyState,
  cantonId: string,
  level: number,
  fractions: Record<SectorType, SectorFractions>,
): CantonPlan {
  const totalSlots = SECTOR_SLOTS_BY_UL[level];
  const plan: CantonPlan = { active: {}, capacity: {} };
  const minIdle = INITIALIZATION_CONFIG.sectorAllocation.minIdleSlots;

  for (const [sector, share] of Object.entries(
    INITIALIZATION_CONFIG.sectorAllocation.shares,
  ) as [SectorType, number][]) {
    const desired = Math.max(
      INITIALIZATION_CONFIG.sectorAllocation.minActiveSlots[sector] ?? 0,
      Math.round(totalSlots * share),
    );
    const minLocked = Math.round(desired * INITIALIZATION_CONFIG.sectorAllocation.lockedMinFraction);
    const maxCapacity = Math.max(0, desired - minLocked);
    if (maxCapacity <= 0) continue;

    const { active: activeFraction, idle: idleFraction } = fractions[sector];
    let active = Math.round(desired * activeFraction);
    const minActive = INITIALIZATION_CONFIG.sectorAllocation.minActiveSlots[sector] ?? 0;
    if (active < minActive) active = minActive;
    if (active > maxCapacity) active = maxCapacity;

    let idle = Math.round(desired * idleFraction);
    const availableForIdle = Math.max(0, maxCapacity - active);
    if (availableForIdle === 0) idle = 0;
    else {
      if (idle < minIdle && availableForIdle >= minIdle) idle = minIdle;
      if (idle > availableForIdle) idle = availableForIdle;
    }

    let capacity = active + idle;
    if (capacity > maxCapacity) {
      const reduce = capacity - maxCapacity;
      idle = Math.max(0, idle - reduce);
      capacity = active + idle;
    }

    plan.active[sector] = active;
    plan.capacity[sector] = capacity;

    economy.cantons[cantonId].sectors[sector] = {
      capacity,
      funded: 0,
      idle: 0,
    } as any;
  }

  return plan;
}

function assignDevelopment(economy: EconomyState, cantonId: string, level: number, rng: () => number): void {
  economy.cantons[cantonId].urbanizationLevel = level;
  economy.cantons[cantonId].nextUrbanizationLevel = level;
  const progressPercent = sampleRange(INITIALIZATION_CONFIG.development.progress, rng);
  economy.cantons[cantonId].development =
    progressPercent * INITIALIZATION_CONFIG.development.meterPerLevel;
}

function setupWelfare(economy: EconomyState, rng: () => number): void {
  const welfare = economy.welfare;
  const policies: WelfarePolicies = {
    education: Math.round(sampleRange(INITIALIZATION_CONFIG.welfare.educationTier, rng)),
    healthcare: Math.round(sampleRange(INITIALIZATION_CONFIG.welfare.healthcareTier, rng)),
    socialSupport: INITIALIZATION_CONFIG.welfare.socialSupportTier,
  } as WelfarePolicies;
  welfare.current = { ...policies };
  welfare.next = { ...policies };
}

function stockpileBasics(economy: EconomyState): void {
  const totalLabor = Object.values(economy.cantons).reduce((sum, canton) => {
    const pool = canton.labor;
    return sum + pool.general + pool.skilled + pool.specialist;
  }, 0);
  economy.resources.food =
    totalLabor * INITIALIZATION_CONFIG.welfare.stocksPerLabor.food;
  economy.resources.luxury =
    totalLabor * INITIALIZATION_CONFIG.welfare.stocksPerLabor.luxury;
}

function addFuelStock(economy: EconomyState, plant: PlantType, count: number): void {
  const attrs = PLANT_ATTRIBUTES[plant];
  if (!attrs.fuelType) return;
  const turns = INITIALIZATION_CONFIG.energy.fuelStockTurns;
  const amount = attrs.baseOutput * turns * count;
  economy.resources[attrs.fuelType] += amount;
}

function ensureEnergyPlants(economy: EconomyState, demand: number): void {
  economy.energy.plants = [];
  let supply = 0;
  const target = demand * INITIALIZATION_CONFIG.energy.reserveRatio;
  const sequence = INITIALIZATION_CONFIG.energy.plantSequence;
  let idx = 0;
  while (supply < target && sequence.length > 0) {
    const plantType = sequence[idx % sequence.length];
    const attrs = PLANT_ATTRIBUTES[plantType];
    economy.energy.plants.push({
      canton: 'national',
      type: plantType,
      status: 'active',
    });
    supply += attrs.baseOutput * (attrs.rcf ? RENEWABLE_CAPACITY_FACTOR : 1);
    addFuelStock(economy, plantType, 1);
    idx += 1;
  }
}

function computeEnergyDemand(economy: EconomyState): number {
  let demand = 0;
  for (const canton of Object.values(economy.cantons)) {
    for (const [sector, state] of Object.entries(canton.sectors) as [SectorType, any][]) {
      if (!state) continue;
      const requirement = INITIALIZATION_CONFIG.sectorAllocation.shares[sector] !== undefined
        ? ENERGY_PER_SLOT[sector]
        : 0;
      if (!requirement) continue;
      demand += (state.funded ?? 0) * requirement;
    }
  }
  return demand;
}

function aggregateActiveTargets(plans: Record<string, CantonPlan>): Record<SectorType, number> {
  const totals: Partial<Record<SectorType, number>> = {};
  for (const plan of Object.values(plans)) {
    for (const [sector, value] of Object.entries(plan.active) as [SectorType, number][]) {
      totals[sector] = (totals[sector] ?? 0) + value;
    }
  }
  return totals as Record<SectorType, number>;
}

function assignSuitability(economy: EconomyState): void {
  SuitabilityManager.run(economy);
}

function resolveOutputs(economy: EconomyState): void {
  for (const canton of Object.values(economy.cantons)) {
    for (const [sector, state] of Object.entries(canton.sectors) as [SectorType, any][]) {
      if (!state || (state.funded ?? 0) <= 0) continue;
      state.utilization = state.funded;
      const def = SECTOR_DEFINITIONS[sector];
      if (!def) continue;
      const mult = canton.suitabilityMultipliers[sector] ?? 1;
      for (const resource of def.outputs) {
        economy.resources[resource] += state.utilization * mult;
      }
    }
  }
}

function planFinance(economy: EconomyState, rng: () => number): FinancePlan {
  let assignedLabor = 0;
  for (const canton of Object.values(economy.cantons)) {
    for (const assigned of Object.values(canton.laborAssigned)) {
      assignedLabor +=
        assigned.general + assigned.skilled + assigned.specialist;
    }
  }
  const base = INITIALIZATION_CONFIG.finance.baseRevenuePerLabor;
  const variance = INITIALIZATION_CONFIG.finance.revenueVariance;
  const revenues = assignedLabor * (base + (rng() * 2 - 1) * variance);
  return { revenues, expenditures: 0 };
}

function applyFinance(economy: EconomyState, plan: FinancePlan): void {
  economy.finance.creditLimit = INITIALIZATION_CONFIG.finance.creditLimit;
  economy.finance.interestRate = INITIALIZATION_CONFIG.finance.interestRate;
  FinanceManager.run(economy, plan);
}

export function initializeEconomy(gameState: GameState, options: InitializationOptions = {}): void {
  const rng = createSeededRng(options.seed);
  const economy = gameState.economy;
  const plans: Record<string, CantonPlan> = {};
  const fractions = computeFractions(rng);

  setupWelfare(economy, rng);

  for (const cantonId of Object.keys(economy.cantons)) {
    const isCoastal = !!economy.infrastructure.ports[cantonId];
    const level = pickWeightedLevel(INITIALIZATION_CONFIG.urbanization.weights, rng);
    assignDevelopment(economy, cantonId, level, rng);
    assignGeography(economy, cantonId, isCoastal);
    plans[cantonId] = planCantonSectors(economy, cantonId, level, fractions);
  }

  LaborManager.generate(economy);
  stockpileBasics(economy);
  economy.resources.materials =
    Object.keys(economy.cantons).length * INITIALIZATION_CONFIG.resources.baseMaterialsPerCanton;
  economy.resources.production =
    Object.keys(economy.cantons).length * INITIALIZATION_CONFIG.resources.baseProductionPerCanton;
  economy.resources.fx = INITIALIZATION_CONFIG.resources.fxReserves;
  economy.resources.gold = INITIALIZATION_CONFIG.finance.startingTreasury;

  InfrastructureManager.progressTurn(economy);

  const totals = aggregateActiveTargets(plans);
  BudgetManager.applyBudgets(economy, {
    military: INITIALIZATION_CONFIG.finance.militaryBudget,
    welfare: INITIALIZATION_CONFIG.finance.welfareDiscretionary,
    sectorOM: Object.fromEntries(
      Object.entries(totals).map(([sector, slots]) => {
        const cost = OM_COST_PER_SLOT[sector as SectorType] ?? 0;
        return [sector, slots * cost];
      }),
    ) as Partial<Record<SectorType, number>>,
  });

  WelfareManager.applyPolicies(economy);

  const energyDemand = computeEnergyDemand(economy);
  ensureEnergyPlants(economy, energyDemand);
  economy.energy.essentialsFirst = INITIALIZATION_CONFIG.energy.essentialsFirst;
  EnergyManager.run(economy, { essentialsFirst: economy.energy.essentialsFirst });

  LogisticsManager.run(economy, {
    networks: {},
    domesticPlans: {},
    internationalPlans: {},
    gatewayCapacities: {},
  });

  LaborManager.run(economy);
  assignSuitability(economy);
  resolveOutputs(economy);

  let financePlan = planFinance(economy, rng);
  applyFinance(economy, financePlan);

  let attempts = 0;
  while (
    economy.finance.debt > economy.finance.creditLimit &&
    attempts < INITIALIZATION_CONFIG.finance.maxAdjustIterations
  ) {
    financePlan.revenues += INITIALIZATION_CONFIG.finance.fallbackRevenueBoost;
    applyFinance(economy, financePlan);
    attempts += 1;
  }
}
