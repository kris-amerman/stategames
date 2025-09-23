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

  it('creates game controls container hidden by default', () => {
    createUI({} as CanvasRenderingContext2D);
    const controls = document.getElementById('gameControls');
    expect(controls).not.toBeNull();
    expect(controls?.style.display).toBe('none');
  });
});
