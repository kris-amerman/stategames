import { DEBUG_SIDEBAR_ENABLED } from './config';
import {
  SECTORS,
  SECTOR_TITLES,
  OM_COST_PER_SLOT,
  IDLE_TAX_RATE,
  SECTOR_OUTPUTS,
  type SectorKey,
  computeLastRoundSpendFromSnapshot,
} from './planner';

const STORAGE_KEY = 'debugSidebarOpen';
const CANTON_PAGE_SIZE = 5;
const STOCK_ORDER: Array<{ key: keyof StockpileMap; label: string }> = [
  { key: 'fx', label: 'FX' },
  { key: 'food', label: 'Food' },
  { key: 'ordnance', label: 'Ordnance' },
  { key: 'production', label: 'Production' },
  { key: 'luxury', label: 'Luxury' },
  { key: 'materials', label: 'Material' },
];

const LABOR_TYPES: Array<{ key: keyof LaborPool; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'skilled', label: 'Skilled' },
  { key: 'specialist', label: 'Specialized' },
];

const GATE_SEQUENCE: Array<'budget' | 'inputs' | 'logistics' | 'labor' | 'suitability'> = [
  'budget',
  'inputs',
  'logistics',
  'labor',
  'suitability',
];

type PlantType =
  | 'coal'
  | 'gas'
  | 'oilPeaker'
  | 'nuclear'
  | 'hydro'
  | 'wind'
  | 'solar';

type PlantAttributes = { fuelType: string | null; baseOutput: number; oAndMCost: number; rcf: boolean };

const PLANT_ATTRIBUTES: Record<PlantType, PlantAttributes> = {
  coal: { fuelType: 'coal', baseOutput: 10, oAndMCost: 1, rcf: false },
  gas: { fuelType: 'oil', baseOutput: 10, oAndMCost: 1, rcf: false },
  oilPeaker: { fuelType: 'oil', baseOutput: 5, oAndMCost: 1, rcf: false },
  nuclear: { fuelType: 'uranium', baseOutput: 20, oAndMCost: 2, rcf: false },
  hydro: { fuelType: null, baseOutput: 8, oAndMCost: 1, rcf: false },
  wind: { fuelType: null, baseOutput: 6, oAndMCost: 1, rcf: true },
  solar: { fuelType: null, baseOutput: 5, oAndMCost: 1, rcf: true },
};

const RENEWABLE_CAPACITY_FACTOR = 0.6;

interface LaborPool {
  general: number;
  skilled: number;
  specialist: number;
}

interface LaborBreakdown {
  available: Partial<Record<SectorKey, LaborPool>>;
  assigned: Partial<Record<SectorKey, LaborPool>>;
}

interface StockpileMap {
  fx: ResourceDelta;
  food: ResourceDelta;
  ordnance: ResourceDelta;
  production: ResourceDelta;
  luxury: ResourceDelta;
  materials: ResourceDelta;
}

interface ResourceDelta {
  current: number;
  delta: number;
}

interface HappinessSummary {
  value: number;
  emoji: string;
}

interface NationSnapshot {
  id?: string;
  finance?: { treasury?: number; debt?: number; waterfall?: Record<string, number> };
  status?: { stockpiles?: StockpileMap; flows?: { energy?: number; logistics?: number; research?: number }; labor?: LaborPool; happiness?: HappinessSummary };
  stockpiles?: Partial<Record<keyof StockpileMap, number>>;
  energy?: { ratio?: number; supply?: number; demand?: number; plants?: Array<{ type: PlantType; status: string }>; throttledSectors?: Partial<Record<SectorKey, number>> };
  logistics?: { ratio?: number; supply?: number; demand?: number; throttledSectors?: Partial<Record<SectorKey, number>> };
  labor?: { available?: LaborPool; assigned?: LaborPool; happiness?: number; lai?: number } & LaborBreakdown;
  canton?: string;
  sectors?: Partial<Record<SectorKey, { capacity?: number; funded?: number; idle?: number; utilization?: number }>>;
  idleCost?: number;
  omCost?: number;
  welfare?: { education?: number; healthcare?: number; socialSupport?: number };
  military?: { upkeep?: number; funded?: number; discretionary?: number };
  projects?: Array<{ id: number; sector: string; tier: string; turnsRemaining: number; delayed: boolean }>;
}

interface EconomySnapshot {
  cantons?: Record<string, any>;
  energy?: { state?: { supply?: number; demand?: number; ratio?: number }; fuelUsed?: Record<string, number>; oAndMSpent?: number };
  finance?: { summary?: { expenditures?: number; interest?: number; netBorrowing?: number }; creditLimit?: number; debt?: number };
  infrastructure?: { national?: { airport?: string; port?: string; rail?: string }; airports?: Record<string, any>; ports?: Record<string, any>; railHubs?: Record<string, any> };
  trade?: { pendingImports?: Record<string, number>; pendingExports?: Record<string, number> };
  welfare?: { current?: { education?: number; healthcare?: number; socialSupport?: number } };
  resources?: Record<string, number>;
}

interface GameSnapshot {
  nations?: Record<string, NationSnapshot>;
  economy?: EconomySnapshot;
  turnNumber?: number;
  meta?: { seed?: string };
}

interface GoldDisplay {
  formatted: string;
  color: string;
  numeric: number;
}

interface StockpileDisplay {
  key: string;
  label: string;
  formatted: string;
}

interface LaborDisplayRow {
  type: string;
  available: number;
  required: number;
  gap: number;
}

interface HappinessDisplay {
  emoji: string;
  value: number;
  trend: 'up' | 'down' | 'flat';
}

interface FinanceDisplay {
  idleTax: number | null;
  energySpend: number | null;
  miscSpend: number | null;
  lastRound: number | null;
  treasury: number | null;
  projected: number | null;
  gold: GoldDisplay;
}

interface SectorDebugEntry {
  key: SectorKey;
  title: string;
  capacity: number;
  perSlotCost: number;
  ceiling: number;
  funding: number;
  attemptedSlots: number;
  gateTrace: Record<typeof GATE_SEQUENCE[number], number>;
  utilizationPercent: number;
  outputSummary: string;
  idleSlots: number;
  idleCost: number;
  bottlenecks: string[];
}

interface EnergyDetailEntry {
  type: PlantType;
  count: number;
  output: number;
  oAndM: number;
}

interface EnergyDetails {
  ratio: number | null;
  supply: number | null;
  demand: number | null;
  generation: EnergyDetailEntry[];
  fuel: Array<{ resource: string; amount: number }>;
}

interface LogisticsDetails {
  ratio: number | null;
  supply: number | null;
  demand: number | null;
}

interface GatewayDisplay {
  type: string;
  id: string;
  status: string;
}

interface TradeDetails {
  gateways: GatewayDisplay[];
  imports: Array<{ resource: string; amount: number }>;
  exports: Array<{ resource: string; amount: number }>;
  fxImpact: number | null;
  fxRunway: number | null;
}

interface CantonEntry {
  id: string;
  urbanization: number | null;
  development: number | null;
  happiness: number | null;
  laborDemand: number | null;
  laborAssigned: number | null;
  laborAvailable: number | null;
  foodOk: boolean | null;
  luxuryOk: boolean | null;
  suitability: Array<{ sector: string; percent: number | null }>;
  sectorMix: Array<{ sector: string; capacity: number; funded: number; idle: number }>;
}

interface ProjectEntry {
  id: number;
  sector: string;
  tier: string;
  turnsRemaining: number;
  delayed: boolean;
}

interface ResearchDetails {
  perTurn: number | null;
  policies: Array<{ name: string; value: string }>;
}

interface DiagnosticEntry {
  id: string;
  label: string;
  passed: boolean;
  message?: string;
}

export interface DebugSidebarData {
  nationId: string | null;
  gold: GoldDisplay;
  stockpiles: StockpileDisplay[];
  flows: { energyRatio: number | null; logisticsRatio: number | null; research: number | null };
  laborRows: LaborDisplayRow[];
  happiness: HappinessDisplay;
  finance: FinanceDisplay;
  sectors: SectorDebugEntry[];
  energy: EnergyDetails;
  logistics: LogisticsDetails;
  trade: TradeDetails;
  cantons: CantonEntry[];
  projects: ProjectEntry[];
  research: ResearchDetails;
  diagnostics: DiagnosticEntry[];
  seed: string | null;
}

let initialized = false;
let rootEl: HTMLDivElement | null = null;
let contentEl: HTMLDivElement | null = null;
let toggleButton: HTMLButtonElement | null = null;
let isOpen = false;
let latestData: DebugSidebarData | null = null;
let cantonPage = 0;
const previousHappiness = new Map<string, number>();

function formatNumber(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(fractionDigits)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(fractionDigits)}k`;
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return value.toFixed(fractionDigits);
}

function resolveNation(snapshot: GameSnapshot | null, playerId: string | null): { nation: NationSnapshot | null; nationId: string | null } {
  if (!snapshot?.nations) return { nation: null, nationId: null };
  if (playerId && snapshot.nations[playerId]) {
    return { nation: snapshot.nations[playerId], nationId: playerId };
  }
  const [firstId, firstNation] = Object.entries(snapshot.nations)[0] ?? [null, null];
  return { nation: firstNation ?? null, nationId: firstId };
}

function deriveGoldDisplay(nation: NationSnapshot | null): GoldDisplay {
  const treasury = nation?.finance?.treasury ?? 0;
  const debt = nation?.finance?.debt ?? 0;
  const value = debt > 0 ? -Math.abs(debt) : treasury;
  const formatted = `Gold: ${formatNumber(value, 2)}`;
  let color = '#8BC34A';
  if (value < 0) {
    color = '#FF6B6B';
  } else if (Math.abs(value) < 5) {
    color = '#FFC107';
  }
  return { formatted, color, numeric: value };
}

function deriveStockpiles(nation: NationSnapshot | null): StockpileDisplay[] {
  return STOCK_ORDER.map(({ key, label }) => {
    const status = nation?.status?.stockpiles?.[key];
    if (status) {
      return {
        key,
        label,
        formatted: `${formatNumber(status.current, 1)} (${status.delta >= 0 ? '+' : ''}${formatNumber(status.delta, 1)})`,
      };
    }
    const fallback = nation?.stockpiles?.[key] ?? 0;
    return {
      key,
      label,
      formatted: `${formatNumber(fallback, 1)} (+0)`,
    };
  });
}

function deriveLaborRows(nation: NationSnapshot | null): LaborDisplayRow[] {
  const available = nation?.labor?.available ?? { general: 0, skilled: 0, specialist: 0 };
  const assigned = nation?.labor?.assigned ?? { general: 0, skilled: 0, specialist: 0 };
  return LABOR_TYPES.map(({ key, label }) => {
    const avail = (available as any)?.[key] ?? 0;
    const req = (assigned as any)?.[key] ?? 0;
    return {
      type: label,
      available: avail,
      required: req,
      gap: avail - req,
    };
  });
}

function deriveHappiness(nation: NationSnapshot | null, nationId: string | null): HappinessDisplay {
  const value = nation?.status?.happiness?.value ?? Math.round((nation?.labor?.happiness ?? 0) * 100);
  const emoji = nation?.status?.happiness?.emoji ?? '😐';
  const previous = nationId ? previousHappiness.get(nationId) ?? value : value;
  if (nationId) previousHappiness.set(nationId, value);
  const trend: 'up' | 'down' | 'flat' = value > previous ? 'up' : value < previous ? 'down' : 'flat';
  return { emoji, value, trend };
}

function deriveFinance(
  snapshot: GameSnapshot | null,
  nation: NationSnapshot | null,
  nationId: string | null,
  previousLastRound: number = 0,
): FinanceDisplay {
  const idleTax = nation?.idleCost ?? null;
  const runningCost = computeRunningCost(nation, snapshot);
  const omTotal = nation?.omCost ?? (runningCost !== null && idleTax !== null ? runningCost + idleTax : null);
  const energySpend =
    runningCost !== null && omTotal !== null && idleTax !== null
      ? Math.max(0, omTotal - runningCost - idleTax)
      : snapshot?.economy?.energy?.oAndMSpent ?? null;
  const miscSpend = snapshot?.economy?.finance?.summary?.interest ?? null;
  const lastRound = computeLastRoundSpendFromSnapshot(snapshot, nation ?? {}, previousLastRound);
  const treasury = nation?.finance?.treasury ?? null;
  const waterfall = nation?.finance?.waterfall;
  const projected = waterfall
    ? (waterfall.interest ?? 0) +
      (waterfall.operations ?? 0) +
      (waterfall.welfare ?? 0) +
      (waterfall.military ?? 0) +
      (waterfall.projects ?? 0)
    : snapshot?.economy?.finance?.summary?.expenditures ?? null;

  return {
    idleTax,
    energySpend,
    miscSpend,
    lastRound,
    treasury,
    projected,
    gold: deriveGoldDisplay(nation),
  };
}

function computeRunningCost(nation: NationSnapshot | null, snapshot: GameSnapshot | null): number | null {
  if (!nation) return null;
  const cantonId = nation.canton;
  const canton = cantonId ? snapshot?.economy?.cantons?.[cantonId] : undefined;
  let total = 0;
  let any = false;
  for (const sector of SECTORS) {
    const state = (canton?.sectors ?? nation.sectors)?.[sector];
    const running = state?.utilization ?? state?.funded ?? 0;
    const cost = OM_COST_PER_SLOT[sector] ?? 0;
    if (cost > 0 && running > 0) {
      total += running * cost;
      any = true;
    }
  }
  return any ? total : null;
}

function deriveSectorDebug(snapshot: GameSnapshot | null, nation: NationSnapshot | null, nationId: string | null): SectorDebugEntry[] {
  const cantonId = nation?.canton;
  const canton = cantonId ? snapshot?.economy?.cantons?.[cantonId] : undefined;
  return SECTORS.map((sector) => {
    const title = SECTOR_TITLES[sector];
    const perSlot = OM_COST_PER_SLOT[sector] ?? 0;
    const cantonState = canton?.sectors?.[sector];
    const nationState = nation?.sectors?.[sector];
    const state = cantonState ?? nationState ?? {};
    const capacity = state.capacity ?? 0;
    const fundedSlots = state.funded ?? 0;
    const runningSlots = state.utilization ?? fundedSlots;
    const attempted = Math.min(capacity, fundedSlots);
    const funding = attempted * perSlot;
    const energyThrottle = nation?.energy?.throttledSectors?.[sector] ?? 0;
    const logisticsThrottle = nation?.logistics?.throttledSectors?.[sector] ?? 0;
    const afterBudget = attempted;
    const afterInputs = Math.max(0, afterBudget - energyThrottle);
    const afterLogistics = Math.max(0, afterInputs - logisticsThrottle);
    const laborAssigned = canton?.laborAssigned?.[sector];
    const laborDemand = canton?.laborDemand?.[sector];
    const afterLabor = Math.min(afterLogistics, runningSlots);
    const gateTrace: Record<typeof GATE_SEQUENCE[number], number> = {
      budget: afterBudget,
      inputs: afterInputs,
      logistics: afterLogistics,
      labor: afterLabor,
      suitability: runningSlots,
    };
    const idleSlots = Math.max(0, capacity - runningSlots);
    const idleCost = idleSlots * perSlot * IDLE_TAX_RATE;
    const utilizationPercent = capacity > 0 ? Math.round((runningSlots / capacity) * 100) : 0;
    const outputs = SECTOR_OUTPUTS[sector];
    const outputParts = Object.entries(outputs)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `${resource}: ${formatNumber(amount * runningSlots, 1)}`);
    const bottlenecks: string[] = [];
    if (afterBudget > afterInputs) bottlenecks.push(`Energy-limited (-${afterBudget - afterInputs} slots)`);
    if (afterInputs > afterLogistics) bottlenecks.push(`Logistics-limited (-${afterInputs - afterLogistics} slots)`);
    if (afterLogistics > runningSlots) {
      const demandTotal = laborDemand ? Object.values(laborDemand).reduce((sum, v) => sum + (v ?? 0), 0) : 0;
      const assignedTotal = laborAssigned ? Object.values(laborAssigned).reduce((sum, v) => sum + (v ?? 0), 0) : 0;
      if (assignedTotal < demandTotal) {
        bottlenecks.push(`Labor-limited (-${afterLogistics - runningSlots} slots)`);
      } else {
        bottlenecks.push(`Suitability-limited (-${afterLogistics - runningSlots} slots)`);
      }
    }

    return {
      key: sector,
      title,
      capacity,
      perSlotCost: perSlot,
      ceiling: capacity * perSlot,
      funding,
      attemptedSlots: attempted,
      gateTrace,
      utilizationPercent,
      outputSummary: outputParts.join(', ') || '—',
      idleSlots,
      idleCost,
      bottlenecks,
    };
  });
}

function deriveEnergyDetails(snapshot: GameSnapshot | null, nation: NationSnapshot | null): EnergyDetails {
  const supply = nation?.energy?.supply ?? snapshot?.economy?.energy?.state?.supply ?? null;
  const demand = nation?.energy?.demand ?? snapshot?.economy?.energy?.state?.demand ?? null;
  const ratio = nation?.energy?.ratio ?? snapshot?.economy?.energy?.state?.ratio ?? null;
  const generationMap = new Map<PlantType, EnergyDetailEntry>();
  const fuelMap: Record<string, number> = {};
  for (const plant of nation?.energy?.plants ?? []) {
    if (plant.status !== 'active') continue;
    const attrs = PLANT_ATTRIBUTES[plant.type as PlantType];
    if (!attrs) continue;
    const entry = generationMap.get(plant.type as PlantType) ?? {
      type: plant.type as PlantType,
      count: 0,
      output: 0,
      oAndM: 0,
    };
    entry.count += 1;
    const output = attrs.baseOutput * (attrs.rcf ? RENEWABLE_CAPACITY_FACTOR : 1);
    entry.output += output;
    entry.oAndM += attrs.oAndMCost;
    generationMap.set(plant.type as PlantType, entry);
    if (attrs.fuelType) {
      fuelMap[attrs.fuelType] = (fuelMap[attrs.fuelType] ?? 0) + attrs.baseOutput;
    }
  }
  const generation = Array.from(generationMap.values()).sort((a, b) => b.output - a.output);
  const fuel = Object.entries(fuelMap).map(([resource, amount]) => ({ resource, amount }));
  return { ratio, supply, demand, generation, fuel };
}

function deriveLogisticsDetails(nation: NationSnapshot | null): LogisticsDetails {
  const ratio = nation?.logistics?.ratio ?? null;
  const supply = nation?.logistics?.supply ?? null;
  const demand = nation?.logistics?.demand ?? null;
  return { ratio, supply, demand };
}

function deriveGateways(economy: EconomySnapshot | undefined): GatewayDisplay[] {
  if (!economy?.infrastructure) return [];
  const result: GatewayDisplay[] = [];
  const { national, airports, ports, railHubs } = economy.infrastructure;
  if (national?.airport && airports?.[national.airport]) {
    result.push({ type: 'Airport', id: national.airport, status: airports[national.airport].status ?? 'unknown' });
  }
  if (national?.port && ports?.[national.port]) {
    result.push({ type: 'Port', id: national.port, status: ports[national.port].status ?? 'unknown' });
  }
  if (national?.rail && railHubs?.[national.rail]) {
    result.push({ type: 'Rail Hub', id: national.rail, status: railHubs[national.rail].status ?? 'unknown' });
  }
  return result;
}

function deriveTradeDetails(snapshot: GameSnapshot | null): TradeDetails {
  const gateways = deriveGateways(snapshot?.economy);
  const imports = Object.entries(snapshot?.economy?.trade?.pendingImports ?? {}).map(([resource, amount]) => ({
    resource,
    amount,
  }));
  const exports = Object.entries(snapshot?.economy?.trade?.pendingExports ?? {}).map(([resource, amount]) => ({
    resource,
    amount,
  }));
  return { gateways, imports, exports, fxImpact: null, fxRunway: null };
}

function deriveCantons(snapshot: GameSnapshot | null, nation: NationSnapshot | null): CantonEntry[] {
  if (!snapshot?.economy?.cantons || !nation?.canton) return [];
  const id = nation.canton;
  const canton = snapshot.economy.cantons[id];
  if (!canton) return [];
  const sectorMix = Object.entries(canton.sectors ?? {}).map(([sector, data]) => ({
    sector,
    capacity: data?.capacity ?? 0,
    funded: data?.funded ?? 0,
    idle: data?.idle ?? Math.max(0, (data?.capacity ?? 0) - (data?.funded ?? 0)),
  }));
  const suitability = Object.entries(canton.suitability ?? {}).map(([sector, percent]) => ({
    sector,
    percent: typeof percent === 'number' ? percent : null,
  }));
  const laborDemand = Object.values(canton.laborDemand ?? {}).reduce(
    (sum, entry) => sum + Object.values(entry ?? {}).reduce((inner, value) => inner + (value ?? 0), 0),
    0,
  );
  const laborAssigned = Object.values(canton.laborAssigned ?? {}).reduce(
    (sum, entry) => sum + Object.values(entry ?? {}).reduce((inner, value) => inner + (value ?? 0), 0),
    0,
  );
  const laborAvailable = Object.values(canton.labor ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
  const consumption = canton.consumption ?? {};
  return [
    {
      id,
      urbanization: canton.urbanizationLevel ?? null,
      development: canton.development ?? null,
      happiness: canton.happiness ?? null,
      laborDemand,
      laborAssigned,
      laborAvailable,
      foodOk:
        consumption.foodProvided !== undefined && consumption.foodRequired !== undefined
          ? consumption.foodProvided >= consumption.foodRequired
          : null,
      luxuryOk:
        consumption.luxuryProvided !== undefined && consumption.luxuryRequired !== undefined
          ? consumption.luxuryProvided >= consumption.luxuryRequired
          : null,
      suitability,
      sectorMix,
    },
  ];
}

function deriveProjects(nation: NationSnapshot | null): ProjectEntry[] {
  return (nation?.projects ?? []).map((project) => ({
    id: project.id,
    sector: project.sector,
    tier: project.tier,
    turnsRemaining: project.turnsRemaining,
    delayed: project.delayed,
  }));
}

function deriveResearch(nation: NationSnapshot | null, snapshot: GameSnapshot | null): ResearchDetails {
  const perTurn = nation?.status?.flows?.research ?? snapshot?.economy?.resources?.research ?? null;
  const welfare = nation?.welfare ?? snapshot?.economy?.welfare?.current ?? {};
  const policies: Array<{ name: string; value: string }> = [];
  if (typeof welfare.education === 'number') {
    policies.push({ name: 'Education Tier', value: `Tier ${welfare.education}` });
  }
  if (typeof welfare.healthcare === 'number') {
    policies.push({ name: 'Healthcare Tier', value: `Tier ${welfare.healthcare}` });
  }
  if (typeof welfare.socialSupport === 'number') {
    policies.push({ name: 'Social Support', value: `Tier ${welfare.socialSupport}` });
  }
  return { perTurn, policies };
}

function deriveDiagnostics(data: DebugSidebarData, nation: NationSnapshot | null): DiagnosticEntry[] {
  const assertions: DiagnosticEntry[] = [];
  const fundingZeroViolations = data.sectors.filter((sector) => sector.funding === 0 && sector.gateTrace.suitability > 0);
  assertions.push({
    id: 'funding-zero',
    label: 'Funding=0 ⇒ Utilization=0',
    passed: fundingZeroViolations.length === 0,
    message: fundingZeroViolations.length === 0 ? undefined : `${fundingZeroViolations.length} sector(s) running without funding`,
  });
  const ceilingMismatch = data.sectors.filter((sector) => sector.ceiling !== sector.capacity * sector.perSlotCost);
  assertions.push({
    id: 'ceiling',
    label: 'Ceiling = capacity × per-slot cost',
    passed: ceilingMismatch.length === 0,
    message: ceilingMismatch.length === 0 ? undefined : `${ceilingMismatch.length} sector(s) mismatch`,
  });
  const treasury = nation?.finance?.treasury ?? 0;
  const debt = nation?.finance?.debt ?? 0;
  const goldNumeric = data.gold.numeric;
  assertions.push({
    id: 'treasury-debt',
    label: 'Treasury negative ⇒ Gold negative',
    passed: treasury >= 0 || goldNumeric < 0 || debt === 0,
    message: treasury < 0 && goldNumeric >= 0 ? 'Treasury below zero but gold not negative' : undefined,
  });
  return assertions;
}

export function buildDebugSidebarData(
  snapshot: GameSnapshot | null,
  playerId: string | null,
  previousLastRound: number = 0,
): DebugSidebarData {
  const { nation, nationId } = resolveNation(snapshot, playerId);
  const gold = deriveGoldDisplay(nation);
  const stockpiles = deriveStockpiles(nation);
  const flows = {
    energyRatio: nation?.energy?.ratio ?? null,
    logisticsRatio: nation?.logistics?.ratio ?? null,
    research: nation?.status?.flows?.research ?? null,
  };
  const laborRows = deriveLaborRows(nation);
  const happiness = deriveHappiness(nation, nationId);
  const finance = deriveFinance(snapshot, nation, nationId, previousLastRound);
  const sectors = deriveSectorDebug(snapshot, nation, nationId);
  const energy = deriveEnergyDetails(snapshot, nation);
  const logistics = deriveLogisticsDetails(nation);
  const trade = deriveTradeDetails(snapshot);
  const cantons = deriveCantons(snapshot, nation);
  const projects = deriveProjects(nation);
  const research = deriveResearch(nation, snapshot);
  const diagnostics = deriveDiagnostics(
    {
      nationId: nationId ?? null,
      gold,
      stockpiles,
      flows,
      laborRows,
      happiness,
      finance,
      sectors,
      energy,
      logistics,
      trade,
      cantons,
      projects,
      research,
      diagnostics: [],
      seed: snapshot?.meta?.seed ?? null,
    },
    nation,
  );

  return {
    nationId: nationId ?? null,
    gold,
    stockpiles,
    flows,
    laborRows,
    happiness,
    finance,
    sectors,
    energy,
    logistics,
    trade,
    cantons,
    projects,
    research,
    diagnostics,
    seed: snapshot?.meta?.seed ?? null,
  };
}

function ensureInitialized(): void {
  if (!DEBUG_SIDEBAR_ENABLED || initialized) return;
  toggleButton = document.createElement('button');
  toggleButton.id = 'debugSidebarToggleButton';
  toggleButton.textContent = 'Debug';
  toggleButton.style.cssText = `
    position: fixed;
    top: 64px;
    left: 12px;
    z-index: 1400;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.75);
    color: #f0f0f0;
    border: 1px solid #4CAF50;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  `;
  toggleButton.setAttribute('aria-pressed', 'false');
  toggleButton.addEventListener('click', () => toggleSidebar(!isOpen));
  document.body.appendChild(toggleButton);

  rootEl = document.createElement('div');
  rootEl.id = 'debugSidebarRoot';
  rootEl.style.cssText = `
    position: fixed;
    top: 56px;
    left: 10px;
    width: 360px;
    max-height: calc(100vh - 66px);
    background: rgba(0, 0, 0, 0.82);
    color: #f2f2f2;
    border-radius: 8px;
    padding: 12px;
    font-family: 'Inter', Arial, sans-serif;
    font-size: 12px;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    z-index: 1300;
    display: none;
  `;

  const header = document.createElement('div');
  header.id = 'debugSidebarHeader';
  header.style.cssText = 'font-weight: 600; margin-bottom: 10px; position: sticky; top: 0; background: rgba(0,0,0,0.82); padding-bottom: 6px;';
  header.textContent = 'Debug Sidebar';
  rootEl.appendChild(header);

  contentEl = document.createElement('div');
  contentEl.id = 'debugSidebarContent';
  rootEl.appendChild(contentEl);
  document.body.appendChild(rootEl);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      toggleSidebar(!isOpen);
    }
  });

  const stored = sessionStorage.getItem(STORAGE_KEY);
  toggleSidebar(stored !== 'closed');
  initialized = true;
}

function toggleSidebar(open: boolean): void {
  if (!rootEl || !toggleButton) return;
  isOpen = open;
  sessionStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
  rootEl.style.display = open ? 'block' : 'none';
  toggleButton.textContent = open ? 'Hide Debug' : 'Debug';
  toggleButton.setAttribute('aria-pressed', open ? 'true' : 'false');
}

function renderOverviewSection(data: DebugSidebarData): string {
  const stockRows = data.stockpiles
    .map((item) => `<div id="debugStock-${item.key}" class="debug-stock-row" style="display:flex; justify-content: space-between;">
      <span>${item.label}</span>
      <span>${item.formatted}</span>
    </div>`)
    .join('');
  const laborRows = data.laborRows
    .map(
      (row) => `<div id="debugLabor-${row.type.replace(/\s+/g, '')}" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:4px;">
        <span>${row.type}</span>
        <span>${formatNumber(row.available, 1)}</span>
        <span>${formatNumber(row.required, 1)} (${row.gap >= 0 ? '+' : ''}${formatNumber(row.gap, 1)})</span>
      </div>`,
    )
    .join('');
  return `
    <section id="debugSection-overview" class="debug-section">
      <div id="debugSectionHeader-overview" class="debug-section-header">Nation Overview</div>
      <div id="debugGold" style="color:${data.gold.color}; font-weight:600; margin-bottom:6px;">${data.gold.formatted}</div>
      <div id="debugStockpileContainer" style="display:flex; flex-direction:column; gap:4px;">${stockRows}</div>
      <div id="debugFlowContainer" style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
        <div id="debugFlow-energy">Energy Ratio: ${formatNumber(data.flows.energyRatio, 2)}</div>
        <div id="debugFlow-logistics">Logistics Ratio: ${formatNumber(data.flows.logisticsRatio, 2)}</div>
        <div id="debugFlow-research">Research: ${formatNumber(data.flows.research, 1)}/turn</div>
      </div>
      <div id="debugLaborHeader" style="margin-top:8px; font-weight:600;">Labor (Avail / Required / Gap)</div>
      <div id="debugLaborContainer" style="display:flex; flex-direction:column; gap:4px;">${laborRows}</div>
      <div id="debugHappiness" style="margin-top:8px;">Happiness: ${data.happiness.emoji} ${data.happiness.value} (${data.happiness.trend})</div>
    </section>
  `;
}

function renderFinanceSection(data: DebugSidebarData): string {
  const finance = data.finance;
  return `
    <section id="debugSection-finance" class="debug-section">
      <div id="debugSectionHeader-finance" class="debug-section-header">Finance Summary</div>
      <div id="debugFinance-idleTax">Idle Tax: ${formatNumber(finance.idleTax, 2)} g</div>
      <div id="debugFinance-energy">Energy/Infrastructure: ${formatNumber(finance.energySpend, 2)} g</div>
      <div id="debugFinance-misc">Misc Spend: ${formatNumber(finance.miscSpend, 2)} g</div>
      <div id="debugFinance-lastRound">Gold Spent Last Round: ${formatNumber(finance.lastRound, 2)} g</div>
      <div id="debugFinance-treasury" style="color:${finance.gold.color};">Treasury: ${formatNumber(finance.treasury, 2)} g</div>
      <div id="debugFinance-projected">Projected Costs: ${formatNumber(finance.projected, 2)} g</div>
    </section>
  `;
}

function renderSectorsSection(data: DebugSidebarData): string {
  const sectorCards = data.sectors
    .map((sector) => {
      const gateRows = GATE_SEQUENCE.map((gate) => `<div id="debugGate-${sector.key}-${gate}" style="display:flex; justify-content:space-between;">
          <span>${gate}</span>
          <span>${formatNumber(sector.gateTrace[gate], 0)} slots</span>
        </div>`).join('');
      const bottlenecks = sector.bottlenecks.length > 0 ? sector.bottlenecks.join('; ') : 'None';
      return `
        <details id="debugSector-${sector.key}" class="debug-sector-card" open>
          <summary id="debugSectorHeader-${sector.key}" style="cursor:pointer; font-weight:600;">${sector.title}</summary>
          <div id="debugSectorBody-${sector.key}" style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
            <div id="debugSectorCapacity-${sector.key}">Capacity: ${formatNumber(sector.capacity, 0)} slots</div>
            <div id="debugSectorPerSlot-${sector.key}">Per-slot O&M: ${formatNumber(sector.perSlotCost, 2)} g</div>
            <div id="debugSectorCeiling-${sector.key}">Ceiling: ${formatNumber(sector.ceiling, 2)} g</div>
            <div id="debugSectorFunding-${sector.key}">Funding: ${formatNumber(sector.funding, 2)} g</div>
            <div id="debugSectorAttempted-${sector.key}">Attempted Slots: ${formatNumber(sector.attemptedSlots, 0)}</div>
            <div id="debugSectorGate-${sector.key}" style="display:flex; flex-direction:column; gap:2px; padding-left:4px; border-left:1px solid #333;">${gateRows}</div>
            <div id="debugSectorUtilization-${sector.key}">Utilization: ${formatNumber(sector.utilizationPercent, 0)}%</div>
            <div id="debugSectorOutput-${sector.key}">Output: ${sector.outputSummary}</div>
            <div id="debugSectorIdle-${sector.key}">Idle Slots: ${formatNumber(sector.idleSlots, 0)} (Idle Cost: ${formatNumber(sector.idleCost, 2)} g)</div>
            <div id="debugSectorBottlenecks-${sector.key}">Bottlenecks: ${bottlenecks}</div>
          </div>
        </details>
      `;
    })
    .join('');
  return `
    <section id="debugSection-sectors" class="debug-section">
      <div id="debugSectionHeader-sectors" class="debug-section-header">Sector Planner</div>
      ${sectorCards}
    </section>
  `;
}

function renderEnergySection(data: DebugSidebarData): string {
  const rows = data.energy.generation
    .map(
      (entry) => `<div id="debugEnergyRow-${entry.type}" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:4px;">
        <span>${entry.type}</span>
        <span>${formatNumber(entry.output, 1)} MW</span>
        <span>${formatNumber(entry.oAndM, 1)} g</span>
      </div>`,
    )
    .join('');
  const fuelRows = data.energy.fuel
    .map((fuel) => `<div id="debugEnergyFuel-${fuel.resource}">${fuel.resource}: ${formatNumber(fuel.amount, 1)}</div>`)
    .join('');
  return `
    <section id="debugSection-energy" class="debug-section">
      <div id="debugSectionHeader-energy" class="debug-section-header">Energy & Logistics</div>
      <div id="debugEnergyRatio">Energy Ratio: ${formatNumber(data.energy.ratio, 2)} (Target 0.95–1.05)</div>
      <div id="debugEnergySupply">Supply: ${formatNumber(data.energy.supply, 1)} | Demand: ${formatNumber(data.energy.demand, 1)}</div>
      <div id="debugEnergyGeneration" style="margin-top:6px; display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:600;">Generation by Plant</div>
        ${rows || '<div id="debugEnergyGeneration-empty">No active plants</div>'}
      </div>
      <div id="debugEnergyFuel" style="margin-top:6px; display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:600;">Fuel Needs</div>
        ${fuelRows || '<div id="debugEnergyFuel-empty">No fuel consumption</div>'}
      </div>
      <div id="debugLogisticsRatio" style="margin-top:8px;">Logistics Ratio: ${formatNumber(data.logistics.ratio, 2)}</div>
      <div id="debugLogisticsSupply">Supply: ${formatNumber(data.logistics.supply, 1)} | Demand: ${formatNumber(data.logistics.demand, 1)}</div>
    </section>
  `;
}

function renderTradeSection(data: DebugSidebarData): string {
  const gatewayRows = data.trade.gateways
    .map((gateway) => `<div id="debugGateway-${gateway.type}" style="display:flex; justify-content:space-between;">
        <span>${gateway.type}</span>
        <span>${gateway.id} (${gateway.status})</span>
      </div>`)
    .join('');
  const imports = data.trade.imports
    .map((entry) => `<div id="debugImport-${entry.resource}">${entry.resource}: ${formatNumber(entry.amount, 1)}</div>`)
    .join('');
  const exports = data.trade.exports
    .map((entry) => `<div id="debugExport-${entry.resource}">${entry.resource}: ${formatNumber(entry.amount, 1)}</div>`)
    .join('');
  return `
    <section id="debugSection-trade" class="debug-section">
      <div id="debugSectionHeader-trade" class="debug-section-header">Trade & Gateways</div>
      <div id="debugGateways" style="display:flex; flex-direction:column; gap:2px;">${gatewayRows || '<div id="debugGateways-empty">No gateway data</div>'}</div>
      <div id="debugImports" style="margin-top:6px;">
        <div style="font-weight:600;">Top Imports</div>
        ${imports || '<div id="debugImports-empty">No imports pending</div>'}
      </div>
      <div id="debugExports" style="margin-top:6px;">
        <div style="font-weight:600;">Top Exports</div>
        ${exports || '<div id="debugExports-empty">No exports pending</div>'}
      </div>
    </section>
  `;
}

function renderCantonsSection(data: DebugSidebarData): string {
  const entries = data.cantons;
  const totalPages = Math.max(1, Math.ceil(entries.length / CANTON_PAGE_SIZE));
  if (cantonPage >= totalPages) cantonPage = totalPages - 1;
  const slice = entries.slice(cantonPage * CANTON_PAGE_SIZE, cantonPage * CANTON_PAGE_SIZE + CANTON_PAGE_SIZE);
  const rows = slice
    .map((entry) => {
      const suitability = entry.suitability
        .map((s) => `${s.sector}: ${formatNumber(s.percent, 0)}%`)
        .join(', ');
      const mix = entry.sectorMix
        .map((s) => `${s.sector} ${formatNumber(s.funded, 0)}/${formatNumber(s.capacity, 0)}`)
        .join(', ');
      return `
        <div id="debugCanton-${entry.id}" class="debug-canton-card" style="border:1px solid #333; padding:6px; border-radius:4px; margin-bottom:6px;">
          <div id="debugCantonHeader-${entry.id}" style="font-weight:600;">${entry.id}</div>
          <div id="debugCantonUrban-${entry.id}">Urbanization: ${formatNumber(entry.urbanization, 0)} (Dev ${formatNumber(entry.development, 1)})</div>
          <div id="debugCantonHappiness-${entry.id}">Happiness: ${formatNumber(entry.happiness, 1)}</div>
          <div id="debugCantonLabor-${entry.id}">Labor Avail ${formatNumber(entry.laborAvailable, 1)} | Assigned ${formatNumber(entry.laborAssigned, 1)} | Demand ${formatNumber(entry.laborDemand, 1)}</div>
          <div id="debugCantonConsumption-${entry.id}">Food: ${entry.foodOk === null ? '—' : entry.foodOk ? 'OK' : 'Short'} | Luxury: ${entry.luxuryOk === null ? '—' : entry.luxuryOk ? 'OK' : 'Short'}</div>
          <div id="debugCantonSuitability-${entry.id}">Suitability: ${suitability || '—'}</div>
          <div id="debugCantonMix-${entry.id}">Sector Mix: ${mix || '—'}</div>
        </div>
      `;
    })
    .join('');
  return `
    <section id="debugSection-cantons" class="debug-section">
      <div id="debugSectionHeader-cantons" class="debug-section-header">Labor & Cantons</div>
      <div id="debugCantonsContainer">${rows || '<div id="debugCantons-empty">No canton data</div>'}</div>
      <div id="debugCantonsPagination" style="display:flex; justify-content:space-between; margin-top:6px;">
        <button id="debugCantonsPrev" ${cantonPage === 0 ? 'disabled' : ''}>Prev</button>
        <span id="debugCantonsPage">Page ${entries.length === 0 ? 0 : cantonPage + 1} / ${totalPages}</span>
        <button id="debugCantonsNext" ${cantonPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </section>
  `;
}

function renderProjectsSection(data: DebugSidebarData): string {
  const rows = data.projects
    .map(
      (project) => `<div id="debugProject-${project.id}" style="display:flex; justify-content:space-between;">
        <span>${project.sector} (${project.tier})</span>
        <span>${project.turnsRemaining} turns${project.delayed ? ' • delayed' : ''}</span>
      </div>`,
    )
    .join('');
  return `
    <section id="debugSection-projects" class="debug-section">
      <div id="debugSectionHeader-projects" class="debug-section-header">Projects & Construction</div>
      ${rows || '<div id="debugProjects-empty">No active projects</div>'}
    </section>
  `;
}

function renderResearchSection(data: DebugSidebarData): string {
  const policyRows = data.research.policies
    .map((policy) => `<div id="debugPolicy-${policy.name.replace(/\s+/g, '')}">${policy.name}: ${policy.value}</div>`)
    .join('');
  return `
    <section id="debugSection-research" class="debug-section">
      <div id="debugSectionHeader-research" class="debug-section-header">Research & Policy</div>
      <div id="debugResearchRate">Research/turn: ${formatNumber(data.research.perTurn, 1)}</div>
      <div id="debugPolicies" style="margin-top:4px; display:flex; flex-direction:column; gap:2px;">${policyRows || '<div id="debugPolicies-empty">No active policies tracked</div>'}</div>
    </section>
  `;
}

function renderDiagnosticsSection(data: DebugSidebarData): string {
  const rows = data.diagnostics
    .map(
      (entry) => `<div id="debugDiag-${entry.id}" style="display:flex; flex-direction:column; border:1px solid #333; padding:6px; border-radius:4px; gap:2px;">
        <div style="display:flex; justify-content:space-between;">
          <span>${entry.label}</span>
          <span style="color:${entry.passed ? '#8BC34A' : '#FF6B6B'};">${entry.passed ? 'Pass' : 'Fail'}</span>
        </div>
        ${entry.message ? `<div>${entry.message}</div>` : ''}
      </div>`,
    )
    .join('');
  return `
    <section id="debugSection-diagnostics" class="debug-section">
      <div id="debugSectionHeader-diagnostics" class="debug-section-header">Diagnostics</div>
      <div id="debugDiagContainer" style="display:flex; flex-direction:column; gap:6px;">${rows || '<div id="debugDiag-empty">No assertions evaluated</div>'}</div>
      <div id="debugSeed" style="margin-top:6px;">Seed: ${data.seed ?? '—'}</div>
      <div id="debugExportButtons" style="margin-top:6px; display:flex; gap:6px;">
        <button id="debugExportJson">Export JSON</button>
        <button id="debugExportCsv">Export CSV</button>
      </div>
    </section>
  `;
}

function renderSidebar(data: DebugSidebarData): void {
  if (!contentEl) return;
  latestData = data;
  const sections = [
    renderOverviewSection(data),
    renderFinanceSection(data),
    renderSectorsSection(data),
    renderEnergySection(data),
    renderTradeSection(data),
    renderCantonsSection(data),
    renderProjectsSection(data),
    renderResearchSection(data),
    renderDiagnosticsSection(data),
  ].join('');
  contentEl.innerHTML = sections;
  attachPaginationHandlers();
  attachExportHandlers();
}

function attachPaginationHandlers(): void {
  const prev = document.getElementById('debugCantonsPrev') as HTMLButtonElement | null;
  const next = document.getElementById('debugCantonsNext') as HTMLButtonElement | null;
  if (prev) {
    prev.addEventListener('click', () => {
      if (cantonPage > 0) {
        cantonPage -= 1;
        if (latestData) renderSidebar(latestData);
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (latestData) {
        const totalPages = Math.max(1, Math.ceil(latestData.cantons.length / CANTON_PAGE_SIZE));
        if (cantonPage < totalPages - 1) {
          cantonPage += 1;
          renderSidebar(latestData);
        }
      }
    });
  }
}

function attachExportHandlers(): void {
  const jsonBtn = document.getElementById('debugExportJson');
  const csvBtn = document.getElementById('debugExportCsv');
  if (jsonBtn) {
    jsonBtn.addEventListener('click', () => {
      if (!latestData) return;
      const blob = new Blob([JSON.stringify(latestData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'debug-sidebar.json';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }
  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      if (!latestData) return;
      const header = 'Sector,Capacity,Funding,Running,IdleCost';
      const rows = latestData.sectors
        .map((sector) => `${sector.title},${sector.capacity},${sector.funding},${sector.gateTrace.suitability},${sector.idleCost}`)
        .join('\n');
      const blob = new Blob([`${header}\n${rows}`], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'debug-sectors.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }
}

export function __resetDebugSidebarStateForTest(): void {
  previousHappiness.clear();
  cantonPage = 0;
  latestData = null;
}

export function initializeDebugSidebar(): void {
  ensureInitialized();
}

export function updateDebugSidebarFromGameState(snapshot: GameSnapshot | null, playerId: string | null): void {
  if (!DEBUG_SIDEBAR_ENABLED) return;
  ensureInitialized();
  if (!initialized || !contentEl) return;
  try {
    const data = buildDebugSidebarData(snapshot, playerId);
    renderSidebar(data);
  } catch (error) {
    console.warn('Debug sidebar failed to render', error);
    if (contentEl) {
      contentEl.innerHTML = '<div id="debugSidebarError">Unable to render debug data</div>';
    }
  }
}

