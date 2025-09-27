import { SERVER_BASE_URL } from './config';
import { deserializeTypedArrays } from './mesh';
import { showGameNotification } from './notifications';
import { updateStatusBarFromGameState } from './statusBar';

type PlannerContext = () => {
  gameId: string | null;
  playerId: string | null;
  isMyTurn: boolean;
};

type SectorKey =
  | 'agriculture'
  | 'extraction'
  | 'manufacturing'
  | 'defense'
  | 'luxury'
  | 'finance'
  | 'research'
  | 'logistics';

interface SectorStats {
  capacity: number;
  perSlotCost: number;
  ceiling: number;
  fundingGold: number;
  attemptedSlots: number;
  runningSlots: number;
  utilization: number;
  idleCost: number;
  outputs: Record<string, number>;
}

interface WelfareCosts {
  education: number;
  healthcare: number;
  total: number;
}

interface PlannerState {
  initialized: boolean;
  loading: boolean;
  mode: 'custom' | 'pro-rata';
  sectorOrder: SectorKey[];
  sectorAllocations: Record<SectorKey, number>;
  totalOmBudget: number;
  militaryAllocation: number;
  welfareBudget: number;
  welfareAvailable: number;
  educationTier: number;
  healthcareTier: number;
  educationMin: number;
  educationMax: number;
  healthcareMin: number;
  healthcareMax: number;
  educationCost: number;
  healthcareCost: number;
  affordableEducation: number;
  affordableHealthcare: number;
  militaryUpkeep: number;
  totalLabor: number;
  availableGold: number;
  lastRoundSpend: number;
  idleTax: number;
  energySpend: number;
  miscSpend: number;
  treasury: number;
  debt: number;
  projectedSpend: number;
  warnings: string[];
  planSubmittedBy: string | null;
  basePlan: SerializedPlan | null;
  snapshot: any;
  economy: any;
  nation: any;
}

interface SerializedPlan {
  mode: 'custom' | 'pro-rata';
  sectorOrder: SectorKey[];
  sectorAllocations: Record<SectorKey, number>;
  militaryAllocation: number;
  educationTier: number;
  healthcareTier: number;
}

interface PlannerElements {
  container: HTMLElement;
  details: HTMLDetailsElement;
  status: HTMLElement;
  militaryInput: HTMLInputElement;
  upkeepSpan: HTMLElement;
  gapSpan: HTMLElement;
  remainderSpan: HTMLElement;
  educationSlider: HTMLInputElement;
  healthcareSlider: HTMLInputElement;
  educationTierValue: HTMLElement;
  healthcareTierValue: HTMLElement;
  educationCost: HTMLElement;
  healthcareCost: HTMLElement;
  welfareDownshift: HTMLElement;
  allocationModeCustom: HTMLInputElement;
  allocationModeProrata: HTMLInputElement;
  totalOmValue: HTMLElement;
  sectorContainer: HTMLElement;
  warningsList: HTMLElement;
  idleTaxLine: HTMLElement;
  energyLine: HTMLElement;
  miscLine: HTMLElement;
  lastRoundLine: HTMLElement;
  projectedLine: HTMLElement;
  treasuryLine: HTMLElement;
  debtLine: HTMLElement;
  saveButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
}

const SECTORS: SectorKey[] = [
  'agriculture',
  'extraction',
  'manufacturing',
  'defense',
  'luxury',
  'finance',
  'research',
  'logistics',
];

const SECTOR_TITLES: Record<SectorKey, string> = {
  agriculture: 'Agriculture',
  extraction: 'Extraction',
  manufacturing: 'Manufacturing',
  defense: 'Defense',
  luxury: 'Luxury',
  finance: 'Finance',
  research: 'Research',
  logistics: 'Logistics',
};

const OM_COST_PER_SLOT: Record<SectorKey, number> = {
  agriculture: 6,
  extraction: 8,
  manufacturing: 10,
  defense: 12,
  luxury: 9,
  finance: 7,
  research: 11,
  logistics: 5,
};
const IDLE_TAX_RATE = 0.25;

export const EDUCATION_TIERS = [0, 0.25, 0.5, 0.75, 1];
export const HEALTHCARE_TIERS = [0, 0.25, 0.5, 0.75, 1];

const SECTOR_OUTPUTS: Record<SectorKey, Record<string, number>> = {
  agriculture: { food: 1 },
  extraction: { materials: 1 },
  manufacturing: { production: 1 },
  defense: { ordnance: 1 },
  luxury: { luxury: 1 },
  finance: { gold: 1 },
  research: { research: 1 },
  logistics: { logistics: 1 },
};

let contextProvider: PlannerContext | null = null;
let elements: PlannerElements | null = null;

const state: PlannerState = {
  initialized: false,
  loading: false,
  mode: 'custom',
  sectorOrder: [...SECTORS],
  sectorAllocations: Object.fromEntries(SECTORS.map((s) => [s, 0])) as Record<SectorKey, number>,
  totalOmBudget: 0,
  militaryAllocation: 0,
  welfareBudget: 0,
  welfareAvailable: 0,
  educationTier: 0,
  healthcareTier: 0,
  educationMin: 0,
  educationMax: 4,
  healthcareMin: 0,
  healthcareMax: 4,
  educationCost: 0,
  healthcareCost: 0,
  affordableEducation: 0,
  affordableHealthcare: 0,
  militaryUpkeep: 0,
  totalLabor: 0,
  availableGold: 0,
  lastRoundSpend: 0,
  idleTax: 0,
  energySpend: 0,
  miscSpend: 0,
  treasury: 0,
  debt: 0,
  projectedSpend: 0,
  warnings: [],
  planSubmittedBy: null,
  basePlan: null,
  snapshot: null,
  economy: null,
  nation: null,
};

function formatGold(value: number, includeUnit = true): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const formatted = rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return includeUnit ? `${formatted} g` : formatted;
}

function getContext() {
  return contextProvider ? contextProvider() : { gameId: null, playerId: null, isMyTurn: false };
}

function calculateTotalLabor(economy: any): number {
  if (!economy || !economy.cantons) return 0;
  let total = 0;
  for (const canton of Object.values(economy.cantons) as any[]) {
    if (!canton || !canton.labor) continue;
    total += (canton.labor.general || 0) + (canton.labor.skilled || 0) + (canton.labor.specialist || 0);
  }
  return total;
}

export function calculateWelfareCost(totalLabor: number, educationTier: number, healthcareTier: number): WelfareCosts {
  const educationCost = totalLabor * (EDUCATION_TIERS[educationTier] || 0);
  const healthcareCost = totalLabor * (HEALTHCARE_TIERS[healthcareTier] || 0);
  return {
    education: educationCost,
    healthcare: healthcareCost,
    total: educationCost + healthcareCost,
  };
}

export function evaluatePlannerWarnings(options: {
  projectedSpend: number;
  availableGold: number;
  militaryAllocation: number;
  militaryUpkeep: number;
  welfareCost: number;
  welfareAvailable: number;
}): string[] {
  const warnings: string[] = [];

  if (options.projectedSpend > options.availableGold) {
    warnings.push('Total planned spending exceeds treasury.');
  }
  if (options.militaryAllocation < options.militaryUpkeep) {
    warnings.push('Military funding is below upkeep and units may degrade.');
  }
  if (options.welfareAvailable < options.welfareCost) {
    warnings.push('Welfare budget cannot sustain selected tiers; automatic downshift expected.');
  }

  return warnings;
}

export function predictAffordableWelfare(
  budget: number,
  totalLabor: number,
  educationTier: number,
  healthcareTier: number,
): { education: number; healthcare: number } {
  let edu = educationTier;
  let health = healthcareTier;
  if (totalLabor <= 0) {
    return { education: edu, healthcare: health };
  }
  const cost = (tier: number, arr: number[]) => totalLabor * (arr[tier] || 0);
  const totalCost = () => cost(edu, EDUCATION_TIERS) + cost(health, HEALTHCARE_TIERS);
  while (totalCost() > budget && (edu > 0 || health > 0)) {
    const eduDrop = edu > 0 ? cost(edu, EDUCATION_TIERS) - cost(edu - 1, EDUCATION_TIERS) : 0;
    const healthDrop = health > 0 ? cost(health, HEALTHCARE_TIERS) - cost(health - 1, HEALTHCARE_TIERS) : 0;
    if (eduDrop >= healthDrop && edu > 0) {
      edu -= 1;
    } else if (health > 0) {
      health -= 1;
    } else {
      break;
    }
  }
  return { education: edu, healthcare: health };
}

function estimateMilitaryUpkeep(snapshot: any): number {
  if (!snapshot || !snapshot.entities) return 0;
  let total = 0;
  for (const entity of Object.values(snapshot.entities) as any[]) {
    if (entity && entity.type === 'unit') {
      const upkeep = typeof entity.data?.upkeep === 'number' ? entity.data.upkeep : 0;
      total += upkeep;
    }
  }
  return total;
}

function gateInstrumentationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('plannerGateDebug') === '1';
  } catch {
    return false;
  }
}

function aggregateSectorStats(
  nation: any,
  economy: any,
  allocations: Record<SectorKey, number>,
): Record<SectorKey, SectorStats> {
  const empty: SectorStats = {
    capacity: 0,
    perSlotCost: 0,
    ceiling: 0,
    fundingGold: 0,
    attemptedSlots: 0,
    runningSlots: 0,
    utilization: 0,
    idleCost: 0,
    outputs: {},
  };

  const stats: Record<SectorKey, SectorStats> = Object.fromEntries(
    SECTORS.map((sector) => [sector, { ...empty }]),
  ) as Record<SectorKey, SectorStats>;

  if (!nation || !economy) {
    return stats;
  }

  const cantonId = nation.canton;
  const canton = cantonId ? economy.cantons?.[cantonId] : null;

  for (const sectorKey of SECTORS) {
    const costPer = OM_COST_PER_SLOT[sectorKey];
    const stat = stats[sectorKey];
    const cantonSector = canton?.sectors?.[sectorKey];
    const capacity = cantonSector?.capacity ?? 0;
    const planFunding = allocations[sectorKey] ?? 0;
    const attempted = capacity > 0 && costPer > 0 ? Math.min(capacity, Math.floor(planFunding / costPer)) : 0;
    const runningFromNation = cantonSector?.utilization ?? cantonSector?.funded ?? 0;
    const runningSlots = Math.min(attempted, runningFromNation, capacity);
    const utilization = capacity > 0 ? Math.round((runningSlots / capacity) * 100) : 0;
    const idleSlots = Math.max(0, capacity - runningSlots);
    const outputs: Record<string, number> = {};
    const perSlotOutputs = SECTOR_OUTPUTS[sectorKey];
    for (const [resource, amount] of Object.entries(perSlotOutputs)) {
      outputs[resource] = runningSlots * amount;
    }

    const sectorSnapshot: SectorStats = {
      capacity,
      perSlotCost: costPer,
      ceiling: capacity * costPer,
      fundingGold: planFunding,
      attemptedSlots: attempted,
      runningSlots,
      utilization,
      idleCost: idleSlots * costPer * IDLE_TAX_RATE,
      outputs,
    };

    if (gateInstrumentationEnabled()) {
      console.groupCollapsed(`Planner gate trace – ${sectorKey}`);
      console.log('Capacity', capacity, 'perSlotCost', costPer, 'ceiling', sectorSnapshot.ceiling);
      console.log('Funding (g)', planFunding, 'attempted slots', attempted);
      console.log('Running (nation snapshot)', runningFromNation);
      console.log('Idle slots', idleSlots, 'Idle tax', sectorSnapshot.idleCost);
      console.log('Outputs', sectorSnapshot.outputs);
      console.groupEnd();
    }

    stats[sectorKey] = sectorSnapshot;
  }

  return stats;
}

function computeIdleTaxFromStats(stats: Record<SectorKey, SectorStats>): number {
  return SECTORS.reduce((sum, sector) => sum + stats[sector].idleCost, 0);
}

function computeIdleTax(economy: any, nation: any = state.nation): number {
  if (!economy || !nation?.canton) return 0;
  const canton = economy.cantons?.[nation.canton];
  if (!canton?.sectors) return 0;

  return SECTORS.reduce((sum, sector) => {
    const sectorState = canton.sectors?.[sector];
    if (!sectorState) return sum;

    const capacity = typeof sectorState.capacity === 'number' ? sectorState.capacity : 0;
    const running =
      typeof sectorState.utilization === 'number'
        ? sectorState.utilization
        : typeof sectorState.funded === 'number'
        ? sectorState.funded
        : 0;

    if (capacity <= 0) return sum;

    const idleSlots = Math.max(0, capacity - running);
    if (idleSlots <= 0) return sum;

    const costPer = OM_COST_PER_SLOT[sector];
    if (costPer <= 0) return sum;

    return sum + idleSlots * costPer * IDLE_TAX_RATE;
  }, 0);
}

function computeSectorOutputs(stats: SectorStats): string {
  const parts: string[] = [];
  for (const [resource, amount] of Object.entries(stats.outputs)) {
    if (amount > 0) {
      parts.push(`${resource}: ${amount.toFixed(0)}`);
    }
  }
  return parts.join(', ') || '—';
}

function buildPlanPayload() {
  const { gameId, playerId } = getContext();
  if (!gameId || !playerId) return null;

  const slotPriorities: Record<string, number> = {};
  state.sectorOrder.forEach((sector, index) => {
    slotPriorities[sector] = index;
  });

  const plan = {
    budgets: {
      military: state.militaryAllocation,
      welfare: state.welfareBudget,
      sectorOM: { ...state.sectorAllocations },
    },
    policies: {
      welfare: {
        education: state.educationTier,
        healthcare: state.healthcareTier,
        socialSupport: 0,
      },
    },
    slotPriorities,
    allocationMode: state.mode,
    sectorPriority: [...state.sectorOrder],
  };

  return { playerId, plan };
}

export function createPlanPayloadForTest(stateLike: Partial<PlannerState>) {
  const priorities: Record<string, number> = {};
  (stateLike.sectorOrder || []).forEach((sector: any, idx: number) => {
    priorities[sector] = idx;
  });
  return {
    budgets: {
      military: stateLike.militaryAllocation ?? 0,
      welfare: stateLike.welfareBudget ?? 0,
      sectorOM: stateLike.sectorAllocations ?? {},
    },
    policies: {
      welfare: {
        education: stateLike.educationTier ?? 0,
        healthcare: stateLike.healthcareTier ?? 0,
        socialSupport: 0,
      },
    },
    slotPriorities: priorities,
    allocationMode: stateLike.mode ?? 'custom',
    sectorPriority: stateLike.sectorOrder ?? [],
  };
}

function applyBasePlan(plan: SerializedPlan) {
  state.mode = plan.mode;
  state.sectorOrder = [...plan.sectorOrder];
  state.sectorAllocations = { ...plan.sectorAllocations } as Record<SectorKey, number>;
  state.militaryAllocation = plan.militaryAllocation;
  state.educationTier = plan.educationTier;
  state.healthcareTier = plan.healthcareTier;
  state.totalOmBudget = Object.values(state.sectorAllocations).reduce((sum, value) => sum + value, 0);
}

function refreshTotals() {
  state.totalOmBudget = Object.values(state.sectorAllocations).reduce((sum, v) => sum + v, 0);
  const stats = aggregateSectorStats(state.nation, state.snapshot?.economy, state.sectorAllocations);
  state.idleTax = computeIdleTaxFromStats(stats);
  const runningCost = SECTORS.reduce(
    (sum, sector) => sum + stats[sector].runningSlots * stats[sector].perSlotCost,
    0,
  );
  const plannedInterest = state.nation?.finance?.waterfall?.interest ?? 0;
  const plannedProjects = state.nation?.finance?.waterfall?.projects ?? 0;
  state.energySpend = Math.max(0, (state.nation?.omCost ?? runningCost + state.idleTax) - runningCost - state.idleTax);
  const welfareCosts = calculateWelfareCost(state.totalLabor, state.educationTier, state.healthcareTier);
  state.educationCost = welfareCosts.education;
  state.healthcareCost = welfareCosts.healthcare;
  state.welfareBudget = state.educationCost + state.healthcareCost;
  state.welfareAvailable = Math.max(0, state.availableGold - state.militaryAllocation - state.totalOmBudget);
  state.projectedSpend =
    state.militaryAllocation +
    state.welfareBudget +
    state.totalOmBudget +
    state.idleTax +
    state.energySpend +
    state.miscSpend +
    plannedInterest +
    plannedProjects;
  const affordable = predictAffordableWelfare(
    state.welfareAvailable,
    state.totalLabor,
    state.educationTier,
    state.healthcareTier,
  );
  state.affordableEducation = affordable.education;
  state.affordableHealthcare = affordable.healthcare;
  state.warnings = evaluatePlannerWarnings({
    projectedSpend: state.projectedSpend,
    availableGold: state.availableGold,
    militaryAllocation: state.militaryAllocation,
    militaryUpkeep: state.militaryUpkeep,
    welfareCost: state.welfareBudget,
    welfareAvailable: state.welfareAvailable,
  });
}

function renderSectorCards() {
  if (!elements) return;
  const stats = aggregateSectorStats(state.nation, state.snapshot?.economy, state.sectorAllocations);
  elements.sectorContainer.innerHTML = '';

  state.sectorOrder.forEach((sector) => {
    const card = document.createElement('div');
    const isCustom = state.mode === 'custom';
    card.className = 'planner-sector-card';
    card.draggable = isCustom;
    card.dataset.sector = sector;
    card.setAttribute('aria-disabled', String(!isCustom));
    card.id = `plannerSectorCard-${sector}`;
    card.style.cssText = `
      display: grid;
      grid-template-columns: 1.2fr 0.8fr 0.8fr 1fr 1fr;
      gap: 8px;
      padding: 8px;
      border: ${isCustom ? '1px solid rgba(76, 175, 80, 0.35)' : '1px dashed rgba(255,255,255,0.25)'};
      border-radius: 6px;
      margin-bottom: 6px;
      background: ${isCustom ? 'rgba(76, 175, 80, 0.09)' : 'rgba(255,255,255,0.03)'};
      align-items: center;
      cursor: ${isCustom ? 'grab' : 'not-allowed'};
      opacity: ${isCustom ? '1' : '0.75'};
      transition: background 0.2s ease, border 0.2s ease, opacity 0.2s ease;
    `;

    const sectorStats = stats[sector];
    const utilization = sectorStats.utilization;

    const nameCell = document.createElement('div');
    nameCell.id = `plannerSectorName-${sector}`;
    nameCell.style.fontWeight = '600';
    nameCell.style.color = '#fff';
    nameCell.textContent = SECTOR_TITLES[sector];

    const ceilingCell = document.createElement('div');
    ceilingCell.id = `plannerSectorCeiling-${sector}`;
    ceilingCell.style.color = '#bbb';
    ceilingCell.textContent = formatGold(sectorStats.ceiling);

    const utilizationCell = document.createElement('div');
    utilizationCell.id = `plannerSectorUtilization-${sector}`;
    utilizationCell.style.color = '#bbb';
    utilizationCell.textContent = `${utilization}%`;

    const outputCell = document.createElement('div');
    outputCell.id = `plannerSectorOutput-${sector}`;
    outputCell.style.color = '#bbb';
    outputCell.textContent = computeSectorOutputs(sectorStats);

    const fundingInput = document.createElement('input');
    fundingInput.type = 'number';
    fundingInput.min = '0';
    fundingInput.step = '1';
    fundingInput.value = String(state.sectorAllocations[sector] ?? 0);
    fundingInput.disabled = !isCustom;
    fundingInput.id = `plannerSectorFundingInput-${sector}`;
    fundingInput.style.cssText = `
      width: 100%;
      padding: 4px;
      background: ${isCustom ? '#222' : '#151515'};
      color: #fff;
      border: 1px solid ${isCustom ? '#444' : '#333'};
      border-radius: 4px;
      cursor: ${isCustom ? 'text' : 'not-allowed'};
    `;
    fundingInput.addEventListener('input', () => {
      const value = Math.max(0, Number(fundingInput.value) || 0);
      state.sectorAllocations[sector] = value;
      refreshTotals();
      renderPlanner();
    });

    card.appendChild(nameCell);
    card.appendChild(ceilingCell);
    card.appendChild(utilizationCell);
    card.appendChild(outputCell);

    const fundingCell = document.createElement('div');
    fundingCell.id = `plannerSectorFunding-${sector}`;
    fundingCell.appendChild(fundingInput);
    card.appendChild(fundingCell);

    if (state.mode === 'custom') {
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', sector);
      });
      card.addEventListener('dragover', (event) => {
        event.preventDefault();
      });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        const fromSector = event.dataTransfer?.getData('text/plain') as SectorKey | undefined;
        if (!fromSector || fromSector === sector) return;
        const fromIndex = state.sectorOrder.indexOf(fromSector);
        const toIndex = state.sectorOrder.indexOf(sector);
        if (fromIndex >= 0 && toIndex >= 0) {
          state.sectorOrder.splice(fromIndex, 1);
          state.sectorOrder.splice(toIndex, 0, fromSector);
          renderPlanner();
        }
      });
    }

    elements.sectorContainer.appendChild(card);
  });
}

function renderWarnings() {
  if (!elements) return;
  elements.warningsList.innerHTML = '';
  if (state.warnings.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'plannerWarningsEmpty';
    empty.style.color = '#8BC34A';
    empty.textContent = 'All budgets within limits.';
    elements.warningsList.appendChild(empty);
    return;
  }
  state.warnings.forEach((warning, index) => {
    const item = document.createElement('div');
    item.id = `plannerWarning-${index}`;
    item.textContent = warning;
    item.style.color = '#FFC107';
    item.style.marginBottom = '4px';
    elements.warningsList.appendChild(item);
  });
}

function renderPlanner() {
  if (!elements) return;

  elements.militaryInput.value = String(state.militaryAllocation);
  elements.upkeepSpan.textContent = formatGold(state.militaryUpkeep);
  const gap = Math.max(0, state.militaryUpkeep - state.militaryAllocation);
  elements.gapSpan.textContent = gap > 0 ? formatGold(gap) : 'None';
  const remainder = Math.max(0, state.militaryAllocation - state.militaryUpkeep);
  elements.remainderSpan.textContent = remainder > 0 ? formatGold(remainder) : 'None';

  elements.educationSlider.value = String(state.educationTier);
  elements.healthcareSlider.value = String(state.healthcareTier);
  elements.educationSlider.min = '0';
  elements.educationSlider.max = '4';
  elements.educationSlider.step = '1';
  elements.educationSlider.setAttribute('data-allowed-min', String(state.educationMin));
  elements.educationSlider.setAttribute('data-allowed-max', String(state.educationMax));
  elements.educationSlider.title = `Allowed tiers this turn: ${state.educationMin} – ${state.educationMax}`;
  elements.healthcareSlider.min = '0';
  elements.healthcareSlider.max = '4';
  elements.healthcareSlider.step = '1';
  elements.healthcareSlider.setAttribute('data-allowed-min', String(state.healthcareMin));
  elements.healthcareSlider.setAttribute('data-allowed-max', String(state.healthcareMax));
  elements.healthcareSlider.title = `Allowed tiers this turn: ${state.healthcareMin} – ${state.healthcareMax}`;
  elements.educationTierValue.textContent = `Tier ${state.educationTier}`;
  elements.educationTierValue.title = `Allowed this turn: ${state.educationMin} – ${state.educationMax}`;
  elements.healthcareTierValue.textContent = `Tier ${state.healthcareTier}`;
  elements.healthcareTierValue.title = `Allowed this turn: ${state.healthcareMin} – ${state.healthcareMax}`;
  elements.educationCost.textContent = formatGold(state.educationCost);
  elements.healthcareCost.textContent = formatGold(state.healthcareCost);

  if (state.welfareAvailable + 0.001 < state.welfareBudget) {
    const shortfall = Math.max(0, state.welfareBudget - state.welfareAvailable);
    elements.welfareDownshift.textContent = `Funding shortfall of ${formatGold(shortfall)}; available gold supports up to Education Tier ${state.affordableEducation} and Healthcare Tier ${state.affordableHealthcare}.`;
    elements.welfareDownshift.style.display = 'block';
  } else {
    elements.welfareDownshift.style.display = 'none';
  }

  elements.allocationModeCustom.checked = state.mode === 'custom';
  elements.allocationModeProrata.checked = state.mode === 'pro-rata';
  elements.totalOmValue.textContent = formatGold(state.totalOmBudget);

  renderSectorCards();
  renderWarnings();

  elements.idleTaxLine.textContent = formatGold(state.idleTax);
  elements.energyLine.textContent = formatGold(state.energySpend);
  elements.miscLine.textContent = formatGold(state.miscSpend);
  elements.lastRoundLine.textContent = formatGold(state.lastRoundSpend);
  elements.projectedLine.textContent = formatGold(state.projectedSpend);
  elements.projectedLine.style.color = state.projectedSpend > state.lastRoundSpend ? '#FF8A80' : '#8BC34A';
  elements.treasuryLine.textContent = formatGold(state.treasury);
  if (state.treasury < 0) {
    elements.treasuryLine.style.color = '#FF5252';
  } else if (state.treasury <= state.nation?.finance?.waterfall?.operations * 0.1) {
    elements.treasuryLine.style.color = '#FFC107';
  } else {
    elements.treasuryLine.style.color = '#8BC34A';
  }
  elements.debtLine.textContent = formatGold(state.debt);

  const { playerId, isMyTurn } = getContext();
  const canSubmit = Boolean(
    playerId &&
    isMyTurn &&
    !state.loading &&
    state.warnings.length === 0 &&
    state.planSubmittedBy === null,
  );
  elements.saveButton.disabled = !canSubmit;
  elements.cancelButton.disabled = state.loading;

  if (state.planSubmittedBy && state.planSubmittedBy !== playerId) {
    elements.status.textContent = `Plan already submitted this turn by ${state.planSubmittedBy}.`;
    elements.status.style.color = '#FFC107';
  } else if (!isMyTurn) {
    elements.status.textContent = 'Waiting for your turn to submit a plan.';
    elements.status.style.color = '#FFC107';
  } else if (state.warnings.length > 0) {
    elements.status.textContent = 'Resolve warnings before submitting the plan.';
    elements.status.style.color = '#FFC107';
  } else {
    elements.status.textContent = 'Configure next turn budgets and save to queue the plan.';
    elements.status.style.color = '#8BC34A';
  }
}

async function fetchPlannerData() {
  const { gameId } = getContext();
  if (!gameId || !elements) return;
  state.loading = true;
  elements.status.textContent = 'Loading planner data...';
  elements.status.style.color = '#FFF';
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/games/${gameId}/state`);
    if (!response.ok) {
      throw new Error(`Failed to load planner data (${response.status})`);
    }
    const json = await response.json();
    const fullState = deserializeTypedArrays(json);
    state.snapshot = fullState;
    const { playerId } = getContext();
    state.nation = playerId ? fullState.nations?.[playerId] ?? null : null;
    updateStatusBarFromGameState(fullState, playerId);
    state.economy = fullState.economy;
    state.availableGold = state.nation?.finance?.treasury ?? fullState.economy?.resources?.gold ?? 0;
    state.lastRoundSpend = state.nation?.finance?.waterfall?.operations
      ? state.nation.finance.waterfall.operations +
        state.nation.finance.waterfall.welfare +
        state.nation.finance.waterfall.military +
        state.nation.finance.waterfall.projects +
        state.nation.finance.waterfall.interest
      : fullState.economy?.finance?.summary?.expenditures ?? 0;
    state.miscSpend = 0;
    state.treasury = state.nation?.finance?.treasury ?? fullState.economy?.resources?.gold ?? 0;
    state.debt = state.nation?.finance?.debt ?? fullState.economy?.finance?.debt ?? 0;
    state.planSubmittedBy = fullState.planSubmittedBy ?? null;
    state.totalLabor = calculateTotalLabor(fullState.economy);
    state.militaryUpkeep = estimateMilitaryUpkeep(fullState);

    const nextPlan = fullState.nextPlan || {};
    const budgets = nextPlan.budgets || {};
    const sectorBudget = budgets.sectorOM || {};
    state.sectorAllocations = {
      ...Object.fromEntries(SECTORS.map((s) => [s, 0])),
      ...sectorBudget,
    } as Record<SectorKey, number>;
    state.militaryAllocation = budgets.military || 0;
    state.mode = (nextPlan.allocationMode === 'pro-rata' ? 'pro-rata' : 'custom');
    state.sectorOrder = Array.isArray(nextPlan.sectorPriority) && nextPlan.sectorPriority.length > 0
      ? nextPlan.sectorPriority.filter((s: any): s is SectorKey => SECTORS.includes(s))
      : [...SECTORS];

    const welfarePolicies = nextPlan.policies?.welfare || fullState.economy?.welfare?.next || fullState.economy?.welfare?.current || { education: 0, healthcare: 0 };
    const currentWelfare = fullState.economy?.welfare?.current || { education: 0, healthcare: 0 };
    state.educationTier = welfarePolicies.education ?? 0;
    state.healthcareTier = welfarePolicies.healthcare ?? 0;
    state.educationMin = Math.max(0, (currentWelfare.education ?? 0) - 1);
    state.educationMax = Math.min(4, (currentWelfare.education ?? 0) + 1);
    state.healthcareMin = Math.max(0, (currentWelfare.healthcare ?? 0) - 1);
    state.healthcareMax = Math.min(4, (currentWelfare.healthcare ?? 0) + 1);

    const sectorStats = aggregateSectorStats(state.nation, fullState.economy, state.sectorAllocations);
    state.idleTax = computeIdleTaxFromStats(sectorStats);
    const runningCost = SECTORS.reduce(
      (sum, sector) => sum + sectorStats[sector].runningSlots * sectorStats[sector].perSlotCost,
      0,
    );
    state.energySpend = Math.max(0, (state.nation?.omCost ?? 0) - runningCost - state.idleTax);

    refreshTotals();
    state.basePlan = {
      mode: state.mode,
      sectorOrder: [...state.sectorOrder],
      sectorAllocations: { ...state.sectorAllocations },
      militaryAllocation: state.militaryAllocation,
      educationTier: state.educationTier,
      healthcareTier: state.healthcareTier,
    };
    renderPlanner();
  } catch (error: any) {
    console.error('Failed to load planner data', error);
    elements.status.textContent = 'Failed to load planner data. Please try again later.';
    elements.status.style.color = '#F44336';
  } finally {
    state.loading = false;
  }
}

async function submitPlan() {
  const { gameId } = getContext();
  if (!gameId) return;
  const payload = buildPlanPayload();
  if (!payload) return;
  try {
    state.loading = true;
    renderPlanner();
    const response = await fetch(`${SERVER_BASE_URL}/api/games/${gameId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to submit plan (${response.status})`);
    }
    showGameNotification('Plan submitted. It will execute next turn.', 'success');
    state.planSubmittedBy = payload.playerId;
    if (state.basePlan) {
      applyBasePlan(state.basePlan);
      refreshTotals();
    }
  } catch (error: any) {
    console.error('Plan submission error', error);
    showGameNotification(error.message || 'Failed to submit plan', 'error');
  } finally {
    state.loading = false;
    renderPlanner();
  }
}

function cancelEdits() {
  if (state.basePlan) {
    applyBasePlan(state.basePlan);
    refreshTotals();
  }
  if (elements) {
    elements.details.open = false;
  }
  renderPlanner();
}

function handleModeChange(newMode: 'custom' | 'pro-rata') {
  if (state.mode === newMode) return;
  state.mode = newMode;
  if (newMode === 'pro-rata') {
    state.totalOmBudget = Object.values(state.sectorAllocations).reduce((sum, v) => sum + v, 0);
    const perSector = state.totalOmBudget / SECTORS.length;
    const allocations: Record<SectorKey, number> = { ...state.sectorAllocations };
    let remaining = Math.round(state.totalOmBudget);
    SECTORS.forEach((sector, index) => {
      if (index === SECTORS.length - 1) {
        allocations[sector] = Math.max(0, remaining);
      } else {
        const value = Math.max(0, Math.round(perSector));
        allocations[sector] = value;
        remaining -= value;
      }
    });
    state.sectorAllocations = allocations;
  }
  refreshTotals();
  renderPlanner();
}

function attachEventListeners() {
  if (!elements) return;
  elements.details.addEventListener('toggle', () => {
    if (elements?.details.open) {
      fetchPlannerData();
    }
  });

  elements.militaryInput.addEventListener('input', () => {
    state.militaryAllocation = Math.max(0, Number(elements?.militaryInput.value) || 0);
    refreshTotals();
    renderPlanner();
  });

  elements.educationSlider.addEventListener('input', () => {
    const raw = Number(elements?.educationSlider.value) || 0;
    const normalized = Math.max(0, Math.min(4, Math.round(raw)));
    const constrained = Math.min(state.educationMax, Math.max(state.educationMin, normalized));
    if (constrained !== normalized) {
      elements.educationSlider.value = String(constrained);
    }
    state.educationTier = constrained;
    refreshTotals();
    renderPlanner();
  });

  elements.healthcareSlider.addEventListener('input', () => {
    const raw = Number(elements?.healthcareSlider.value) || 0;
    const normalized = Math.max(0, Math.min(4, Math.round(raw)));
    const constrained = Math.min(state.healthcareMax, Math.max(state.healthcareMin, normalized));
    if (constrained !== normalized) {
      elements.healthcareSlider.value = String(constrained);
    }
    state.healthcareTier = constrained;
    refreshTotals();
    renderPlanner();
  });

  elements.allocationModeCustom.addEventListener('change', () => handleModeChange('custom'));
  elements.allocationModeProrata.addEventListener('change', () => handleModeChange('pro-rata'));

  elements.saveButton.addEventListener('click', (event) => {
    event.preventDefault();
    submitPlan();
  });
  elements.cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    cancelEdits();
  });
}

function buildPlannerMarkup(): string {
  return `
    <details id="nationPlanner" style="margin-top: 12px; background: rgba(0,0,0,0.25); border-radius: 8px; padding: 10px;">
      <summary id="plannerSummary" style="cursor: pointer; font-weight: 600; color: #4CAF50;">Nation Planner</summary>
      <div id="plannerContent" style="margin-top: 10px; display: flex; flex-direction: column; gap: 14px;">
        <div id="plannerStatus" style="font-size: 12px; color: #fff;">Configure next turn budgets and save to queue the plan.</div>

        <section id="plannerMilitarySection" style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 id="plannerMilitaryHeader" style="margin: 0 0 10px 0; color: #fff;">Military Budget</h5>
          <label id="plannerMilitaryLabel" style="display: block; color: #ccc; font-size: 12px; margin-bottom: 6px;">Gold Allocation</label>
          <input id="plannerMilitary" type="number" min="0" step="1" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
          <div id="plannerMilitaryStats" style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: #bbb; font-size: 12px;">
            <div id="plannerMilitaryUpkeepLine">Upkeep: <span id="plannerMilitaryUpkeep">0</span></div>
            <div id="plannerMilitaryGapLine">Upkeep Gap: <span id="plannerMilitaryGap">None</span></div>
            <div id="plannerMilitaryRemainderLine">Discretionary Remainder: <span id="plannerMilitaryRemainder">None</span></div>
          </div>
        </section>

        <section id="plannerWelfareSection" style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 id="plannerWelfareHeader" style="margin: 0 0 10px 0; color: #fff;">Welfare</h5>
          <div id="plannerWelfareDescription" style="color: #bbb; font-size: 12px; margin-bottom: 10px;">
            Adjust Education and Healthcare tiers. You may shift at most one tier per turn; gold costs update automatically.
          </div>
          <div id="plannerWelfareControls" style="display: grid; gap: 12px;">
            <div id="plannerEducationControl">
              <div id="plannerEducationHeaderRow" style="display: flex; justify-content: space-between; align-items: center; color: #ccc; font-size: 12px; margin-bottom: 4px;">
                <label id="plannerEducationLabel" for="plannerEducation" style="color: #fff; font-weight: 600;">Education Tier</label>
                <span id="plannerEducationTierValue" style="color: #8BC34A; font-size: 12px;">Tier 0</span>
              </div>
              <div id="plannerEducationSliderRow" style="display: flex; align-items: center; gap: 12px;">
                <input id="plannerEducation" type="range" min="0" max="4" step="1" list="plannerEducationMarks" style="flex: 1;" />
                <datalist id="plannerEducationMarks">
                  <option value="0"></option>
                  <option value="1"></option>
                  <option value="2"></option>
                  <option value="3"></option>
                  <option value="4"></option>
                </datalist>
                <div id="plannerEducationAllocation" style="min-width: 120px; text-align: right;">
                  <div id="plannerEducationAllocationLabel" style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Allocated Gold</div>
                  <div id="plannerEducationCost" style="font-size: 12px; color: #fff; font-weight: 600;">0</div>
                </div>
              </div>
            </div>
            <div id="plannerHealthcareControl">
              <div id="plannerHealthcareHeaderRow" style="display: flex; justify-content: space-between; align-items: center; color: #ccc; font-size: 12px; margin-bottom: 4px;">
                <label id="plannerHealthcareLabel" for="plannerHealthcare" style="color: #fff; font-weight: 600;">Healthcare Tier</label>
                <span id="plannerHealthcareTierValue" style="color: #8BC34A; font-size: 12px;">Tier 0</span>
              </div>
              <div id="plannerHealthcareSliderRow" style="display: flex; align-items: center; gap: 12px;">
                <input id="plannerHealthcare" type="range" min="0" max="4" step="1" list="plannerHealthcareMarks" style="flex: 1;" />
                <datalist id="plannerHealthcareMarks">
                  <option value="0"></option>
                  <option value="1"></option>
                  <option value="2"></option>
                  <option value="3"></option>
                  <option value="4"></option>
                </datalist>
                <div id="plannerHealthcareAllocation" style="min-width: 120px; text-align: right;">
                  <div id="plannerHealthcareAllocationLabel" style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Allocated Gold</div>
                  <div id="plannerHealthcareCost" style="font-size: 12px; color: #fff; font-weight: 600;">0</div>
                </div>
              </div>
            </div>
          </div>
          <div id="plannerWelfareDownshift" style="display:none; color: #FFC107; margin-top: 6px; font-size: 12px;"></div>
        </section>

        <section id="plannerOmSection" style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <div id="plannerOmHeaderRow" style="display: flex; justify-content: space-between; align-items: center; color: #ccc; font-size: 12px; margin-bottom: 10px;">
            <span id="plannerOmHeaderLabel">Total O&amp;M Allocation</span>
            <span id="plannerTotalOmValue" style="color: #fff; font-weight: 600;">0</span>
          </div>
          <div id="plannerOmColumnHeaders" style="display: grid; grid-template-columns: 1.2fr 0.8fr 0.8fr 1fr 1fr; gap: 8px; font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px;">
            <div id="plannerOmColumnHeaderSector">Sector</div>
            <div id="plannerOmColumnHeaderCeiling">Ceiling (g)</div>
            <div id="plannerOmColumnHeaderUtilization">Utilization</div>
            <div id="plannerOmColumnHeaderOutput">Output</div>
            <div id="plannerOmColumnHeaderFunding">Funding (g)</div>
          </div>
          <div id="plannerSectors"></div>
          <div id="plannerPriorityRow" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
            <h5 id="plannerPriorityHeader" style="margin: 0; color: #fff;">Priority Mode</h5>
            <div id="plannerModeToggleGroup" style="font-size: 12px; color: #ccc; display: flex; gap: 10px;">
              <label id="plannerModeCustomLabel"><input type="radio" name="plannerMode" id="plannerModeCustom" value="custom" checked /> Custom</label>
              <label id="plannerModeProrataLabel"><input type="radio" name="plannerMode" id="plannerModeProrata" value="pro-rata" /> Pro-rata</label>
            </div>
          </div>
          <div id="plannerModeDescription" style="font-size: 11px; color: #888; margin-top: 6px;">
            Custom mode enables dragging and editing sector funding. Pro-rata locks the cards and splits funding evenly.
          </div>
        </section>

        <section id="plannerFinanceSection" style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 id="plannerFinanceHeader" style="margin: 0 0 8px 0; color: #fff;">Finance Summary</h5>
          <div id="plannerFinanceGrid" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; color: #bbb; font-size: 12px; align-items: center;">
            <div id="plannerIdleTaxLabel">Total Idle Tax</div>
            <div id="plannerIdleTax" style="text-align: right; color: #fff;">0</div>
            <div id="plannerEnergyLabel">Energy &amp; Infrastructure</div>
            <div id="plannerEnergy" style="text-align: right; color: #fff;">0</div>
            <div id="plannerMiscLabel">Miscellaneous Expenses</div>
            <div id="plannerMisc" style="text-align: right; color: #fff;">0</div>
            <div id="plannerLastRoundLabel">Gold Spent Last Round</div>
            <div id="plannerLastRound" style="text-align: right; color: #fff;">0</div>
            <div id="plannerProjectedLabel">Projected Gold This Round</div>
            <div id="plannerProjected" style="text-align: right; color: #fff;">0</div>
            <div id="plannerTreasuryLabel">Gold in Treasury</div>
            <div id="plannerTreasury" style="text-align: right; color: #fff;">0</div>
            <div id="plannerDebtLabel">National Debt</div>
            <div id="plannerDebt" style="text-align: right; color: #fff;">0</div>
          </div>
        </section>

        <section id="plannerWarningsSection" style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 id="plannerWarningsHeader" style="margin: 0 0 8px 0; color: #fff;">Warnings &amp; Validation</h5>
          <div id="plannerWarnings" style="font-size: 12px;"></div>
        </section>

        <div id="plannerActions" style="display: flex; gap: 10px;">
          <button id="plannerSave" style="flex: 1; padding: 10px; background: #4CAF50; border: none; border-radius: 6px; color: #fff; font-weight: 600; cursor: pointer;">Save</button>
          <button id="plannerCancel" style="flex: 1; padding: 10px; background: #666; border: none; border-radius: 6px; color: #fff; font-weight: 600; cursor: pointer;">Cancel</button>
        </div>
      </div>
    </details>
  `;
}

export function initializePlannerUI(container: HTMLElement, provider: PlannerContext) {
  if (state.initialized) return;
  contextProvider = provider;
  container.innerHTML = buildPlannerMarkup();

  const details = container.querySelector('#nationPlanner') as HTMLDetailsElement;
  const elementsMap: PlannerElements = {
    container,
    details,
    status: container.querySelector('#plannerStatus') as HTMLElement,
    militaryInput: container.querySelector('#plannerMilitary') as HTMLInputElement,
    upkeepSpan: container.querySelector('#plannerMilitaryUpkeep') as HTMLElement,
    gapSpan: container.querySelector('#plannerMilitaryGap') as HTMLElement,
    remainderSpan: container.querySelector('#plannerMilitaryRemainder') as HTMLElement,
    educationSlider: container.querySelector('#plannerEducation') as HTMLInputElement,
    healthcareSlider: container.querySelector('#plannerHealthcare') as HTMLInputElement,
    educationTierValue: container.querySelector('#plannerEducationTierValue') as HTMLElement,
    healthcareTierValue: container.querySelector('#plannerHealthcareTierValue') as HTMLElement,
    educationCost: container.querySelector('#plannerEducationCost') as HTMLElement,
    healthcareCost: container.querySelector('#plannerHealthcareCost') as HTMLElement,
    welfareDownshift: container.querySelector('#plannerWelfareDownshift') as HTMLElement,
    allocationModeCustom: container.querySelector('#plannerModeCustom') as HTMLInputElement,
    allocationModeProrata: container.querySelector('#plannerModeProrata') as HTMLInputElement,
    totalOmValue: container.querySelector('#plannerTotalOmValue') as HTMLElement,
    sectorContainer: container.querySelector('#plannerSectors') as HTMLElement,
    warningsList: container.querySelector('#plannerWarnings') as HTMLElement,
    idleTaxLine: container.querySelector('#plannerIdleTax') as HTMLElement,
    energyLine: container.querySelector('#plannerEnergy') as HTMLElement,
    miscLine: container.querySelector('#plannerMisc') as HTMLElement,
    lastRoundLine: container.querySelector('#plannerLastRound') as HTMLElement,
    projectedLine: container.querySelector('#plannerProjected') as HTMLElement,
    treasuryLine: container.querySelector('#plannerTreasury') as HTMLElement,
    debtLine: container.querySelector('#plannerDebt') as HTMLElement,
    saveButton: container.querySelector('#plannerSave') as HTMLButtonElement,
    cancelButton: container.querySelector('#plannerCancel') as HTMLButtonElement,
  };

  elements = elementsMap;
  attachEventListeners();
  state.initialized = true;
  renderPlanner();
}

export function setPlannerVisibility(visible: boolean) {
  if (!elements) return;
  elements.container.style.display = visible ? 'block' : 'none';
}

export function updatePlannerSnapshot(snapshot: any) {
  state.snapshot = snapshot;
  const { playerId } = getContext();
  const playerNation = playerId ? snapshot?.nations?.[playerId] ?? null : null;
  if (playerNation) {
    state.nation = playerNation;
  }
  updateStatusBarFromGameState(snapshot, playerId);
  if (snapshot?.economy) {
    const financeWaterfall = playerNation?.finance?.waterfall;
    state.treasury = playerNation?.finance?.treasury ?? snapshot.economy.resources?.gold ?? state.treasury;
    state.debt = playerNation?.finance?.debt ?? snapshot.economy.finance?.debt ?? state.debt;
    state.availableGold = playerNation?.finance?.treasury ?? snapshot.economy.resources?.gold ?? state.availableGold;
    state.lastRoundSpend = financeWaterfall
      ? financeWaterfall.operations +
        financeWaterfall.welfare +
        financeWaterfall.military +
        financeWaterfall.projects +
        financeWaterfall.interest
      : snapshot.economy.finance?.summary?.expenditures ?? state.lastRoundSpend;
    state.energySpend = snapshot.economy.energy?.oAndMSpent ?? state.energySpend;
    state.miscSpend = financeWaterfall?.interest ?? snapshot.economy.finance?.summary?.interest ?? state.miscSpend;
    state.idleTax = computeIdleTax(snapshot.economy, playerNation ?? state.nation);
    state.militaryUpkeep = estimateMilitaryUpkeep(snapshot);
    state.totalLabor = calculateTotalLabor(snapshot.economy);
    refreshTotals();
    renderPlanner();
  }
}

export function plannerIsInitialized(): boolean {
  return state.initialized;
}

