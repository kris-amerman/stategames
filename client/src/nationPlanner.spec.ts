import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUI } from './ui';
import { __testing as plannerTesting } from './nationPlanner';

interface FetchCall { url: string; options?: any }

const baseData = {
  state: {
    gold: 1000,
    militaryUpkeep: 100,
    welfare: { educationTier: 1, healthcareTier: 2 },
    sectors: [
      { name: 'Agriculture', capacity: 3, activeSlots: 2 },
      { name: 'Industry', capacity: 2, activeSlots: 1 },
    ],
    tariffBounds: { min: 0, max: 20 },
    fxSwapCap: 500,
  },
  plan: {
    military: 100,
    educationTier: 1,
    healthcareTier: 2,
    sectors: { Agriculture: 2, Industry: 1 },
    priority: ['Agriculture', 'Industry'],
    tariff: 5,
    fxSwap: 0,
  },
  activePlayer: true,
};

let fetchCalls: FetchCall[];

function mockFetch(data = baseData) {
  fetchCalls = [];
  (globalThis as any).fetch = vi.fn(async (url: string, options?: any) => {
    fetchCalls.push({ url, options });
    if (!options) {
      return { json: async () => JSON.parse(JSON.stringify(data)) } as any;
    }
    return { json: async () => ({ ok: true }) } as any;
  });
}

async function openPlanner() {
  const details = document.getElementById('nationPlanner') as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('Nation Planner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    plannerTesting().reset();
  });

  it('renders under gameState', async () => {
    mockFetch();
    createUI({} as any);
    const gameControls = document.getElementById('gameControls');
    expect(gameControls).toBeTruthy();
    await openPlanner();
    expect(document.getElementById('budgetsPanel')).toBeTruthy();
    expect(document.getElementById('priorityPanel')).toBeTruthy();
    expect(document.getElementById('policyPanel')).toBeTruthy();
  });

  it('loads initial state', async () => {
    mockFetch();
    createUI({} as any);
    await openPlanner();
    const mil = document.getElementById('militaryInput') as HTMLInputElement;
    expect(mil.value).toBe('100');
    const edu = document.getElementById('eduTier') as HTMLInputElement;
    expect(edu.value).toBe('1');
  });

  it('edits update preview totals', async () => {
    mockFetch();
    createUI({} as any);
    await openPlanner();
    const mil = document.getElementById('militaryInput') as HTMLInputElement;
    mil.value = '50';
    mil.dispatchEvent(new Event('input'));
    const remaining = document.getElementById('remainingGold')!;
    expect(remaining.textContent).toBe('650');
    const gap = document.getElementById('upkeepGap')!;
    expect(gap.textContent).toBe('50');
  });

  it('enforces tier change limit', async () => {
    mockFetch();
    createUI({} as any);
    await openPlanner();
    const edu = document.getElementById('eduTier') as HTMLInputElement;
    edu.value = '3';
    edu.dispatchEvent(new Event('input'));
    const err = document.getElementById('welfareError')!;
    expect(err.textContent).not.toBe('');
  });

  it('submits plan payload', async () => {
    mockFetch();
    createUI({} as any);
    await openPlanner();
    const mil = document.getElementById('militaryInput') as HTMLInputElement;
    mil.value = '120';
    mil.dispatchEvent(new Event('input'));
    const submit = document.getElementById('submitPlan')!;
    submit.dispatchEvent(new Event('click'));
    expect(fetchCalls[1].url).toBe('/api/nation/plan');
    const payload = JSON.parse(fetchCalls[1].options.body);
    expect(payload.budgets.military).toBe(120);
  });

  it('disables editing when not active', async () => {
    mockFetch({ ...baseData, activePlayer: false });
    createUI({} as any);
    await openPlanner();
    const mil = document.getElementById('militaryInput') as HTMLInputElement;
    expect(mil.disabled).toBe(true);
  });

  it('keeps edits after closing and reopening', async () => {
    mockFetch();
    createUI({} as any);
    await openPlanner();
    const mil = document.getElementById('militaryInput') as HTMLInputElement;
    mil.value = '200';
    mil.dispatchEvent(new Event('input'));
    const details = document.getElementById('nationPlanner') as HTMLDetailsElement;
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect((document.getElementById('militaryInput') as HTMLInputElement).value).toBe('200');
  });
});

