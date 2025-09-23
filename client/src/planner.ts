import { SERVER_BASE_URL } from './config';
import { deserializeTypedArrays } from './mesh';
import { showGameNotification } from './notifications';

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
  funded: number;
  utilization: number;
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
}

interface SerializedPlan {
  mode: 'custom' | 'pro-rata';
  sectorOrder: SectorKey[];
  sectorAllocations: Record<SectorKey, number>;
  militaryAllocation: number;
  welfareBudget: number;
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
  welfareBudgetInput: HTMLInputElement;
  educationSlider: HTMLInputElement;
  healthcareSlider: HTMLInputElement;
  educationCost: HTMLElement;
  healthcareCost: HTMLElement;
  welfareRequired: HTMLElement;
  welfareDownshift: HTMLElement;
  allocationModeCustom: HTMLInputElement;
  allocationModeProrata: HTMLInputElement;
  totalOmInput: HTMLInputElement;
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

const OM_COST_PER_SLOT = 1;
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
};

function formatGold(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return `${rounded.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} gold`;
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
  welfareBudget: number;
  totalLabor: number;
  educationTier: number;
  healthcareTier: number;
}): string[] {
  const warnings: string[] = [];
  const welfareCosts = calculateWelfareCost(
    options.totalLabor,
    options.educationTier,
    options.healthcareTier,
  );

  if (options.projectedSpend > options.availableGold) {
    warnings.push('Total planned spending exceeds treasury.');
  }
  if (options.militaryAllocation < options.militaryUpkeep) {
    warnings.push('Military funding is below upkeep and units may degrade.');
  }
  if (options.welfareBudget < welfareCosts.total) {
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

function aggregateSectorStats(economy: any): Record<SectorKey, SectorStats> {
  const stats: Record<SectorKey, SectorStats> = Object.fromEntries(
    SECTORS.map((sector) => [sector, { capacity: 0, funded: 0, utilization: 0 }]),
  ) as Record<SectorKey, SectorStats>;

  if (!economy || !economy.cantons) return stats;

  for (const canton of Object.values(economy.cantons) as any[]) {
    if (!canton || !canton.sectors) continue;
    for (const sectorKey of SECTORS) {
      const sectorState = canton.sectors[sectorKey];
      if (!sectorState) continue;
      const stat = stats[sectorKey];
      stat.capacity += sectorState.capacity || 0;
      stat.funded += sectorState.funded || 0;
      stat.utilization += sectorState.utilization || 0;
    }
  }

  return stats;
}

function computeIdleTax(economy: any): number {
  if (!economy || !economy.cantons) return 0;
  let total = 0;
  for (const canton of Object.values(economy.cantons) as any[]) {
    if (!canton || !canton.sectors) continue;
    for (const sectorKey of SECTORS) {
      const sectorState = canton.sectors[sectorKey];
      if (!sectorState) continue;
      const idle = sectorState.idle || 0;
      total += idle * OM_COST_PER_SLOT * IDLE_TAX_RATE;
    }
  }
  return total;
}

function computeSectorOutputs(stats: SectorStats, sector: SectorKey): string {
  const outputs = SECTOR_OUTPUTS[sector];
  const parts: string[] = [];
  for (const [resource, perSlot] of Object.entries(outputs)) {
    const produced = stats.utilization * perSlot;
    if (produced > 0) {
      parts.push(`${resource}: ${produced.toFixed(0)}`);
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
  state.welfareBudget = plan.welfareBudget;
  state.educationTier = plan.educationTier;
  state.healthcareTier = plan.healthcareTier;
  state.totalOmBudget = Object.values(state.sectorAllocations).reduce((sum, value) => sum + value, 0);
  state.projectedSpend = state.totalOmBudget + state.militaryAllocation + state.welfareBudget;
}

function refreshTotals() {
  state.totalOmBudget = Object.values(state.sectorAllocations).reduce((sum, v) => sum + v, 0);
  const welfareCosts = calculateWelfareCost(state.totalLabor, state.educationTier, state.healthcareTier);
  state.educationCost = welfareCosts.education;
  state.healthcareCost = welfareCosts.healthcare;
  state.projectedSpend = state.militaryAllocation + state.welfareBudget + state.totalOmBudget;
  const affordable = predictAffordableWelfare(
    state.welfareBudget,
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
    welfareBudget: state.welfareBudget,
    totalLabor: state.totalLabor,
    educationTier: state.educationTier,
    healthcareTier: state.healthcareTier,
  });
}

function renderSectorCards() {
  if (!elements) return;
  const stats = aggregateSectorStats(state.economy || state.snapshot?.economy);
  elements.sectorContainer.innerHTML = '';

  state.sectorOrder.forEach((sector) => {
    const card = document.createElement('div');
    card.className = 'planner-sector-card';
    card.draggable = state.mode === 'custom';
    card.dataset.sector = sector;
    card.style.cssText = `
      display: grid;
      grid-template-columns: 1.2fr 0.8fr 0.8fr 1fr 1fr;
      gap: 8px;
      padding: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      margin-bottom: 6px;
      background: rgba(0, 0, 0, 0.2);
      align-items: center;
      cursor: ${state.mode === 'custom' ? 'grab' : 'default'};
    `;

    const sectorStats = stats[sector];
    const utilization = sectorStats.capacity > 0
      ? Math.min(100, Math.round((sectorStats.utilization / sectorStats.capacity) * 100))
      : 0;

    const fundingInput = document.createElement('input');
    fundingInput.type = 'number';
    fundingInput.min = '0';
    fundingInput.step = '1';
    fundingInput.value = String(state.sectorAllocations[sector] ?? 0);
    fundingInput.disabled = state.mode !== 'custom';
    fundingInput.style.cssText = 'width: 100%; padding: 4px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;';
    fundingInput.addEventListener('input', () => {
      const value = Math.max(0, Number(fundingInput.value) || 0);
      state.sectorAllocations[sector] = value;
      refreshTotals();
      renderPlanner();
    });

    card.innerHTML = `
      <div style="font-weight: 600; color: #fff;">${SECTOR_TITLES[sector]}</div>
      <div style="color: #bbb;">${sectorStats.capacity} (${formatGold(sectorStats.capacity * OM_COST_PER_SLOT)})</div>
      <div style="color: #bbb;">${utilization}%</div>
      <div style="color: #bbb;">${computeSectorOutputs(sectorStats, sector)}</div>
    `;

    const fundingCell = document.createElement('div');
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
    elements.warningsList.innerHTML = '<div style="color: #8BC34A;">All budgets within limits.</div>';
    return;
  }
  for (const warning of state.warnings) {
    const item = document.createElement('div');
    item.textContent = warning;
    item.style.color = '#FFC107';
    item.style.marginBottom = '4px';
    elements.warningsList.appendChild(item);
  }
}

function renderPlanner() {
  if (!elements) return;

  elements.militaryInput.value = String(state.militaryAllocation);
  elements.upkeepSpan.textContent = formatGold(state.militaryUpkeep);
  const gap = Math.max(0, state.militaryUpkeep - state.militaryAllocation);
  elements.gapSpan.textContent = gap > 0 ? formatGold(gap) : 'None';
  const remainder = Math.max(0, state.militaryAllocation - state.militaryUpkeep);
  elements.remainderSpan.textContent = remainder > 0 ? formatGold(remainder) : 'None';

  elements.welfareBudgetInput.value = String(state.welfareBudget);
  elements.educationSlider.value = String(state.educationTier);
  elements.healthcareSlider.value = String(state.healthcareTier);
  elements.educationSlider.min = String(state.educationMin);
  elements.educationSlider.max = String(state.educationMax);
  elements.healthcareSlider.min = String(state.healthcareMin);
  elements.healthcareSlider.max = String(state.healthcareMax);
  elements.educationCost.textContent = formatGold(state.educationCost);
  elements.healthcareCost.textContent = formatGold(state.healthcareCost);
  const welfareTotalCost = state.educationCost + state.healthcareCost;
  elements.welfareRequired.textContent = formatGold(welfareTotalCost);

  if (state.welfareBudget < welfareTotalCost) {
    elements.welfareDownshift.textContent = `Budget funds Education Tier ${state.affordableEducation} and Healthcare Tier ${state.affordableHealthcare}.`;
    elements.welfareDownshift.style.display = 'block';
  } else {
    elements.welfareDownshift.style.display = 'none';
  }

  elements.allocationModeCustom.checked = state.mode === 'custom';
  elements.allocationModeProrata.checked = state.mode === 'pro-rata';
  elements.totalOmInput.value = String(state.totalOmBudget);
  elements.totalOmInput.disabled = state.mode !== 'pro-rata';

  renderSectorCards();
  renderWarnings();

  elements.idleTaxLine.textContent = formatGold(state.idleTax);
  elements.energyLine.textContent = formatGold(state.energySpend);
  elements.miscLine.textContent = formatGold(state.miscSpend);
  elements.lastRoundLine.textContent = formatGold(state.lastRoundSpend);
  elements.projectedLine.textContent = formatGold(state.projectedSpend);
  elements.projectedLine.style.color = state.projectedSpend > state.lastRoundSpend ? '#FF8A80' : '#8BC34A';
  elements.treasuryLine.textContent = formatGold(state.treasury);
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
    state.economy = fullState.economy;
    state.availableGold = fullState.economy?.resources?.gold ?? 0;
    state.lastRoundSpend = fullState.economy?.finance?.summary?.expenditures ?? 0;
    state.energySpend = fullState.economy?.energy?.oAndMSpent ?? 0;
    state.miscSpend = fullState.economy?.finance?.summary?.interest ?? 0;
    state.treasury = fullState.economy?.resources?.gold ?? 0;
    state.debt = fullState.economy?.finance?.debt ?? 0;
    state.idleTax = computeIdleTax(fullState.economy);
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
    state.welfareBudget = budgets.welfare || 0;
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

    state.basePlan = {
      mode: state.mode,
      sectorOrder: [...state.sectorOrder],
      sectorAllocations: { ...state.sectorAllocations },
      militaryAllocation: state.militaryAllocation,
      welfareBudget: state.welfareBudget,
      educationTier: state.educationTier,
      healthcareTier: state.healthcareTier,
    };

    refreshTotals();
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

  elements.welfareBudgetInput.addEventListener('input', () => {
    state.welfareBudget = Math.max(0, Number(elements?.welfareBudgetInput.value) || 0);
    refreshTotals();
    renderPlanner();
  });

  elements.educationSlider.addEventListener('input', () => {
    const value = Number(elements?.educationSlider.value) || 0;
    state.educationTier = Math.min(state.educationMax, Math.max(state.educationMin, value));
    refreshTotals();
    renderPlanner();
  });

  elements.healthcareSlider.addEventListener('input', () => {
    const value = Number(elements?.healthcareSlider.value) || 0;
    state.healthcareTier = Math.min(state.healthcareMax, Math.max(state.healthcareMin, value));
    refreshTotals();
    renderPlanner();
  });

  elements.allocationModeCustom.addEventListener('change', () => handleModeChange('custom'));
  elements.allocationModeProrata.addEventListener('change', () => handleModeChange('pro-rata'));

  elements.totalOmInput.addEventListener('input', () => {
    if (state.mode !== 'pro-rata') return;
    state.totalOmBudget = Math.max(0, Number(elements?.totalOmInput.value) || 0);
    const perSector = state.totalOmBudget / SECTORS.length;
    let remaining = Math.round(state.totalOmBudget);
    const allocations: Record<SectorKey, number> = { ...state.sectorAllocations };
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
    refreshTotals();
    renderPlanner();
  });

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
      <summary style="cursor: pointer; font-weight: 600; color: #4CAF50;">Nation Planner</summary>
      <div id="plannerContent" style="margin-top: 10px; display: flex; flex-direction: column; gap: 14px;">
        <div id="plannerStatus" style="font-size: 12px; color: #fff;">Configure next turn budgets and save to queue the plan.</div>

        <section style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 style="margin: 0 0 10px 0; color: #fff;">Military Budget</h5>
          <label style="display: block; color: #ccc; font-size: 12px; margin-bottom: 6px;">Gold Allocation</label>
          <input id="plannerMilitary" type="number" min="0" step="1" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: #bbb; font-size: 12px;">
            <div>Upkeep: <span id="plannerMilitaryUpkeep">0</span></div>
            <div>Upkeep Gap: <span id="plannerMilitaryGap">None</span></div>
            <div>Discretionary Remainder: <span id="plannerMilitaryRemainder">None</span></div>
          </div>
        </section>

        <section style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 style="margin: 0 0 10px 0; color: #fff;">Welfare</h5>
          <label style="display: block; color: #ccc; font-size: 12px;">Education Tier</label>
          <input id="plannerEducation" type="range" min="0" max="4" step="1" style="width: 100%;" />
          <label style="display: block; color: #ccc; font-size: 12px; margin-top: 8px;">Healthcare Tier</label>
          <input id="plannerHealthcare" type="range" min="0" max="4" step="1" style="width: 100%;" />
          <label style="display: block; color: #ccc; font-size: 12px; margin-top: 10px;">Welfare Budget (Gold)</label>
          <input id="plannerWelfareBudget" type="number" min="0" step="1" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: #bbb; font-size: 12px;">
            <div>Education Allocation: <span id="plannerEducationCost">0</span></div>
            <div>Healthcare Allocation: <span id="plannerHealthcareCost">0</span></div>
            <div>Required Gold: <span id="plannerWelfareRequired">0</span></div>
            <div id="plannerWelfareDownshift" style="display:none; color: #FFC107;"></div>
          </div>
        </section>

        <section style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h5 style="margin: 0; color: #fff;">Sector Operations &amp; Maintenance</h5>
            <div style="font-size: 12px; color: #ccc; display: flex; gap: 10px;">
              <label><input type="radio" name="plannerMode" id="plannerModeCustom" value="custom" checked /> Custom</label>
              <label><input type="radio" name="plannerMode" id="plannerModeProrata" value="pro-rata" /> Pro-rata</label>
            </div>
          </div>
          <label style="display: block; color: #ccc; font-size: 12px; margin-bottom: 6px;">Total O&amp;M Allocation</label>
          <input id="plannerTotalOm" type="number" min="0" step="1" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; margin-bottom: 10px;" />
          <div style="display: grid; grid-template-columns: 1.2fr 0.8fr 0.8fr 1fr 1fr; gap: 8px; font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px;">
            <div>Sector</div>
            <div>Ceiling</div>
            <div>Utilization</div>
            <div>Output</div>
            <div>Funding</div>
          </div>
          <div id="plannerSectors"></div>
        </section>

        <section style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 style="margin: 0 0 8px 0; color: #fff;">Finance Summary</h5>
          <div style="display: flex; flex-direction: column; gap: 4px; color: #bbb; font-size: 12px;">
            <div>Total Idle Tax: <span id="plannerIdleTax">0</span></div>
            <div>Energy &amp; Infrastructure: <span id="plannerEnergy">0</span></div>
            <div>Miscellaneous Expenses: <span id="plannerMisc">0</span></div>
            <div>Gold Spent Last Round: <span id="plannerLastRound">0</span></div>
            <div>Projected Gold This Round: <span id="plannerProjected">0</span></div>
            <div>Gold in Treasury: <span id="plannerTreasury">0</span></div>
            <div>National Debt: <span id="plannerDebt">0</span></div>
          </div>
        </section>

        <section style="background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px;">
          <h5 style="margin: 0 0 8px 0; color: #fff;">Warnings &amp; Validation</h5>
          <div id="plannerWarnings" style="font-size: 12px;"></div>
        </section>

        <div style="display: flex; gap: 10px;">
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
    welfareBudgetInput: container.querySelector('#plannerWelfareBudget') as HTMLInputElement,
    educationSlider: container.querySelector('#plannerEducation') as HTMLInputElement,
    healthcareSlider: container.querySelector('#plannerHealthcare') as HTMLInputElement,
    educationCost: container.querySelector('#plannerEducationCost') as HTMLElement,
    healthcareCost: container.querySelector('#plannerHealthcareCost') as HTMLElement,
    welfareRequired: container.querySelector('#plannerWelfareRequired') as HTMLElement,
    welfareDownshift: container.querySelector('#plannerWelfareDownshift') as HTMLElement,
    allocationModeCustom: container.querySelector('#plannerModeCustom') as HTMLInputElement,
    allocationModeProrata: container.querySelector('#plannerModeProrata') as HTMLInputElement,
    totalOmInput: container.querySelector('#plannerTotalOm') as HTMLInputElement,
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
  if (snapshot?.economy) {
    state.treasury = snapshot.economy.resources?.gold ?? state.treasury;
    state.debt = snapshot.economy.finance?.debt ?? state.debt;
    state.availableGold = snapshot.economy.resources?.gold ?? state.availableGold;
    state.lastRoundSpend = snapshot.economy.finance?.summary?.expenditures ?? state.lastRoundSpend;
    state.energySpend = snapshot.economy.energy?.oAndMSpent ?? state.energySpend;
    state.miscSpend = snapshot.economy.finance?.summary?.interest ?? state.miscSpend;
    state.idleTax = computeIdleTax(snapshot.economy);
    state.militaryUpkeep = estimateMilitaryUpkeep(snapshot);
    state.totalLabor = calculateTotalLabor(snapshot.economy);
    refreshTotals();
    renderPlanner();
  }
}

export function plannerIsInitialized(): boolean {
  return state.initialized;
}

