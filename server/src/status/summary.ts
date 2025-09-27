import { SECTOR_BASE_OUTPUT, SLOT_REQUIREMENTS } from '../economy';
import type {
  LaborPool,
  NationState,
  NationStatusSummary,
  ResourceDeltaSnapshot,
  ResourceType,
  SectorType,
} from '../types';

const STOCK_KEYS = ['fx', 'food', 'ordnance', 'production', 'luxury', 'materials'] as const;
type StockKey = (typeof STOCK_KEYS)[number];

const HAPPY_THRESHOLD = 0.75;
const CONTENT_THRESHOLD = 0.4;

function cloneLabor(pool: LaborPool): LaborPool {
  return {
    general: pool?.general ?? 0,
    skilled: pool?.skilled ?? 0,
    specialist: pool?.specialist ?? 0,
  };
}

export function createEmptyStatusSummary(): NationStatusSummary {
  const zero: ResourceDeltaSnapshot = { current: 0, delta: 0 };
  return {
    gold: { value: 0, isDebt: false },
    stockpiles: {
      fx: { ...zero },
      food: { ...zero },
      ordnance: { ...zero },
      production: { ...zero },
      luxury: { ...zero },
      materials: { ...zero },
    },
    flows: { energy: 0, logistics: 0, research: 0 },
    labor: { general: 0, skilled: 0, specialist: 0 },
    happiness: { value: 0, emoji: '😐' },
  };
}

function sectorUtilization(nation: NationState, sector: SectorType): number {
  const state = nation.sectors?.[sector];
  if (!state) return 0;
  if (typeof state.utilization === 'number') return state.utilization;
  if (typeof state.funded === 'number') return state.funded;
  return 0;
}

function happinessEmoji(value: number): string {
  if (value >= HAPPY_THRESHOLD) return '🙂';
  if (value >= CONTENT_THRESHOLD) return '😐';
  return '☹️';
}

export function computeNationStatusSummary(nation: NationState): NationStatusSummary {
  const produced: Partial<Record<ResourceType, number>> = {};
  const consumed: Partial<Record<ResourceType, number>> = {};

  (Object.keys(nation.sectors || {}) as SectorType[]).forEach((sector) => {
    const active = sectorUtilization(nation, sector);
    if (active <= 0) return;

    const outputs = SECTOR_BASE_OUTPUT[sector];
    if (outputs) {
      for (const [resource, amount] of Object.entries(outputs)) {
        produced[resource as ResourceType] =
          (produced[resource as ResourceType] ?? 0) + active * (amount ?? 0);
      }
    }

    const requirements = SLOT_REQUIREMENTS[sector];
    if (requirements?.inputs) {
      for (const [resource, amount] of Object.entries(requirements.inputs)) {
        consumed[resource as ResourceType] =
          (consumed[resource as ResourceType] ?? 0) + active * (amount ?? 0);
      }
    }
  });

  const laborConsumption = nation.labor?.consumption;
  if (laborConsumption) {
    consumed.food = (consumed.food ?? 0) + (laborConsumption.foodProvided ?? laborConsumption.foodRequired ?? 0);
    consumed.luxury =
      (consumed.luxury ?? 0) + (laborConsumption.luxuryProvided ?? laborConsumption.luxuryRequired ?? 0);
  }

  const stockpiles: NationStatusSummary['stockpiles'] = {
    fx: { current: nation.stockpiles?.fx ?? 0, delta: 0 },
    food: { current: nation.stockpiles?.food ?? 0, delta: 0 },
    ordnance: { current: nation.stockpiles?.ordnance ?? 0, delta: 0 },
    production: { current: nation.stockpiles?.production ?? 0, delta: 0 },
    luxury: { current: nation.stockpiles?.luxury ?? 0, delta: 0 },
    materials: { current: nation.stockpiles?.materials ?? 0, delta: 0 },
  };

  STOCK_KEYS.forEach((key) => {
    const output = produced[key as ResourceType] ?? 0;
    const input = consumed[key as ResourceType] ?? 0;
    const delta = Math.round((output - input) * 100) / 100;
    stockpiles[key].delta = delta;
  });

  const debt = nation.finance?.debt ?? 0;
  const treasury = nation.finance?.treasury ?? 0;
  const goldValue = debt > 0 ? -Math.abs(debt) : treasury;

  const happinessRaw = nation.labor?.happiness ?? 0;
  const happinessValue = Math.round(happinessRaw * 100);

  return {
    gold: { value: Math.round(goldValue * 100) / 100, isDebt: debt > 0 },
    stockpiles,
    flows: {
      energy: Math.round((nation.energy?.supply ?? 0) * 100) / 100,
      logistics: Math.round((nation.logistics?.supply ?? 0) * 100) / 100,
      research: Math.round((produced.research ?? 0) * 100) / 100,
    },
    labor: cloneLabor(nation.labor?.available ?? { general: 0, skilled: 0, specialist: 0 }),
    happiness: { value: happinessValue, emoji: happinessEmoji(happinessRaw) },
  };
}

export function updateNationStatus(nation: NationState): NationStatusSummary {
  const status = computeNationStatusSummary(nation);
  nation.status = status;
  return status;
}
