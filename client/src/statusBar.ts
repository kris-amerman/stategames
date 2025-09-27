type NationStatusSummary = {
  gold: { value: number; isDebt: boolean };
  stockpiles: Record<'fx' | 'food' | 'ordnance' | 'production' | 'luxury' | 'materials', { current: number; delta: number }>;
  flows: { energy: number; logistics: number; research: number };
  labor: { general: number; skilled: number; specialist: number };
  happiness: { value: number; emoji: string };
};

type NationSnapshot = {
  finance?: { treasury?: number; debt?: number };
  status?: NationStatusSummary;
  stockpiles?: { fx?: number; food?: number; ordnance?: number; production?: number; luxury?: number; materials?: number };
  energy?: { supply?: number };
  logistics?: { supply?: number };
  labor?: { available?: { general?: number; skilled?: number; specialist?: number }; happiness?: number };
};

type GameSnapshot = {
  nations?: Record<string, NationSnapshot>;
};

let initialized = false;

const STOCK_ORDER: Array<{ key: keyof NationStatusSummary['stockpiles']; label: string }> = [
  { key: 'fx', label: 'FX' },
  { key: 'food', label: 'Food' },
  { key: 'ordnance', label: 'Ordnance' },
  { key: 'production', label: 'Production' },
  { key: 'luxury', label: 'Luxury' },
  { key: 'materials', label: 'Material' },
];

const FLOW_ORDER: Array<{ key: keyof NationStatusSummary['flows']; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'research', label: 'Research' },
];

const LABOR_ORDER: Array<{ key: keyof NationStatusSummary['labor']; label: string }> = [
  { key: 'general', label: 'General Labor' },
  { key: 'skilled', label: 'Skilled Labor' },
  { key: 'specialist', label: 'Specialized Labor' },
];

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

function formatDelta(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `-${formatNumber(Math.abs(value))}`;
  return '+0';
}

function ensureElement(id: string, tag: keyof HTMLElementTagNameMap, parent: HTMLElement): HTMLElement {
  let existing = document.getElementById(id);
  if (existing) return existing;
  const el = document.createElement(tag);
  el.id = id;
  parent.appendChild(el);
  return el;
}

export function initializeStatusBar(): void {
  if (initialized) return;
  const root = document.createElement('div');
  root.id = 'statusBarRoot';
  root.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 6px 16px;
    background: rgba(10, 12, 14, 0.92);
    color: #f2f2f2;
    font-family: 'Inter', Arial, sans-serif;
    font-size: 12px;
    z-index: 1200;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  `;

  const gold = document.createElement('div');
  gold.id = 'statusGold';
  gold.style.fontWeight = '600';
  root.appendChild(gold);

  const stockGroup = document.createElement('div');
  stockGroup.id = 'statusStockGroup';
  stockGroup.style.display = 'flex';
  stockGroup.style.flexWrap = 'wrap';
  stockGroup.style.gap = '12px';
  root.appendChild(stockGroup);

  STOCK_ORDER.forEach(({ key, label }) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-stock-item';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '4px';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.color = '#9fb3c8';
    const valueSpan = document.createElement('span');
    valueSpan.id = `statusStock-${key}`;
    valueSpan.textContent = '0 (+0)';
    wrapper.appendChild(labelSpan);
    wrapper.appendChild(valueSpan);
    stockGroup.appendChild(wrapper);
  });

  const divider = document.createElement('div');
  divider.textContent = '|';
  divider.style.opacity = '0.6';
  divider.style.fontSize = '13px';
  root.appendChild(divider);

  const flowGroup = document.createElement('div');
  flowGroup.id = 'statusFlowGroup';
  flowGroup.style.display = 'flex';
  flowGroup.style.flexWrap = 'wrap';
  flowGroup.style.gap = '12px';
  root.appendChild(flowGroup);

  FLOW_ORDER.forEach(({ key, label }) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-flow-item';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '4px';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.color = '#9fb3c8';
    const valueSpan = document.createElement('span');
    valueSpan.id = `statusFlow-${key}`;
    valueSpan.textContent = '0';
    wrapper.appendChild(labelSpan);
    wrapper.appendChild(valueSpan);
    flowGroup.appendChild(wrapper);
  });

  const flowLaborDivider = document.createElement('div');
  flowLaborDivider.textContent = '|';
  flowLaborDivider.style.opacity = '0.6';
  flowLaborDivider.style.fontSize = '13px';
  flowGroup.appendChild(flowLaborDivider);

  LABOR_ORDER.forEach(({ key, label }) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-labor-item';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '4px';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.color = '#9fb3c8';
    const valueSpan = document.createElement('span');
    valueSpan.id = `statusLabor-${key}`;
    valueSpan.textContent = '0';
    wrapper.appendChild(labelSpan);
    wrapper.appendChild(valueSpan);
    flowGroup.appendChild(wrapper);
  });

  const happiness = document.createElement('div');
  happiness.id = 'statusHappiness';
  happiness.textContent = '🙂 0';
  happiness.style.display = 'flex';
  happiness.style.gap = '6px';
  happiness.style.alignItems = 'center';
  flowGroup.appendChild(happiness);

  document.body.appendChild(root);
  initialized = true;
}

function resolveNation(snapshot: GameSnapshot | null, playerId: string | null): NationSnapshot | null {
  if (!snapshot || !snapshot.nations) return null;
  if (playerId && snapshot.nations[playerId]) return snapshot.nations[playerId];
  const firstEntry = Object.values(snapshot.nations)[0];
  return firstEntry ?? null;
}

export function updateStatusBarFromGameState(snapshot: GameSnapshot | null, playerId: string | null): void {
  if (!initialized) return;
  const root = document.getElementById('statusBarRoot');
  if (!root) return;

  const nation = resolveNation(snapshot, playerId);
  if (!nation) {
    ensureElement('statusGold', 'div', root).textContent = 'Gold: 0';
    STOCK_ORDER.forEach(({ key }) => {
      const el = document.getElementById(`statusStock-${key}`);
      if (el) el.textContent = '0 (+0)';
    });
    FLOW_ORDER.forEach(({ key }) => {
      const el = document.getElementById(`statusFlow-${key}`);
      if (el) el.textContent = '0';
    });
    LABOR_ORDER.forEach(({ key }) => {
      const el = document.getElementById(`statusLabor-${key}`);
      if (el) el.textContent = '0';
    });
    const happiness = document.getElementById('statusHappiness');
    if (happiness) happiness.textContent = '😐 0';
    return;
  }

  const status = nation.status;

  const debt = nation.finance?.debt ?? 0;
  const treasury = nation.finance?.treasury ?? 0;
  const goldValue = debt > 0 ? -Math.abs(debt) : treasury;
  const goldEl = document.getElementById('statusGold');
  if (goldEl) {
    goldEl.textContent = `Gold: ${formatNumber(goldValue)}`;
    goldEl.style.color = debt > 0 ? '#FF6B6B' : '#f2f2f2';
  }

  STOCK_ORDER.forEach(({ key }) => {
    const el = document.getElementById(`statusStock-${key}`);
    if (!el) return;
    if (status?.stockpiles?.[key]) {
      const snapshot = status.stockpiles[key];
      el.textContent = `${formatNumber(snapshot.current)} (${formatDelta(snapshot.delta)})`;
    } else {
      const current = (nation.stockpiles as any)?.[key] ?? 0;
      el.textContent = `${formatNumber(current)} (+0)`;
    }
  });

  FLOW_ORDER.forEach(({ key }) => {
    const el = document.getElementById(`statusFlow-${key}`);
    if (!el) return;
    const value = status?.flows?.[key] ??
      (key === 'energy' ? nation.energy?.supply : key === 'logistics' ? nation.logistics?.supply : 0) ?? 0;
    el.textContent = formatNumber(value);
  });

  LABOR_ORDER.forEach(({ key }) => {
    const el = document.getElementById(`statusLabor-${key}`);
    if (!el) return;
    const value = status?.labor?.[key] ?? nation.labor?.available?.[key] ?? 0;
    el.textContent = formatNumber(value);
  });

  const happinessValue = status?.happiness?.value ?? Math.round((nation.labor?.happiness ?? 0) * 100);
  const happinessEmoji = status?.happiness?.emoji ?? '😐';
  const happinessEl = document.getElementById('statusHappiness');
  if (happinessEl) {
    happinessEl.textContent = `${happinessEmoji} ${happinessValue}`;
  }
}
