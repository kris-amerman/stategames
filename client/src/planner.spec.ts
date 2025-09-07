import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showNationPlanner, hideNationPlanner } from './planner';

describe('Nation Planner UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="gameControls" style="display:none"></div>';
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ budgets:{military:0,welfare:0,sectorOM:{}}, policies:{welfare:{education:0,healthcare:0}}, slotPriorities:{} }) });
  });

  it('is hidden until shown and can be hidden again', async () => {
    const state = { economy: { resources:{ gold:100 }, cantons:{} } } as any;
    await showNationPlanner(state, 'g1', 'p1');
    const container = document.getElementById('gameControls')!;
    expect(container.style.display).toBe('block');
    hideNationPlanner();
    expect(container.style.display).toBe('none');
  });

  it('updates warnings for overspend and welfare shortfall', async () => {
    const state = { economy: { resources:{ gold:100 }, cantons:{ A:{ labor:{general:50,skilled:0,specialist:0}, sectors:{}, suitability:{} } } } } as any;
    await showNationPlanner(state, 'g1', 'p1');
    const military = document.getElementById('budget-military') as HTMLInputElement;
    const welfare = document.getElementById('budget-welfare') as HTMLInputElement;
    military.value = '80';
    welfare.value = '30';
    military.dispatchEvent(new Event('input'));
    expect((document.getElementById('overspendWarning') as HTMLElement).style.display).toBe('block');
    (document.getElementById('welfare-edu') as HTMLInputElement).value = '4';
    (document.getElementById('welfare-health') as HTMLInputElement).value = '4';
    welfare.value = '50';
    welfare.dispatchEvent(new Event('input'));
    expect((document.getElementById('welfareWarning') as HTMLElement).style.display).toBe('block');
  });

  it('sends plan payload to backend', async () => {
    const state = { economy: { resources:{ gold:100 }, cantons:{} } } as any;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok:true, json: async ()=> ({ budgets:{}, policies:{welfare:{education:0,healthcare:0}}, slotPriorities:{} }) })
      .mockResolvedValue({ ok:true, json: async ()=> ({}) });
    (global as any).fetch = fetchMock;
    await showNationPlanner(state, 'g1', 'p1');
    (document.getElementById('budget-military') as HTMLInputElement).value = '10';
    (document.getElementById('submitPlan') as HTMLButtonElement).click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.playerId).toBe('p1');
    expect(body.plan.budgets.military).toBe(10);
  });
});
