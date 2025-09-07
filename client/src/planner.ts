import { SERVER_BASE_URL } from './config';
import { currentGameId, currentPlayerName } from './game';

const SECTORS = ['agriculture','manufacturing','energy','research','finance','logistics','ordnance'];
let goldAvailable = 0;
let initialized = false;

export function togglePlanner(visible: boolean) {
  const div = document.getElementById('gameControls');
  if (div) div.style.display = visible ? 'block' : 'none';
}

export async function initPlanner(gameId: string | null, player: string | null) {
  if (!gameId || !player) return;
  const container = document.getElementById('nationPlannerContent');
  if (!container || initialized) return;
  initialized = true;

  const [econ, budget, welfare] = await Promise.all([
    fetch(`${SERVER_BASE_URL}/api/games/${gameId}/economy`).then(r => r.json()),
    fetch(`${SERVER_BASE_URL}/api/games/${gameId}/budget`).then(r => r.json()),
    fetch(`${SERVER_BASE_URL}/api/games/${gameId}/welfare`).then(r => r.json())
  ]);

  goldAvailable = econ.resources?.gold || 0;

  container.innerHTML = `
    <div id="budgetsSection" style="margin-bottom:10px;">
      <h4>Budgets</h4>
      <div style="display:flex; gap:5px; margin-bottom:5px;">
        <label style="flex:1;">Education Tier: <input type="range" id="eduTier" min="0" max="4" value="${welfare.next?.education ?? 0}" style="width:100%;" title="Sets education welfare tier for next turn. Higher tiers cost more Gold per labor unit."><span id="eduTierVal" style="margin-left:4px;">${welfare.next?.education ?? 0}</span></label>
        <label style="flex:1;">Healthcare Tier: <input type="range" id="healthTier" min="0" max="4" value="${welfare.next?.healthcare ?? 0}" style="width:100%;" title="Sets healthcare welfare tier for next turn. Higher tiers cost more Gold per labor unit."><span id="healthTierVal" style="margin-left:4px;">${welfare.next?.healthcare ?? 0}</span></label>
      </div>
      <div style="margin-bottom:5px;">
        <label>Military Gold: <input type="number" id="militaryAlloc" min="0" value="${budget.military ?? 0}" style="width:60px;" title="Gold allocated to the military; upkeep deducted first."></label>
      </div>
      <div id="sectorInputs" style="margin-bottom:5px;">
        ${SECTORS.map(s => {
          const cap = totalCapacity(econ, s);
          const val = budget.sectorOM?.[s] ?? 0;
          return `<div style="margin-bottom:3px;" data-sector="${s}">
            <label>${capitalize(s)} (cap ${cap}): <input type="number" class="sectorInput" data-sector="${s}" min="0" max="${cap}" value="${val}" style="width:60px;" title="Active slots to fund next turn (up to capacity). Idle slots incur tax."></label>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:5px;">Total Gold Allocated: <span id="totalAllocated">0</span> / <span id="goldAvailable">${goldAvailable}</span></div>
      <div id="budgetWarning" style="color:#FFC107;"></div>
    </div>
      <div id="policySection" style="margin-bottom:5px;">
        <h4>Policies</h4>
        <div style="display:flex; gap:5px;">
          <label style="flex:1;">Tariff %: <input type="number" id="tariffRate" min="0" max="30" value="${budget.policies?.tariff ?? 0}" style="width:60px;" title="Tariffs reduce import volume but generate Gold."></label>
          <label style="flex:1;">FX Swap: <input type="number" id="fxSwap" min="0" value="${budget.policies?.fxSwap ?? 0}" style="width:60px;" title="Request Gold⇄FX conversion for next turn (fee applies)."></label>
        </div>
      </div>
      <div>
        <h4>Sector Prioritization</h4>
        <ul id="priorityList" style="list-style:none; padding:0; margin:0;">
          ${SECTORS.map(s => `<li draggable="true" data-sector="${s}" style="margin:2px 0; padding:4px; background:#333; border:1px solid #555; cursor:move;" title="Drag to reorder sector priority.">${capitalize(s)}</li>`).join('')}
        </ul>
      </div>
      <button id="submitPlanBtn" style="margin-top:10px; width:100%;" title="Submit plan for next turn.">Submit Plan</button>
  `;

  // Drag and drop ordering
  const list = container.querySelector('#priorityList') as HTMLElement;
  let dragEl: HTMLElement | null = null;
  list.addEventListener('dragstart', (e) => {
    dragEl = e.target as HTMLElement;
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    if (target && target.tagName === 'LI' && target !== dragEl) {
      const rect = target.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      list.insertBefore(dragEl!, next ? target.nextSibling : target);
    }
  });

  const eduInput = container.querySelector('#eduTier') as HTMLInputElement;
  const eduVal = container.querySelector('#eduTierVal') as HTMLElement;
  const healthInput = container.querySelector('#healthTier') as HTMLInputElement;
  const healthVal = container.querySelector('#healthTierVal') as HTMLElement;
  if (eduInput && eduVal) {
    eduInput.addEventListener('input', () => {
      eduVal.textContent = eduInput.value;
    });
  }
  if (healthInput && healthVal) {
    healthInput.addEventListener('input', () => {
      healthVal.textContent = healthInput.value;
    });
  }

  container.querySelectorAll('input').forEach((el) => {
    el.addEventListener('input', updateBudgetTotals);
  });
  updateBudgetTotals();

  container.querySelector('#submitPlanBtn')!.addEventListener('click', async () => {
    const plan = buildPlan();
    await fetch(`${SERVER_BASE_URL}/api/games/${gameId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player, plan }),
    });
  });
}

function totalCapacity(econ: any, sector: string): number {
  let total = 0;
  for (const canton of Object.values(econ.cantons || {})) {
    const s = (canton as any).sectors?.[sector];
    if (s && typeof s.capacity === 'number') total += s.capacity;
  }
  return total;
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function updateBudgetTotals() {
  const military = parseInt((document.getElementById('militaryAlloc') as HTMLInputElement)?.value || '0', 10);
  const sectorInputs = document.querySelectorAll<HTMLInputElement>('.sectorInput');
  let sectorTotal = 0;
  sectorInputs.forEach((i) => {
    sectorTotal += parseInt(i.value || '0', 10);
  });
  const welfareAlloc = 0;
  const total = military + welfareAlloc + sectorTotal;
  const totalEl = document.getElementById('totalAllocated');
  if (totalEl) totalEl.textContent = String(total);
  const warning = document.getElementById('budgetWarning');
  if (warning) {
    warning.textContent = total > goldAvailable ? 'Budget exceeds available gold' : '';
  }
}

function buildPlan() {
  const edu = parseInt((document.getElementById('eduTier') as HTMLInputElement)?.value || '0', 10);
  const health = parseInt((document.getElementById('healthTier') as HTMLInputElement)?.value || '0', 10);
  const military = parseInt((document.getElementById('militaryAlloc') as HTMLInputElement)?.value || '0', 10);
  const sectorInputs = document.querySelectorAll<HTMLInputElement>('.sectorInput');
  const sectorOM: Record<string, number> = {};
  sectorInputs.forEach((i) => {
    const sector = i.dataset.sector!;
    sectorOM[sector] = parseInt(i.value || '0', 10);
  });
  const tariff = parseInt((document.getElementById('tariffRate') as HTMLInputElement)?.value || '0', 10);
  const fxSwap = parseInt((document.getElementById('fxSwap') as HTMLInputElement)?.value || '0', 10);
  const priority = Array.from(document.querySelectorAll('#priorityList li')).map((li) => (li as HTMLElement).dataset.sector);
  return {
    budgets: { military, welfare: 0, sectorOM },
    policies: { welfare: { education: edu, healthcare: health }, tariff, fxSwap },
    slotPriorities: priority,
  } as any;
}

// Convenience function for main.ts
export function ensurePlanner() {
  initPlanner(currentGameId, currentPlayerName);
}

// Testing utility
export function __resetPlannerForTests() {
  initialized = false;
}
