import { } from './network';
import { SERVER_BASE_URL } from './config';

interface SectorState {
  name: string;
  capacity: number;
  activeSlots: number;
}

interface NationState {
  gold: number;
  militaryUpkeep: number;
  welfare: { educationTier: number; healthcareTier: number };
  sectors: SectorState[];
  tariffBounds: { min: number; max: number };
  fxSwapCap: number;
}

interface NationPlan {
  military: number;
  educationTier: number;
  healthcareTier: number;
  sectors: Record<string, number>;
  priority: string[];
  tariff: number;
  fxSwap: number;
}

interface LoadResponse {
  state: NationState;
  plan: NationPlan;
  activePlayer: boolean;
}

let currentState: NationState | null = null;
let currentPlan: NationPlan | null = null;
let activePlayer = false;

/**
 * Initialize the Nation Planner. Creates the planner UI and wires up events.
 */
export function initNationPlanner() {
  const gameControls = document.getElementById('gameControls');
  if (!gameControls) return;

  const details = document.getElementById('nationPlanner') as HTMLDetailsElement | null;
  if (!details) return;

  details.addEventListener('toggle', async () => {
    if (details.open && !currentState) {
      await loadAndRender();
    }
  });
}

async function loadAndRender() {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/nation/plan`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`load failed: ${res.status}`);
    }
    const resp: LoadResponse = await res.json();
    currentState = resp.state;
    currentPlan = resp.plan;
    activePlayer = resp.activePlayer;
    renderPlanner();
  } catch (err) {
    console.error('failed to load nation plan', err);
  }
}

function renderPlanner() {
  if (!currentState || !currentPlan) return;
  const details = document.getElementById('nationPlanner') as HTMLDetailsElement;
  let container = details.querySelector('.plannerContent') as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.className = 'plannerContent';
    details.appendChild(container);
  }
  container.innerHTML = '';

  // Budgets panel
  const budgetsPanel = document.createElement('div');
  budgetsPanel.id = 'budgetsPanel';
  budgetsPanel.innerHTML = `<h4>Budgets</h4>`;

  // Military budget
  const milDiv = document.createElement('div');
  milDiv.innerHTML = `
    <label>Military: <input type="range" id="militaryRange" min="0" max="${currentState.gold}" value="${currentPlan.military}"></label>
    <input type="number" id="militaryInput" min="0" max="${currentState.gold}" value="${currentPlan.military}" />
    <div id="upkeepInfo">Upkeep Required: <span id="upkeepReq">${currentState.militaryUpkeep}</span> (<span id="upkeepGap"></span> gap)</div>
  `;
  budgetsPanel.appendChild(milDiv);

  // Welfare tiers
  const welfareDiv = document.createElement('div');
  welfareDiv.innerHTML = `
    <label>Education Tier <input type="number" id="eduTier" min="0" max="4" value="${currentPlan.educationTier}"></label>
    <label>Healthcare Tier <input type="number" id="healthTier" min="0" max="4" value="${currentPlan.healthcareTier}"></label>
    <div id="welfareError" style="color:red"></div>
  `;
  budgetsPanel.appendChild(welfareDiv);

  // Sector O&M
  const sectorDiv = document.createElement('div');
  sectorDiv.innerHTML = '<h5>Sectors</h5>';
  currentState.sectors.forEach((s) => {
    const d = document.createElement('div');
    d.innerHTML = `
      <span>${s.name}</span>
      <input type="range" class="sectorRange" data-sector="${s.name}" min="0" max="${s.capacity}" value="${currentPlan!.sectors[s.name] ?? 0}">
      <input type="number" class="sectorInput" data-sector="${s.name}" min="0" max="${s.capacity}" value="${currentPlan!.sectors[s.name] ?? 0}">
    `;
    sectorDiv.appendChild(d);
  });
  sectorDiv.innerHTML += '<div id="idleTax"></div>';
  budgetsPanel.appendChild(sectorDiv);

  budgetsPanel.innerHTML += `<div id="remaining">Remaining Gold: <span id="remainingGold"></span></div>`;

  container.appendChild(budgetsPanel);

  // Priority panel
  const priorityPanel = document.createElement('div');
  priorityPanel.id = 'priorityPanel';
  priorityPanel.innerHTML = '<h4>Sector Prioritization</h4>';
  const ul = document.createElement('ul');
  ul.id = 'priorityList';
  currentPlan.priority.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p;
    li.draggable = true;
    ul.appendChild(li);
  });
  priorityPanel.appendChild(ul);
  container.appendChild(priorityPanel);

  // Policy panel
  const policyPanel = document.createElement('div');
  policyPanel.id = 'policyPanel';
  policyPanel.innerHTML = `
    <h4>Policy Quick Toggles</h4>
    <label>Tariff <input type="range" id="tariff" min="${currentState.tariffBounds.min}" max="${currentState.tariffBounds.max}" value="${currentPlan.tariff}"></label>
    <span id="tariffValue">${currentPlan.tariff}</span>
    <div><label>FX Swap <input type="number" id="fxSwap" value="${currentPlan.fxSwap}"></label> (cap ${currentState.fxSwapCap})<div id="fxError" style="color:red"></div></div>
  `;
  container.appendChild(policyPanel);

  // Submit button
  const submit = document.createElement('button');
  submit.id = 'submitPlan';
  submit.textContent = 'Submit Plan';
  container.appendChild(submit);

  wireEvents();
  lockInputs(!activePlayer);
  updateTotals();
}

function wireEvents() {
  const milRange = document.getElementById('militaryRange') as HTMLInputElement;
  const milInput = document.getElementById('militaryInput') as HTMLInputElement;
  milRange.addEventListener('input', () => {
    milInput.value = milRange.value;
    currentPlan!.military = parseInt(milRange.value);
    updateTotals();
  });
  milInput.addEventListener('input', () => {
    milRange.value = milInput.value;
    currentPlan!.military = parseInt(milInput.value || '0');
    updateTotals();
  });

  const edu = document.getElementById('eduTier') as HTMLInputElement;
  const health = document.getElementById('healthTier') as HTMLInputElement;
  edu.addEventListener('input', () => {
    currentPlan!.educationTier = parseInt(edu.value || '0');
    updateTotals();
  });
  health.addEventListener('input', () => {
    currentPlan!.healthcareTier = parseInt(health.value || '0');
    updateTotals();
  });

  document.querySelectorAll<HTMLInputElement>('input.sectorRange').forEach((r) => {
    const sector = r.dataset.sector!;
    const input = document.querySelector<HTMLInputElement>(`input.sectorInput[data-sector="${sector}"]`)!;
    r.addEventListener('input', () => {
      input.value = r.value;
      currentPlan!.sectors[sector] = parseInt(r.value);
      updateTotals();
    });
    input.addEventListener('input', () => {
      r.value = input.value;
      currentPlan!.sectors[sector] = parseInt(input.value || '0');
      updateTotals();
    });
  });

  const tariff = document.getElementById('tariff') as HTMLInputElement;
  tariff.addEventListener('input', () => {
    currentPlan!.tariff = parseInt(tariff.value);
    const span = document.getElementById('tariffValue')!;
    span.textContent = tariff.value;
  });

  const fx = document.getElementById('fxSwap') as HTMLInputElement;
  fx.addEventListener('input', () => {
    currentPlan!.fxSwap = parseInt(fx.value || '0');
    updateTotals();
  });

  // Priority drag events
  const ul = document.getElementById('priorityList')!;
  let dragEl: HTMLElement | null = null;
  ul.addEventListener('dragstart', (e) => {
    dragEl = e.target as HTMLElement;
  });
  ul.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    if (target && target !== dragEl && target.tagName === 'LI') {
      const rect = target.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      ul.insertBefore(dragEl!, next ? target.nextSibling : target);
    }
  });
  ul.addEventListener('drop', () => {
    currentPlan!.priority = Array.from(ul.children).map((li) => li.textContent || '');
  });

  const submit = document.getElementById('submitPlan')!;
  submit.addEventListener('click', async () => {
    const payload = getPlanPayload();
    await fetch(`${SERVER_BASE_URL}/api/nation/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });
}

function updateTotals() {
  if (!currentState || !currentPlan) return;
  const upkeepGap = Math.max(0, currentState.militaryUpkeep - currentPlan.military);
  const gapEl = document.getElementById('upkeepGap');
  if (gapEl) gapEl.textContent = upkeepGap.toString();

  let total = currentPlan.military;
  const slotCost = 50;
  let idleTax = 0;
  currentState.sectors.forEach((s) => {
    const active = currentPlan!.sectors[s.name] || 0;
    total += active * slotCost;
    idleTax += (s.capacity - active) * 5;
  });
  const welfareCost = (currentPlan.educationTier + currentPlan.healthcareTier) * 50;
  total += welfareCost;
  const remaining = currentState.gold - total;
  const remEl = document.getElementById('remainingGold');
  if (remEl) remEl.textContent = remaining.toString();
  const idleEl = document.getElementById('idleTax');
  if (idleEl) idleEl.textContent = `Idle Tax: ${idleTax}`;

  // Validate welfare tier change ±1
  const welfareError = document.getElementById('welfareError');
  if (welfareError) {
    const bad =
      Math.abs(currentPlan.educationTier - currentState.welfare.educationTier) > 1 ||
      Math.abs(currentPlan.healthcareTier - currentState.welfare.healthcareTier) > 1;
    welfareError.textContent = bad ? 'Tiers can only change by 1 per turn' : '';
  }

  // Validate fx swap cap
  const fxError = document.getElementById('fxError');
  if (fxError) {
    fxError.textContent = Math.abs(currentPlan.fxSwap) > currentState.fxSwapCap ? 'Swap exceeds cap' : '';
  }
}

function lockInputs(disabled: boolean) {
  document
    .querySelectorAll<HTMLInputElement>(
      '#budgetsPanel input, #priorityPanel input, #policyPanel input, #priorityList li'
    )
    .forEach((el) => {
      (el as HTMLInputElement).disabled = disabled;
      if (el.tagName === 'LI') {
        (el as HTMLElement).draggable = !disabled;
      }
    });
  const submit = document.getElementById('submitPlan') as HTMLButtonElement;
  if (submit) submit.disabled = disabled;
}

function getPlanPayload() {
  return {
    budgets: {
      military: currentPlan!.military,
      welfare: {
        educationTier: currentPlan!.educationTier,
        healthcareTier: currentPlan!.healthcareTier,
      },
      sectors: currentPlan!.sectors,
    },
    sectorPriority: currentPlan!.priority,
    tariff: currentPlan!.tariff,
    fxSwap: currentPlan!.fxSwap,
  };
}

export function __testing() {
  return {
    loadAndRender,
    getPlanPayload,
    reset: () => {
      currentState = null;
      currentPlan = null;
      activePlayer = false;
    },
  };
}

