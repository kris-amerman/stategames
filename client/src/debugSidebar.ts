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
const SIDEBAR_LEFT = 16;
const SIDEBAR_TOP = 72;
const SIDEBAR_WIDTH = 420;
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
  name?: string;
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
  nationCantons?: Record<string, string[]>;
  cantonMeta?: Record<string, { owner?: string }>;
  meta?: { seed?: string; nations?: Array<{ id: string; name?: string }> };
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

interface LaborTotals {
  available: number;
  assigned: number;
  demand: number | null;
}

interface SectorTotals {
  capacity: number;
  funded: number;
  utilization: number;
  idle: number;
}

interface ReconciliationData {
  cantonLabor: LaborTotals;
  nationLabor: LaborTotals;
  cantonSectors: Record<string, SectorTotals>;
  nationSectors: Record<string, SectorTotals>;
}

export interface NationDebugSidebarData {
  nationId: string;
  label: string;
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
  reconciliation: ReconciliationData;
}

export interface DebugSidebarData {
  nationOrder: string[];
  nations: Record<string, NationDebugSidebarData>;
  activeNationId: string | null;
  seed: string | null;
}

let initialized = false;
let stylesInjected = false;
let rootEl: HTMLDivElement | null = null;
let contentEl: HTMLDivElement | null = null;
let toggleButton: HTMLButtonElement | null = null;
let isOpen = false;
let latestData: DebugSidebarData | null = null;
let activeNationId: string | null = null;
const cantonPageByNation = new Map<string, number>();
const previousHappiness = new Map<string, number>();

function getCantonPage(nationId: string | null): number {
  if (!nationId) return 0;
  return cantonPageByNation.get(nationId) ?? 0;
}

function setCantonPage(nationId: string, page: number): void {
  cantonPageByNation.set(nationId, Math.max(0, page));
}

function resetMissingNationPages(validNationIds: string[]): void {
  const valid = new Set(validNationIds);
  for (const key of Array.from(cantonPageByNation.keys())) {
    if (!valid.has(key)) {
      cantonPageByNation.delete(key);
    }
  }
}

function withinTolerance(a: number, b: number, tolerance = 1e-3): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * tolerance;
}

function resolveActiveNationId(data: DebugSidebarData): string | null {
  if (activeNationId && data.nations[activeNationId]) {
    return activeNationId;
  }
  if (data.activeNationId && data.nations[data.activeNationId]) {
    return data.activeNationId;
  }
  for (const id of data.nationOrder) {
    if (data.nations[id]) return id;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function injectStyles(): void {
  if (stylesInjected) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'debugSidebarStyles';
  styleEl.textContent = `
    #debugSidebarRoot {
      line-height: 1.45;
    }
    #debugSidebarRoot .debug-section {
      padding: 14px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #debugSidebarRoot .debug-section:first-of-type {
      border-top: none;
      padding-top: 4px;
    }
    #debugSidebarRoot .debug-section-header {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #cfd8dc;
    }
    #debugSidebarRoot .debug-subheader {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #90a4ae;
    }
    #debugSidebarRoot .debug-metric-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #debugSidebarRoot .debug-grid-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    #debugSidebarRoot .debug-grid-row > span {
      padding: 2px 0;
    }
    #debugSidebarRoot .debug-label {
      color: #cfd8dc;
    }
    #debugSidebarRoot .debug-value {
      color: #ffffff;
      text-align: right;
    }
    #debugSidebarRoot .debug-table {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px 12px;
      align-items: center;
    }
    #debugSidebarRoot .debug-table span {
      white-space: nowrap;
    }
    #debugSidebarRoot .debug-card {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 10px;
      background: rgba(18, 21, 27, 0.65);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #debugSidebarRoot .debug-card + .debug-card {
      margin-top: 8px;
    }
    #debugSidebarRoot .debug-card .debug-card {
      margin-top: 6px;
      background: rgba(30, 34, 42, 0.65);
      border-color: rgba(255, 255, 255, 0.12);
    }
    #debugSidebarRoot .debug-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #debugSidebarRoot details.debug-card summary {
      font-weight: 600;
      cursor: pointer;
      outline: none;
    }
    #debugSidebarRoot details.debug-card summary::-webkit-details-marker {
      display: none;
    }
    #debugSidebarRoot details.debug-card[open] summary {
      color: #ffffff;
    }
    #debugSidebarRoot button {
      background: rgba(46, 125, 50, 0.18);
      color: #e0f2f1;
      border: 1px solid rgba(129, 199, 132, 0.4);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    #debugSidebarRoot button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    #debugSidebarRoot .debug-sector-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(styleEl);
  stylesInjected = true;
}

function formatNumber(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(fractionDigits)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(fractionDigits)}k`;
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return value.toFixed(fractionDigits);
}

function listCantonIdsForNation(
  snapshot: GameSnapshot | null,
  nation: NationSnapshot | null,
  nationId: string | null,
): string[] {
  if (!snapshot?.economy?.cantons) return [];
  const ids = new Set<string>();
  if (nation?.canton && snapshot.economy.cantons[nation.canton]) {
    ids.add(nation.canton);
  }
  if (nationId && snapshot.nationCantons?.[nationId]) {
    for (const id of snapshot.nationCantons[nationId]) {
      if (snapshot.economy.cantons[id]) {
        ids.add(id);
      }
    }
  }
  if (nationId && snapshot.cantonMeta) {
    for (const [id, meta] of Object.entries(snapshot.cantonMeta)) {
      if (meta?.owner === nationId && snapshot.economy.cantons[id]) {
        ids.add(id);
      }
    }
  }
  if (nationId && ids.size === 0) {
    for (const [id, canton] of Object.entries(snapshot.economy.cantons)) {
      const owner = (canton as any)?.owner ?? snapshot.cantonMeta?.[id]?.owner;
      if (owner === nationId) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

function computeNationLaborTotals(nation: NationSnapshot | null): LaborTotals {
  const available = LABOR_TYPES.reduce((sum, { key }) => {
    const pool = nation?.labor?.available as any;
    return sum + (pool?.[key] ?? 0);
  }, 0);
  const assigned = LABOR_TYPES.reduce((sum, { key }) => {
    const pool = nation?.labor?.assigned as any;
    return sum + (pool?.[key] ?? 0);
  }, 0);
  return { available, assigned, demand: null };
}

function aggregateNationSectorTotals(nation: NationSnapshot | null): Record<string, SectorTotals> {
  const totals: Record<string, SectorTotals> = {};
  if (!nation?.sectors) return totals;
  for (const [sector, details] of Object.entries(nation.sectors)) {
    const capacity = details?.capacity ?? 0;
    const funded = details?.funded ?? 0;
    const utilization = details?.utilization ?? funded;
    const idle = details?.idle ?? Math.max(0, capacity - utilization);
    totals[sector] = { capacity, funded, utilization, idle };
  }
  return totals;
}

function aggregateCantonSectorTotals(
  snapshot: GameSnapshot | null,
  cantonIds: string[],
): Record<string, SectorTotals> {
  const totals: Record<string, SectorTotals> = {};
  if (!snapshot?.economy?.cantons) return totals;
  for (const id of cantonIds) {
    const canton = snapshot.economy.cantons[id];
    if (!canton?.sectors) continue;
    for (const [sector, details] of Object.entries(canton.sectors)) {
      const existing = totals[sector] ?? { capacity: 0, funded: 0, utilization: 0, idle: 0 };
      const capacity = details?.capacity ?? 0;
      const funded = details?.funded ?? 0;
      const utilization = details?.utilization ?? funded;
      const idle =
        details?.idle ?? (capacity > 0 ? Math.max(0, capacity - utilization) : existing.idle);
      totals[sector] = {
        capacity: existing.capacity + capacity,
        funded: existing.funded + funded,
        utilization: existing.utilization + utilization,
        idle: existing.idle + idle,
      };
    }
  }
  return totals;
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
  cantonIds: string[],
  previousLastRound: number = 0,
): FinanceDisplay {
  const idleTax = nation?.idleCost ?? null;
  const runningCost = computeRunningCost(nation, snapshot, cantonIds);
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

function computeRunningCost(
  nation: NationSnapshot | null,
  snapshot: GameSnapshot | null,
  cantonIds: string[],
): number | null {
  if (!nation) return null;
  const cantonTotals = aggregateCantonSectorTotals(snapshot, cantonIds);
  let total = 0;
  let any = false;
  for (const sector of SECTORS) {
    const cost = OM_COST_PER_SLOT[sector] ?? 0;
    if (cost <= 0) continue;
    const cantonState = cantonTotals[sector];
    const nationState = nation.sectors?.[sector];
    const running =
      (cantonState?.utilization ?? 0) ||
      nationState?.utilization ||
      nationState?.funded ||
      0;
    if (running > 0) {
      total += running * cost;
      any = true;
    }
  }
  return any ? total : null;
}

function deriveSectorDebug(
  snapshot: GameSnapshot | null,
  nation: NationSnapshot | null,
  nationId: string | null,
  cantonIds: string[],
): SectorDebugEntry[] {
  const cantonTotals = aggregateCantonSectorTotals(snapshot, cantonIds);
  return SECTORS.map((sector) => {
    const title = SECTOR_TITLES[sector];
    const perSlot = OM_COST_PER_SLOT[sector] ?? 0;
    const cantonState = cantonTotals[sector];
    const nationState = nation?.sectors?.[sector];
    const capacity = (cantonState?.capacity ?? 0) || nationState?.capacity || 0;
    const fundedSlots = (cantonState?.funded ?? 0) || nationState?.funded || 0;
    const runningSlots =
      (cantonState?.utilization ?? 0) || nationState?.utilization || nationState?.funded || 0;
    const attempted = Math.min(capacity, fundedSlots);
    const funding = attempted * perSlot;
    const energyThrottle = nation?.energy?.throttledSectors?.[sector] ?? 0;
    const logisticsThrottle = nation?.logistics?.throttledSectors?.[sector] ?? 0;
    const afterBudget = attempted;
    const afterInputs = Math.max(0, afterBudget - energyThrottle);
    const afterLogistics = Math.max(0, afterInputs - logisticsThrottle);

    let demandTotal = 0;
    let assignedTotal = 0;
    if (snapshot?.economy?.cantons) {
      for (const id of cantonIds) {
        const canton = snapshot.economy.cantons[id];
        const laborAssigned = canton?.laborAssigned?.[sector];
        if (laborAssigned) {
          assignedTotal += Object.values(laborAssigned).reduce((sum, value) => sum + (value ?? 0), 0);
        }
        const laborDemand = canton?.laborDemand?.[sector];
        if (laborDemand) {
          demandTotal += Object.values(laborDemand).reduce((sum, value) => sum + (value ?? 0), 0);
        }
      }
    }
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

function deriveEnergyDetails(_snapshot: GameSnapshot | null, nation: NationSnapshot | null): EnergyDetails {
  const supply = nation?.energy?.supply ?? null;
  const demand = nation?.energy?.demand ?? null;
  const ratio = nation?.energy?.ratio ?? null;
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

function deriveGateways(economy: EconomySnapshot | undefined, nationId: string | null): GatewayDisplay[] {
  if (!economy?.infrastructure || !nationId) return [];
  const result: GatewayDisplay[] = [];
  const { national, airports, ports, railHubs } = economy.infrastructure;
  const addGateway = (
    type: GatewayDisplay['type'],
    id: string | undefined,
    registry: Record<string, any> | undefined,
  ) => {
    if (!id || !registry?.[id]) return;
    const entry = registry[id];
    const owner = entry?.owner;
    if (owner && owner !== nationId) return;
    result.push({ type, id, status: entry.status ?? 'unknown' });
  };
  addGateway('Airport', national?.airport, airports);
  addGateway('Port', national?.port, ports);
  addGateway('Rail Hub', national?.rail, railHubs);
  return result;
}

function deriveTradeDetails(snapshot: GameSnapshot | null, nationId: string | null): TradeDetails {
  if (!nationId) {
    return { gateways: [], imports: [], exports: [], fxImpact: null, fxRunway: null };
  }
  const gateways = deriveGateways(snapshot?.economy, nationId);
  const tradeState = snapshot?.economy?.trade ?? {};
  const imports = Object.entries(tradeState.pendingImports ?? {})
    .map(([resource, amount]) => ({ resource, amount }))
    .filter((entry) => (entry as any).owner ? (entry as any).owner === nationId : true);
  const exports = Object.entries(tradeState.pendingExports ?? {})
    .map(([resource, amount]) => ({ resource, amount }))
    .filter((entry) => (entry as any).owner ? (entry as any).owner === nationId : true);
  return { gateways, imports, exports, fxImpact: null, fxRunway: null };
}

function deriveCantons(
  snapshot: GameSnapshot | null,
  nation: NationSnapshot | null,
  nationId: string | null,
  cantonIds: string[],
): { entries: CantonEntry[]; reconciliation: ReconciliationData } {
  if (!snapshot?.economy?.cantons) {
    return {
      entries: [],
      reconciliation: {
        cantonLabor: { available: 0, assigned: 0, demand: 0 },
        nationLabor: computeNationLaborTotals(nation),
        cantonSectors: {},
        nationSectors: aggregateNationSectorTotals(nation),
      },
    };
  }
  const rawCantons = snapshot.economy.cantons;
  const ids = cantonIds.length > 0 ? cantonIds : nation?.canton ? [nation.canton] : [];
  const entries: CantonEntry[] = [];
  let laborDemandTotal = 0;
  let laborAssignedTotal = 0;
  let laborAvailableTotal = 0;
  const cantonSectorTotals: Record<string, SectorTotals> = {};

  for (const id of ids) {
    const canton = rawCantons[id];
    if (!canton) continue;
    const sectorMix = Object.entries(canton.sectors ?? {}).map(([sector, data]) => {
      const capacity = data?.capacity ?? 0;
      const funded = data?.funded ?? 0;
      const utilization = data?.utilization ?? funded;
      const idle = data?.idle ?? Math.max(0, capacity - utilization);
      const existing = cantonSectorTotals[sector] ?? { capacity: 0, funded: 0, utilization: 0, idle: 0 };
      cantonSectorTotals[sector] = {
        capacity: existing.capacity + capacity,
        funded: existing.funded + funded,
        utilization: existing.utilization + utilization,
        idle: existing.idle + idle,
      };
      return {
        sector,
        capacity,
        funded,
        idle,
      };
    });
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
    laborDemandTotal += laborDemand;
    laborAssignedTotal += laborAssigned;
    laborAvailableTotal += laborAvailable;
    const consumption = canton.consumption ?? {};
    entries.push({
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
    });
  }

  return {
    entries,
    reconciliation: {
      cantonLabor: { available: laborAvailableTotal, assigned: laborAssignedTotal, demand: laborDemandTotal },
      nationLabor: computeNationLaborTotals(nation),
      cantonSectors: cantonSectorTotals,
      nationSectors: aggregateNationSectorTotals(nation),
    },
  };
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

function deriveDiagnostics(data: NationDebugSidebarData, nation: NationSnapshot | null): DiagnosticEntry[] {
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
  const { reconciliation } = data;
  const laborChecks: string[] = [];
  if (reconciliation.nationLabor.available || reconciliation.cantonLabor.available) {
    if (!withinTolerance(reconciliation.nationLabor.available, reconciliation.cantonLabor.available, 0.02)) {
      laborChecks.push('available');
    }
  }
  if (reconciliation.nationLabor.assigned || reconciliation.cantonLabor.assigned) {
    if (!withinTolerance(reconciliation.nationLabor.assigned, reconciliation.cantonLabor.assigned, 0.02)) {
      laborChecks.push('assigned');
    }
  }
  assertions.push({
    id: 'labor-reconcile',
    label: 'Canton labor sums match nation totals',
    passed: laborChecks.length === 0,
    message: laborChecks.length === 0 ? undefined : `Mismatch in ${laborChecks.join(', ')}`,
  });

  const sectorMismatches: string[] = [];
  for (const sector of SECTORS) {
    const cantonTotals = reconciliation.cantonSectors[sector] ?? { capacity: 0, funded: 0, utilization: 0, idle: 0 };
    const nationTotals = reconciliation.nationSectors[sector] ?? { capacity: 0, funded: 0, utilization: 0, idle: 0 };
    const relevant =
      cantonTotals.capacity || cantonTotals.funded || nationTotals.capacity || nationTotals.funded || 0;
    if (!relevant) continue;
    const capacityOk = withinTolerance(nationTotals.capacity, cantonTotals.capacity, 0.02);
    const fundedOk = withinTolerance(nationTotals.funded, cantonTotals.funded, 0.02);
    const utilizationOk = withinTolerance(nationTotals.utilization, cantonTotals.utilization, 0.05);
    if (!capacityOk || !fundedOk || !utilizationOk) {
      sectorMismatches.push(SECTOR_TITLES[sector]);
    }
  }
  assertions.push({
    id: 'sector-reconcile',
    label: 'Canton sector sums match nation totals',
    passed: sectorMismatches.length === 0,
    message: sectorMismatches.length === 0 ? undefined : `Mismatch in ${sectorMismatches.join(', ')}`,
  });
  return assertions;
}

export function buildDebugSidebarData(
  snapshot: GameSnapshot | null,
  playerId: string | null,
  previousLastRound: number = 0,
): DebugSidebarData {
  const nations = snapshot?.nations ?? {};
  const nationOrder = Object.keys(nations);
  const nameLookup = new Map<string, string>();
  for (const entry of snapshot?.meta?.nations ?? []) {
    if (entry.id) {
      nameLookup.set(entry.id, entry.name ?? entry.id);
    }
  }
  const result: Record<string, NationDebugSidebarData> = {};
  for (const nationId of nationOrder) {
    const nation = nations[nationId];
    const label = nation?.name ?? nameLookup.get(nationId) ?? nationId;
    const cantonIds = listCantonIdsForNation(snapshot, nation, nationId);
    const gold = deriveGoldDisplay(nation);
    const stockpiles = deriveStockpiles(nation);
    const flows = {
      energyRatio: nation?.energy?.ratio ?? null,
      logisticsRatio: nation?.logistics?.ratio ?? null,
      research: nation?.status?.flows?.research ?? null,
    };
    const laborRows = deriveLaborRows(nation);
    const happiness = deriveHappiness(nation, nationId);
    const finance = deriveFinance(snapshot, nation, nationId, cantonIds, previousLastRound);
    const sectors = deriveSectorDebug(snapshot, nation, nationId, cantonIds);
    const energy = deriveEnergyDetails(snapshot, nation);
    const logistics = deriveLogisticsDetails(nation);
    const trade = deriveTradeDetails(snapshot, nationId);
    const cantonData = deriveCantons(snapshot, nation, nationId, cantonIds);
    const projects = deriveProjects(nation);
    const research = deriveResearch(nation, snapshot);
    const nationData: NationDebugSidebarData = {
      nationId,
      label,
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
      cantons: cantonData.entries,
      projects,
      research,
      diagnostics: [],
      reconciliation: cantonData.reconciliation,
    };
    nationData.diagnostics = deriveDiagnostics(nationData, nation);
    result[nationId] = nationData;
  }

  const preferred = playerId && nationOrder.includes(playerId) ? playerId : nationOrder[0] ?? null;
  resetMissingNationPages(nationOrder);

  return {
    nationOrder,
    nations: result,
    activeNationId: preferred,
    seed: snapshot?.meta?.seed ?? null,
  };
}

function ensureInitialized(): void {
  if (!DEBUG_SIDEBAR_ENABLED || initialized) return;
  injectStyles();
  toggleButton = document.createElement('button');
  toggleButton.id = 'debugSidebarToggleButton';
  toggleButton.textContent = 'Debug';
  toggleButton.style.cssText = `
    position: fixed;
    top: ${SIDEBAR_TOP}px;
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
  toggleButton.style.left = `${SIDEBAR_LEFT}px`;
  document.body.appendChild(toggleButton);

  rootEl = document.createElement('div');
  rootEl.id = 'debugSidebarRoot';
  rootEl.style.cssText = `
    position: fixed;
    top: ${SIDEBAR_TOP - 8}px;
    left: ${SIDEBAR_LEFT}px;
    width: ${SIDEBAR_WIDTH}px;
    max-height: calc(100vh - ${SIDEBAR_TOP + 24}px);
    background: rgba(0, 0, 0, 0.82);
    color: #f2f2f2;
    border-radius: 8px;
    padding: 16px;
    font-family: 'Inter', Arial, sans-serif;
    font-size: 12px;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    z-index: 1300;
    display: none;
  `;

  const closeButton = document.createElement('button');
  closeButton.id = 'debugSidebarCloseButton';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close debug sidebar');
  closeButton.innerHTML = '&times;';
  closeButton.style.cssText = `
    position: absolute;
    top: 6px;
    right: 8px;
    border: none;
    background: transparent;
    color: #f2f2f2;
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    padding: 4px;
  `;
  closeButton.addEventListener('click', () => toggleSidebar(false));
  rootEl.appendChild(closeButton);

  contentEl = document.createElement('div');
  contentEl.id = 'debugSidebarContent';
  contentEl.style.marginTop = '12px';
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
  toggleButton.textContent = 'Debug';
  toggleButton.setAttribute('aria-pressed', open ? 'true' : 'false');
  toggleButton.setAttribute('aria-hidden', open ? 'true' : 'false');
  if (open) {
    toggleButton.style.display = 'none';
  } else {
    toggleButton.style.display = 'block';
    toggleButton.style.left = `${SIDEBAR_LEFT}px`;
  }
}

function renderOverviewSection(data: NationDebugSidebarData): string {
  const stockRows = data.stockpiles
    .map(
      (item) => `
        <div id="debugStock-${item.key}" class="debug-grid-row">
          <span class="debug-label">${item.label}</span>
          <span class="debug-value">${item.formatted}</span>
        </div>
      `,
    )
    .join('');
  const laborRows = data.laborRows
    .map(
      (row) => `
        <span class="debug-label">${row.type}</span>
        <span class="debug-value">${formatNumber(row.available, 1)}</span>
        <span class="debug-value">${formatNumber(row.required, 1)} (${row.gap >= 0 ? '+' : ''}${formatNumber(row.gap, 1)})</span>
      `,
    )
    .join('');
  return `
    <section id="debugSection-overview" class="debug-section">
      <div id="debugSectionHeader-overview" class="debug-section-header">Nation Overview — ${escapeHtml(data.label)}</div>
      <div id="debugGold" style="color:${data.gold.color}; font-weight:600; font-size:14px;">${data.gold.formatted}</div>
      <div id="debugStockpileContainer" class="debug-metric-grid">${stockRows}</div>
      <div id="debugFlowContainer" class="debug-card">
        <div class="debug-subheader">Flows</div>
        <div id="debugFlow-energy" class="debug-grid-row">
          <span class="debug-label">Energy Ratio</span>
          <span class="debug-value">${formatNumber(data.flows.energyRatio, 2)}</span>
        </div>
        <div id="debugFlow-logistics" class="debug-grid-row">
          <span class="debug-label">Logistics Ratio</span>
          <span class="debug-value">${formatNumber(data.flows.logisticsRatio, 2)}</span>
        </div>
        <div id="debugFlow-research" class="debug-grid-row">
          <span class="debug-label">Research</span>
          <span class="debug-value">${formatNumber(data.flows.research, 1)}/turn</span>
        </div>
      </div>
      <div id="debugLaborHeader" class="debug-subheader">Labor (Avail / Required / Gap)</div>
      <div id="debugLaborContainer" class="debug-table">${laborRows}</div>
      <div id="debugHappiness" class="debug-card">
        <div class="debug-subheader">Happiness</div>
        <div>${data.happiness.emoji} ${data.happiness.value} (${data.happiness.trend})</div>
      </div>
    </section>
  `;
}

function renderFinanceSection(data: NationDebugSidebarData): string {
  const finance = data.finance;
  return `
    <section id="debugSection-finance" class="debug-section">
      <div id="debugSectionHeader-finance" class="debug-section-header">Finance Summary</div>
      <div class="debug-card">
        <div id="debugFinance-idleTax" class="debug-grid-row">
          <span class="debug-label">Idle Tax</span>
          <span class="debug-value">${formatNumber(finance.idleTax, 2)} g</span>
        </div>
        <div id="debugFinance-energy" class="debug-grid-row">
          <span class="debug-label">Energy / Infrastructure</span>
          <span class="debug-value">${formatNumber(finance.energySpend, 2)} g</span>
        </div>
        <div id="debugFinance-misc" class="debug-grid-row">
          <span class="debug-label">Misc Spend</span>
          <span class="debug-value">${formatNumber(finance.miscSpend, 2)} g</span>
        </div>
        <div id="debugFinance-lastRound" class="debug-grid-row">
          <span class="debug-label">Gold Spent Last Round</span>
          <span class="debug-value">${formatNumber(finance.lastRound, 2)} g</span>
        </div>
        <div id="debugFinance-treasury" class="debug-grid-row" style="color:${finance.gold.color};">
          <span class="debug-label">Treasury</span>
          <span class="debug-value">${formatNumber(finance.treasury, 2)} g</span>
        </div>
        <div id="debugFinance-projected" class="debug-grid-row">
          <span class="debug-label">Projected Costs</span>
          <span class="debug-value">${formatNumber(finance.projected, 2)} g</span>
        </div>
      </div>
    </section>
  `;
}

function renderSectorsSection(data: NationDebugSidebarData): string {
  const sectorCards = data.sectors
    .map((sector) => {
      const gateRows = GATE_SEQUENCE.map(
        (gate) => `
          <div id="debugGate-${sector.key}-${gate}" class="debug-grid-row">
            <span class="debug-label">${gate}</span>
            <span class="debug-value">${formatNumber(sector.gateTrace[gate], 0)} slots</span>
          </div>
        `,
      ).join('');
      const bottlenecks = sector.bottlenecks.length > 0 ? sector.bottlenecks.join('; ') : 'None';
      return `
        <details id="debugSector-${sector.key}" class="debug-card debug-sector-card" open>
          <summary id="debugSectorHeader-${sector.key}">${sector.title}</summary>
          <div id="debugSectorBody-${sector.key}" class="debug-sector-body">
            <div class="debug-grid-row" id="debugSectorCapacity-${sector.key}">
              <span class="debug-label">Capacity</span>
              <span class="debug-value">${formatNumber(sector.capacity, 0)} slots</span>
            </div>
            <div class="debug-grid-row" id="debugSectorPerSlot-${sector.key}">
              <span class="debug-label">Per-slot O&M</span>
              <span class="debug-value">${formatNumber(sector.perSlotCost, 2)} g</span>
            </div>
            <div class="debug-grid-row" id="debugSectorCeiling-${sector.key}">
              <span class="debug-label">Ceiling</span>
              <span class="debug-value">${formatNumber(sector.ceiling, 2)} g</span>
            </div>
            <div class="debug-grid-row" id="debugSectorFunding-${sector.key}">
              <span class="debug-label">Funding</span>
              <span class="debug-value">${formatNumber(sector.funding, 2)} g</span>
            </div>
            <div class="debug-grid-row" id="debugSectorAttempted-${sector.key}">
              <span class="debug-label">Attempted Slots</span>
              <span class="debug-value">${formatNumber(sector.attemptedSlots, 0)}</span>
            </div>
            <div id="debugSectorGate-${sector.key}" class="debug-card">
              <div class="debug-subheader">Gate Trace</div>
              ${gateRows}
            </div>
            <div class="debug-grid-row" id="debugSectorUtilization-${sector.key}">
              <span class="debug-label">Utilization</span>
              <span class="debug-value">${formatNumber(sector.utilizationPercent, 0)}%</span>
            </div>
            <div class="debug-grid-row" id="debugSectorOutput-${sector.key}">
              <span class="debug-label">Output</span>
              <span class="debug-value">${sector.outputSummary}</span>
            </div>
            <div class="debug-grid-row" id="debugSectorIdle-${sector.key}">
              <span class="debug-label">Idle Slots</span>
              <span class="debug-value">${formatNumber(sector.idleSlots, 0)} (Idle Cost: ${formatNumber(sector.idleCost, 2)} g)</span>
            </div>
            <div class="debug-grid-row" id="debugSectorBottlenecks-${sector.key}">
              <span class="debug-label">Bottlenecks</span>
              <span class="debug-value">${bottlenecks}</span>
            </div>
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

function renderEnergySection(data: NationDebugSidebarData): string {
  const rows = data.energy.generation
    .map(
      (entry) => `
        <div id="debugEnergyRow-${entry.type}" class="debug-grid-row">
          <span class="debug-label">${entry.type}</span>
          <span class="debug-value">${formatNumber(entry.output, 1)} MW • ${formatNumber(entry.oAndM, 1)} g</span>
        </div>
      `,
    )
    .join('');
  const fuelRows = data.energy.fuel
    .map(
      (fuel) => `
        <div id="debugEnergyFuel-${fuel.resource}" class="debug-grid-row">
          <span class="debug-label">${fuel.resource}</span>
          <span class="debug-value">${formatNumber(fuel.amount, 1)}</span>
        </div>
      `,
    )
    .join('');
  return `
    <section id="debugSection-energy" class="debug-section">
      <div id="debugSectionHeader-energy" class="debug-section-header">Energy & Logistics</div>
      <div class="debug-card">
        <div id="debugEnergyRatio" class="debug-grid-row">
          <span class="debug-label">Energy Ratio</span>
          <span class="debug-value">${formatNumber(data.energy.ratio, 2)} (Target 0.95–1.05)</span>
        </div>
        <div id="debugEnergySupply" class="debug-grid-row">
          <span class="debug-label">Supply vs Demand</span>
          <span class="debug-value">${formatNumber(data.energy.supply, 1)} / ${formatNumber(data.energy.demand, 1)}</span>
        </div>
      </div>
      <div id="debugEnergyGeneration" class="debug-card">
        <div class="debug-subheader">Generation by Plant</div>
        ${rows || '<div id="debugEnergyGeneration-empty">No active plants</div>'}
      </div>
      <div id="debugEnergyFuel" class="debug-card">
        <div class="debug-subheader">Fuel Needs</div>
        ${fuelRows || '<div id="debugEnergyFuel-empty">No fuel consumption</div>'}
      </div>
      <div class="debug-card">
        <div id="debugLogisticsRatio" class="debug-grid-row">
          <span class="debug-label">Logistics Ratio</span>
          <span class="debug-value">${formatNumber(data.logistics.ratio, 2)}</span>
        </div>
        <div id="debugLogisticsSupply" class="debug-grid-row">
          <span class="debug-label">Supply vs Demand</span>
          <span class="debug-value">${formatNumber(data.logistics.supply, 1)} / ${formatNumber(data.logistics.demand, 1)}</span>
        </div>
      </div>
    </section>
  `;
}

function renderTradeSection(data: NationDebugSidebarData): string {
  const gatewayRows = data.trade.gateways
    .map(
      (gateway) => `
        <div id="debugGateway-${gateway.type}" class="debug-grid-row">
          <span class="debug-label">${gateway.type}</span>
          <span class="debug-value">${gateway.id} (${gateway.status})</span>
        </div>
      `,
    )
    .join('');
  const imports = data.trade.imports
    .map(
      (entry) => `
        <div id="debugImport-${entry.resource}" class="debug-grid-row">
          <span class="debug-label">${entry.resource}</span>
          <span class="debug-value">${formatNumber(entry.amount, 1)}</span>
        </div>
      `,
    )
    .join('');
  const exports = data.trade.exports
    .map(
      (entry) => `
        <div id="debugExport-${entry.resource}" class="debug-grid-row">
          <span class="debug-label">${entry.resource}</span>
          <span class="debug-value">${formatNumber(entry.amount, 1)}</span>
        </div>
      `,
    )
    .join('');
  return `
    <section id="debugSection-trade" class="debug-section">
      <div id="debugSectionHeader-trade" class="debug-section-header">Trade & Gateways</div>
      <div id="debugGateways" class="debug-card">${gatewayRows || '<div id="debugGateways-empty">No gateway data</div>'}</div>
      <div id="debugImports" class="debug-card">
        <div class="debug-subheader">Top Imports</div>
        ${imports || '<div id="debugImports-empty">No imports pending</div>'}
      </div>
      <div id="debugExports" class="debug-card">
        <div class="debug-subheader">Top Exports</div>
        ${exports || '<div id="debugExports-empty">No exports pending</div>'}
      </div>
    </section>
  `;
}

function renderCantonsSection(nationId: string | null, data: NationDebugSidebarData): string {
  const entries = data.cantons;
  const totalPages = Math.max(1, Math.ceil(entries.length / CANTON_PAGE_SIZE));
  let page = nationId ? getCantonPage(nationId) : 0;
  if (page >= totalPages) {
    page = totalPages - 1;
    if (nationId) setCantonPage(nationId, page);
  }
  const startIndex = page * CANTON_PAGE_SIZE;
  const slice = entries.slice(startIndex, startIndex + CANTON_PAGE_SIZE);
  const rows = slice
    .map((entry, index) => {
      const suitability = entry.suitability
        .map((s) => `${s.sector}: ${formatNumber(s.percent, 0)}%`)
        .join(', ');
      const mix = entry.sectorMix
        .map((s) => `${s.sector} ${formatNumber(s.funded, 0)}/${formatNumber(s.capacity, 0)}`)
        .join(', ');
      return `
        <div id="debugCanton-${entry.id}" class="debug-card debug-canton-card">
          <div id="debugCantonHeader-${entry.id}" class="debug-subheader">Canton ${startIndex + index + 1} of ${entries.length}</div>
          <div class="debug-grid-row"><span class="debug-label">Canton ID</span><span class="debug-value">${entry.id}</span></div>
          <div id="debugCantonUrban-${entry.id}" class="debug-grid-row"><span class="debug-label">Urbanization</span><span class="debug-value">${formatNumber(entry.urbanization, 0)} (Dev ${formatNumber(entry.development, 1)})</span></div>
          <div id="debugCantonHappiness-${entry.id}" class="debug-grid-row"><span class="debug-label">Happiness</span><span class="debug-value">${formatNumber(entry.happiness, 1)}</span></div>
          <div id="debugCantonLabor-${entry.id}" class="debug-grid-row"><span class="debug-label">Labor</span><span class="debug-value">Avail ${formatNumber(entry.laborAvailable, 1)} • Assigned ${formatNumber(entry.laborAssigned, 1)} • Demand ${formatNumber(entry.laborDemand, 1)}</span></div>
          <div id="debugCantonConsumption-${entry.id}" class="debug-grid-row"><span class="debug-label">Consumption</span><span class="debug-value">Food: ${entry.foodOk === null ? '—' : entry.foodOk ? 'OK' : 'Short'} • Luxury: ${entry.luxuryOk === null ? '—' : entry.luxuryOk ? 'OK' : 'Short'}</span></div>
          <div id="debugCantonSuitability-${entry.id}" class="debug-grid-row"><span class="debug-label">Suitability</span><span class="debug-value">${suitability || '—'}</span></div>
          <div id="debugCantonMix-${entry.id}" class="debug-grid-row"><span class="debug-label">Sector Mix</span><span class="debug-value">${mix || '—'}</span></div>
        </div>
      `;
    })
    .join('');
  const nationLabor = data.reconciliation.nationLabor;
  const cantonLabor = data.reconciliation.cantonLabor;
  return `
    <section id="debugSection-cantons" class="debug-section">
      <div id="debugSectionHeader-cantons" class="debug-section-header">Labor & Cantons</div>
      <div id="debugCantonsSummary" class="debug-grid-row">
        <span class="debug-label">Total Cantons</span>
        <span class="debug-value">${entries.length}</span>
      </div>
      <div class="debug-grid-row"><span class="debug-label">Nation Labor</span><span class="debug-value">Avail ${formatNumber(nationLabor.available, 1)} • Assigned ${formatNumber(nationLabor.assigned, 1)}</span></div>
      <div class="debug-grid-row"><span class="debug-label">Canton Labor</span><span class="debug-value">Avail ${formatNumber(cantonLabor.available, 1)} • Assigned ${formatNumber(cantonLabor.assigned, 1)} • Demand ${formatNumber(cantonLabor.demand, 1)}</span></div>
      <div id="debugCantonsContainer" class="debug-stack">${rows || '<div id="debugCantons-empty">No canton data</div>'}</div>
      <div id="debugCantonsPagination" class="debug-grid-row" style="justify-content:space-between;">
        <button id="debugCantonsPrev" ${page === 0 ? 'disabled' : ''}>Prev</button>
        <span id="debugCantonsPage">Page ${entries.length === 0 ? 0 : page + 1} / ${totalPages}</span>
        <button id="debugCantonsNext" ${page >= totalPages - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </section>
  `;
}

function renderProjectsSection(data: NationDebugSidebarData): string {
  const rows = data.projects
    .map(
      (project) => `
        <div id="debugProject-${project.id}" class="debug-grid-row">
          <span class="debug-label">${project.sector} (${project.tier})</span>
          <span class="debug-value">${project.turnsRemaining} turns${project.delayed ? ' • delayed' : ''}</span>
        </div>
      `,
    )
    .join('');
  return `
    <section id="debugSection-projects" class="debug-section">
      <div id="debugSectionHeader-projects" class="debug-section-header">Projects & Construction</div>
      <div class="debug-card">${rows || '<div id="debugProjects-empty">No active projects</div>'}</div>
    </section>
  `;
}

function renderResearchSection(data: NationDebugSidebarData): string {
  const policyRows = data.research.policies
    .map(
      (policy) => `
        <div id="debugPolicy-${policy.name.replace(/\s+/g, '')}" class="debug-grid-row">
          <span class="debug-label">${policy.name}</span>
          <span class="debug-value">${policy.value}</span>
        </div>
      `,
    )
    .join('');
  return `
    <section id="debugSection-research" class="debug-section">
      <div id="debugSectionHeader-research" class="debug-section-header">Research & Policy</div>
      <div class="debug-card">
        <div id="debugResearchRate" class="debug-grid-row">
          <span class="debug-label">Research / turn</span>
          <span class="debug-value">${formatNumber(data.research.perTurn, 1)}</span>
        </div>
        <div id="debugPolicies" class="debug-metric-grid">${policyRows || '<div id="debugPolicies-empty">No active policies tracked</div>'}</div>
      </div>
    </section>
  `;
}

function renderDiagnosticsSection(data: NationDebugSidebarData, seed: string | null): string {
  const rows = data.diagnostics
    .map(
      (entry) => `
        <div id="debugDiag-${entry.id}" class="debug-card">
          <div class="debug-grid-row">
            <span class="debug-label">${entry.label}</span>
            <span class="debug-value" style="color:${entry.passed ? '#8BC34A' : '#FF6B6B'};">${entry.passed ? 'Pass' : 'Fail'}</span>
          </div>
          ${entry.message ? `<div>${entry.message}</div>` : ''}
        </div>
      `,
    )
    .join('');
  return `
    <section id="debugSection-diagnostics" class="debug-section">
      <div id="debugSectionHeader-diagnostics" class="debug-section-header">Diagnostics</div>
      <div id="debugDiagContainer" class="debug-stack">${rows || '<div id="debugDiag-empty">No assertions evaluated</div>'}</div>
      <div id="debugSeed" class="debug-grid-row"><span class="debug-label">Seed</span><span class="debug-value">${seed ?? '—'}</span></div>
      <div id="debugExportButtons" class="debug-grid-row" style="justify-content:flex-start; gap:8px;">
        <button id="debugExportJson">Export JSON</button>
        <button id="debugExportCsv">Export CSV</button>
      </div>
    </section>
  `;
}

function renderSidebar(data: DebugSidebarData): void {
  if (!contentEl) return;
  latestData = data;
  const nationId = resolveActiveNationId(data);
  activeNationId = nationId;
  const selector = renderNationSelector(data, nationId);
  const nationData = nationId ? data.nations[nationId] ?? null : null;
  if (!nationData) {
    contentEl.innerHTML = `${selector}<div id="debugNoNation">No nation data available</div>`;
    attachNationSelectorHandler();
    attachExportHandlers();
    return;
  }
  const sections = [
    selector,
    renderOverviewSection(nationData),
    renderFinanceSection(nationData),
    renderSectorsSection(nationData),
    renderEnergySection(nationData),
    renderTradeSection(nationData),
    renderCantonsSection(nationId, nationData),
    renderProjectsSection(nationData),
    renderResearchSection(nationData),
    renderDiagnosticsSection(nationData, data.seed),
  ].join('');
  contentEl.innerHTML = sections;
  attachNationSelectorHandler();
  attachPaginationHandlers(nationId);
  attachExportHandlers();
}

function renderNationSelector(data: DebugSidebarData, nationId: string | null): string {
  const active = nationId && data.nations[nationId] ? data.nations[nationId] : null;
  const hasMultiple = data.nationOrder.filter((id) => data.nations[id]).length > 1;
  if (!hasMultiple) {
    const label = active ? escapeHtml(active.label) : '—';
    return `
      <section id="debugSection-nation" class="debug-section">
        <div class="debug-section-header">Nation</div>
        <div class="debug-value">${label}</div>
      </section>
    `;
  }
  const options = data.nationOrder
    .filter((id) => data.nations[id])
    .map((id) => {
      const entry = data.nations[id]!;
      const selected = id === nationId ? 'selected' : '';
      return `<option value="${id}" ${selected}>${escapeHtml(entry.label)}</option>`;
    })
    .join('');
  return `
    <section id="debugSection-nation" class="debug-section">
      <div class="debug-section-header">Nation</div>
      <label for="debugNationSelect" class="debug-label">Active Nation</label>
      <select id="debugNationSelect">${options}</select>
    </section>
  `;
}

function attachNationSelectorHandler(): void {
  const select = document.getElementById('debugNationSelect') as HTMLSelectElement | null;
  if (!select) return;
  select.addEventListener('change', () => {
    activeNationId = select.value || null;
    if (activeNationId) {
      setCantonPage(activeNationId, 0);
    }
    if (latestData) {
      renderSidebar(latestData);
    }
  });
}

function attachPaginationHandlers(nationId: string | null): void {
  const prev = document.getElementById('debugCantonsPrev') as HTMLButtonElement | null;
  const next = document.getElementById('debugCantonsNext') as HTMLButtonElement | null;
  if (prev) {
    prev.addEventListener('click', () => {
      if (!latestData || !nationId) return;
      const page = getCantonPage(nationId);
      if (page > 0) {
        setCantonPage(nationId, page - 1);
        renderSidebar(latestData);
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (!latestData || !nationId) return;
      const nationData = latestData.nations[nationId];
      if (!nationData) return;
      const totalPages = Math.max(1, Math.ceil(nationData.cantons.length / CANTON_PAGE_SIZE));
      const page = getCantonPage(nationId);
      if (page < totalPages - 1) {
        setCantonPage(nationId, page + 1);
        renderSidebar(latestData);
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
      const payload = buildJsonExportPayload(latestData);
      const blob = new Blob([payload], { type: 'application/json' });
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
      const csv = buildCsvExport(latestData);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'debug-sidebar.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }
}

function escapeCsv(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function buildJsonExportPayload(data: DebugSidebarData): string {
  return JSON.stringify(data, null, 2);
}

export function buildCsvExport(data: DebugSidebarData): string {
  const rows: string[] = ['Nation,Section,Name,Metric,Value'];
  for (const nationId of data.nationOrder) {
    const nation = data.nations[nationId];
    if (!nation) continue;
    const label = nation.label;
    rows.push(
      [escapeCsv(label), 'Overview', 'Gold', 'Numeric', escapeCsv(nation.gold.numeric)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Overview', 'Gold', 'Formatted', escapeCsv(nation.gold.formatted)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Labor', 'Nation', 'Available', escapeCsv(nation.reconciliation.nationLabor.available)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Labor', 'Nation', 'Assigned', escapeCsv(nation.reconciliation.nationLabor.assigned)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Labor', 'Canton', 'Available', escapeCsv(nation.reconciliation.cantonLabor.available)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Labor', 'Canton', 'Assigned', escapeCsv(nation.reconciliation.cantonLabor.assigned)].join(','),
    );
    rows.push(
      [escapeCsv(label), 'Labor', 'Canton', 'Demand', escapeCsv(nation.reconciliation.cantonLabor.demand)].join(','),
    );
    for (const sector of SECTORS) {
      const title = SECTOR_TITLES[sector];
      const nationTotals = nation.reconciliation.nationSectors[sector] ?? {
        capacity: 0,
        funded: 0,
        utilization: 0,
        idle: 0,
      };
      const cantonTotals = nation.reconciliation.cantonSectors[sector] ?? {
        capacity: 0,
        funded: 0,
        utilization: 0,
        idle: 0,
      };
      rows.push(
        [escapeCsv(label), 'Sector', escapeCsv(title), 'NationCapacity', escapeCsv(nationTotals.capacity)].join(','),
      );
      rows.push(
        [escapeCsv(label), 'Sector', escapeCsv(title), 'CantonCapacity', escapeCsv(cantonTotals.capacity)].join(','),
      );
      rows.push(
        [escapeCsv(label), 'Sector', escapeCsv(title), 'NationFunded', escapeCsv(nationTotals.funded)].join(','),
      );
      rows.push(
        [escapeCsv(label), 'Sector', escapeCsv(title), 'CantonFunded', escapeCsv(cantonTotals.funded)].join(','),
      );
    }
    for (const canton of nation.cantons) {
      rows.push(
        [escapeCsv(label), 'Canton', escapeCsv(canton.id), 'LaborAvailable', escapeCsv(canton.laborAvailable)].join(','),
      );
      rows.push(
        [escapeCsv(label), 'Canton', escapeCsv(canton.id), 'LaborAssigned', escapeCsv(canton.laborAssigned)].join(','),
      );
      rows.push(
        [escapeCsv(label), 'Canton', escapeCsv(canton.id), 'LaborDemand', escapeCsv(canton.laborDemand)].join(','),
      );
    }
  }
  return rows.join('\n');
}

export function __resetDebugSidebarStateForTest(): void {
  previousHappiness.clear();
  cantonPageByNation.clear();
  activeNationId = null;
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

