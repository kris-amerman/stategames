import { describe, it, expect, beforeEach } from 'vitest';
import { createUI } from './ui';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

(runInVitest ? describe : describe.skip)('createUI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('appends a UI panel to the document', () => {
    createUI({} as CanvasRenderingContext2D);
    const panel = document.body.querySelector('div');
    expect(panel).not.toBeNull();
  });

  it('includes budget controls in the nation planner', () => {
    createUI({} as CanvasRenderingContext2D);

    const planner = document.getElementById('nationPlanner');
    expect(planner).not.toBeNull();

    ['military', 'welfare', 'sectorOps', 'maintenance'].forEach(type => {
      expect(document.getElementById(`${type}Budget`)).not.toBeNull();
      expect(document.getElementById(`${type}BudgetInfo`)).not.toBeNull();
    });
  });
});
