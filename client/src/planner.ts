import { fetchPlan, submitTurnPlan } from './network';

const sectors = ['agriculture','manufacturing','energy'];
const EDUCATION_COST = [0,0.25,0.5,0.75,1];
const HEALTHCARE_COST = [0,0.25,0.5,0.75,1];

let currentState: any;
let gameId: string;
let playerId: string;
let availableGold = 0;
let militaryUpkeep = 0;
let initialized = false;

export async function showNationPlanner(state:any, gId:string, pId:string) {
  currentState = state;
  gameId = gId;
  playerId = pId;
  availableGold = state.economy?.resources?.gold || 0;
  militaryUpkeep = state.economy?.militaryUpkeep || 0;
  const container = document.getElementById('gameControls');
  if (!container) return;
  container.style.display = 'block';
  if (!initialized || !container.hasChildNodes()) {
    container.innerHTML = renderPlanner();
    setupHandlers();
    initialized = true;
  }
  await loadPlan();
  updateSectorStatus();
  updateBudgetTotals();
}

export function hideNationPlanner() {
  const container = document.getElementById('gameControls');
  if (container) container.style.display = 'none';
}

function renderPlanner(): string {
  return `
    <details id="nationPlanner">
      <summary>Nation Planner</summary>
      <div id="plannerWarnings">
        <div id="overspendWarning" style="display:none;color:orange;">Overspending Gold</div>
        <div id="militaryWarning" style="display:none;color:orange;">Military upkeep gap</div>
        <div id="welfareWarning" style="display:none;color:orange;">Welfare tiers will auto-reduce</div>
      </div>
      <section id="plannerBudgets">
        <h4>Budgets</h4>
        <div>Gold Allocated: <span id="goldAllocated">0</span> / <span id="goldAvailable"></span></div>
        <label>Military: <input type="number" id="budget-military" min="0" value="0"></label>
        <label>Welfare: <input type="number" id="budget-welfare" min="0" value="0"></label>
        <label>Education Tier: <input type="number" id="welfare-edu" min="0" max="4" value="0"></label>
        <label>Healthcare Tier: <input type="number" id="welfare-health" min="0" max="4" value="0"></label>
        <div id="sectorBudgets">
          ${sectors.map(s=>`<div><label>${capitalize(s)}: <input type="number" id="sector-${s}" min="0" value="0"></label></div>`).join('')}
        </div>
      </section>
      <section id="plannerPriorities">
        <h4>Sector Prioritization</h4>
        <ul id="sectorList" style="list-style:none;padding:0;">
          ${sectors.map(s=>`<li data-sector="${s}">${capitalize(s)} <button class="up">↑</button><button class="down">↓</button><span class="status" id="status-${s}"></span></li>`).join('')}
        </ul>
      </section>
      <section id="plannerPolicies">
        <h4>Policies</h4>
        <label>Tariff Rate (%): <input type="number" id="policy-tariff" min="0" max="100" value="0"></label>
        <label>FX Swap: <input type="number" id="policy-fxswap" min="0" value="0"></label>
      </section>
      <button id="submitPlan">Submit Plan</button>
    </details>
  `;
}

function capitalize(s:string){return s.charAt(0).toUpperCase()+s.slice(1);}

function setupHandlers() {
  const inputs = document.querySelectorAll('#plannerBudgets input');
  inputs.forEach(el => el.addEventListener('input', updateBudgetTotals));
  document.getElementById('sectorList')!.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('up') || target.classList.contains('down')) {
      const li = target.parentElement as HTMLElement;
      if (target.classList.contains('up') && li.previousElementSibling) {
        li.parentElement!.insertBefore(li, li.previousElementSibling);
      } else if (target.classList.contains('down') && li.nextElementSibling) {
        li.parentElement!.insertBefore(li.nextElementSibling!, li);
      }
    }
  });
  document.getElementById('submitPlan')!.addEventListener('click', submitCurrentPlan);
  (document.getElementById('goldAvailable') as HTMLElement).textContent = String(availableGold);
}

async function loadPlan() {
  try {
    const plan = await fetchPlan(gameId);
    if (plan?.budgets) {
      (document.getElementById('budget-military') as HTMLInputElement).value = plan.budgets.military ?? 0;
      (document.getElementById('budget-welfare') as HTMLInputElement).value = plan.budgets.welfare ?? 0;
      for (const s of sectors) {
        const val = plan.budgets.sectorOM?.[s] ?? 0;
        (document.getElementById(`sector-${s}`) as HTMLInputElement).value = val;
      }
    }
    if (plan?.policies?.welfare) {
      (document.getElementById('welfare-edu') as HTMLInputElement).value = plan.policies.welfare.education ?? 0;
      (document.getElementById('welfare-health') as HTMLInputElement).value = plan.policies.welfare.healthcare ?? 0;
    }
    if (plan?.policies) {
      (document.getElementById('policy-tariff') as HTMLInputElement).value = (plan.policies.tariff ?? 0) * 100;
      (document.getElementById('policy-fxswap') as HTMLInputElement).value = plan.policies.fxSwap ?? 0;
    }
  } catch { /* ignore */ }
}

function getSectorOrder(): string[] {
  return Array.from(document.querySelectorAll('#sectorList li')).map(li => (li as HTMLElement).dataset['sector']!);
}

function updateSectorStatus() {
  for (const sector of sectors) {
    let funded = 0, idle = 0;
    for (const canton of Object.values(currentState.economy.cantons || {})) {
      const st = (canton as any).sectors?.[sector];
      if (st) {
        funded += st.funded || 0;
        idle += st.idle || 0;
      }
    }
    const span = document.getElementById(`status-${sector}`);
    if (span) span.textContent = ` (Funded: ${funded}, Idle: ${idle}, Stalled: 0)`;
  }
}

function computeLabor(economy:any): number {
  let total = 0;
  for (const canton of Object.values(economy.cantons || {})) {
    const l = (canton as any).labor || {general:0,skilled:0,specialist:0};
    total += l.general + l.skilled + l.specialist;
  }
  return total;
}

function updateBudgetTotals() {
  const military = Number((document.getElementById('budget-military') as HTMLInputElement).value) || 0;
  const welfare = Number((document.getElementById('budget-welfare') as HTMLInputElement).value) || 0;
  let sectorsSum = 0;
  for (const s of sectors) {
    sectorsSum += Number((document.getElementById(`sector-${s}`) as HTMLInputElement).value) || 0;
  }
  const total = military + welfare + sectorsSum;
  (document.getElementById('goldAllocated') as HTMLElement).textContent = String(total);

  const overspend = total > availableGold;
  (document.getElementById('overspendWarning') as HTMLElement).style.display = overspend ? 'block' : 'none';
  (document.getElementById('militaryWarning') as HTMLElement).style.display = military < militaryUpkeep ? 'block' : 'none';

  const edu = Number((document.getElementById('welfare-edu') as HTMLInputElement).value) || 0;
  const health = Number((document.getElementById('welfare-health') as HTMLInputElement).value) || 0;
  const labor = computeLabor(currentState.economy);
  const welfareCost = labor * (EDUCATION_COST[edu] + HEALTHCARE_COST[health]);
  (document.getElementById('welfareWarning') as HTMLElement).style.display = welfare < welfareCost ? 'block' : 'none';
}

async function submitCurrentPlan() {
  updateBudgetTotals();
  if ((document.getElementById('overspendWarning') as HTMLElement).style.display === 'block') return;
  const plan: any = {
    budgets: {
      military: Number((document.getElementById('budget-military') as HTMLInputElement).value) || 0,
      welfare: Number((document.getElementById('budget-welfare') as HTMLInputElement).value) || 0,
      sectorOM: {} as any,
    },
    policies: {
      welfare: {
        education: Number((document.getElementById('welfare-edu') as HTMLInputElement).value) || 0,
        healthcare: Number((document.getElementById('welfare-health') as HTMLInputElement).value) || 0,
      },
      tariff: (Number((document.getElementById('policy-tariff') as HTMLInputElement).value) || 0) / 100,
      fxSwap: Number((document.getElementById('policy-fxswap') as HTMLInputElement).value) || 0,
    },
    slotPriorities: {} as any,
  };
  for (const s of sectors) {
    const v = Number((document.getElementById(`sector-${s}`) as HTMLInputElement).value) || 0;
    if (v) plan.budgets.sectorOM[s] = v;
  }
  const order = getSectorOrder();
  order.forEach((s,i)=> plan.slotPriorities[s] = i);
  try {
    await submitTurnPlan(gameId, playerId, plan);
  } catch (e) {
    console.error(e);
  }
}
