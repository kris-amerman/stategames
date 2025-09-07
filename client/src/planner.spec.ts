import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUI } from './ui';
import { togglePlanner, initPlanner, updateBudgetTotals, __resetPlannerForTests } from './planner';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

(runInVitest ? describe : describe.skip)('nation planner ui', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    __resetPlannerForTests();
  });

  it('planner hidden until shown', () => {
    createUI({} as CanvasRenderingContext2D);
    const controls = document.getElementById('gameControls')!;
    expect(controls.style.display).toBe('none');
    togglePlanner(true);
    expect(controls.style.display).toBe('block');
  });

  it('welfare tiers use sliders', async () => {
    createUI({} as CanvasRenderingContext2D);
    togglePlanner(true);
    const mockFetch = vi.fn((url: string) => {
      if (url.includes('/economy')) {
        return Promise.resolve(new Response(JSON.stringify({ resources: { gold: 100 }, cantons: {} })));
      }
      if (url.includes('/budget')) {
        return Promise.resolve(new Response(JSON.stringify({ military: 0, welfare: 0, sectorOM: {} })));
      }
      if (url.includes('/welfare')) {
        return Promise.resolve(new Response(JSON.stringify({ current: { education:0, healthcare:0, socialSupport:0 }, next: { education:0, healthcare:0, socialSupport:0 } })));
      }
      return Promise.resolve(new Response('{}'));
    });
    (globalThis as any).fetch = mockFetch;
    await initPlanner('g1', 'p1');
    const edu = document.getElementById('eduTier') as HTMLInputElement;
    const health = document.getElementById('healthTier') as HTMLInputElement;
    expect(edu.type).toBe('range');
    expect(health.type).toBe('range');
  });

  it('controls include hover tooltips', async () => {
    createUI({} as CanvasRenderingContext2D);
    togglePlanner(true);
    const mockFetch = vi.fn((url: string) => {
      if (url.includes('/economy')) {
        return Promise.resolve(new Response(JSON.stringify({ resources: { gold: 100 }, cantons: {} })));
      }
      if (url.includes('/budget')) {
        return Promise.resolve(new Response(JSON.stringify({ military: 0, welfare: 0, sectorOM: {} })));
      }
      if (url.includes('/welfare')) {
        return Promise.resolve(new Response(JSON.stringify({ current: { education:0, healthcare:0, socialSupport:0 }, next: { education:0, healthcare:0, socialSupport:0 } })));
      }
      return Promise.resolve(new Response('{}'));
    });
    (globalThis as any).fetch = mockFetch;
    await initPlanner('g1', 'p1');
    const controls: HTMLElement[] = [
      document.getElementById('eduTier')!,
      document.getElementById('healthTier')!,
      document.getElementById('militaryAlloc')!,
      document.getElementById('tariffRate')!,
      document.getElementById('fxSwap')!,
      ...Array.from(document.querySelectorAll('.sectorInput')),
      ...Array.from(document.querySelectorAll('#priorityList li')),
      document.getElementById('submitPlanBtn')!
    ];
    controls.forEach((el) => {
      expect(el.getAttribute('title')).toBeTruthy();
    });
  });

  it('budget warnings trigger on overspend', async () => {
    createUI({} as CanvasRenderingContext2D);
    togglePlanner(true);
    const mockFetch = vi.fn((url: string) => {
      if (url.includes('/economy')) {
        return Promise.resolve(new Response(JSON.stringify({ resources: { gold: 100 }, cantons: {} })));
      }
      if (url.includes('/budget')) {
        return Promise.resolve(new Response(JSON.stringify({ military: 0, welfare: 0, sectorOM: {} })));
      }
      if (url.includes('/welfare')) {
        return Promise.resolve(new Response(JSON.stringify({ current: { education:0, healthcare:0, socialSupport:0 }, next: { education:0, healthcare:0, socialSupport:0 } })));
      }
      return Promise.resolve(new Response('{}'));
    });
    (globalThis as any).fetch = mockFetch;
    await initPlanner('g1', 'p1');
    const mil = document.getElementById('militaryAlloc') as HTMLInputElement;
    const firstSector = document.querySelector('.sectorInput') as HTMLInputElement;
    mil.value = '80';
    firstSector.value = '30';
    updateBudgetTotals();
    expect(document.getElementById('budgetWarning')!.textContent).toContain('Budget exceeds');
    mil.value = '20';
    firstSector.value = '10';
    updateBudgetTotals();
    expect(document.getElementById('budgetWarning')!.textContent).toBe('');
  });
});
