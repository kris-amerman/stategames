import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeMapViewControl, resetMapViewControlForTests } from './mapViewControl';
import { setMapViewMode, resetMapViewStateForTests } from './mapViewState';

const runInVitest = typeof (globalThis as any).Bun === 'undefined';

(runInVitest ? describe : describe.skip)('map view control', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="canvas-container" style="position: relative; width: 800px; height: 600px;"></div>
      <div id="uiPanelRoot"></div>
      <div id="debugSidebarRoot"></div>
    `;
    resetMapViewStateForTests();
    resetMapViewControlForTests();
  });

  afterEach(() => {
    resetMapViewControlForTests();
    resetMapViewStateForTests();
  });

  it('mounts control directly on top of the canvas container', () => {
    const container = document.getElementById('canvas-container') as HTMLDivElement;
    const control = initializeMapViewControl(container);

    expect(control.parentElement).toBe(container);
    expect(control.id).toBe('mapViewControlRoot');
    expect(control.style.position).toBe('absolute');

    const uiPanel = document.getElementById('uiPanelRoot') as HTMLDivElement;
    const debugRoot = document.getElementById('debugSidebarRoot') as HTMLDivElement;

    expect(uiPanel.contains(control)).toBe(false);
    expect(debugRoot.contains(control)).toBe(false);
  });

  it('updates the active state when switching modes', () => {
    const container = document.getElementById('canvas-container') as HTMLDivElement;
    const control = initializeMapViewControl(container);
    const buttons = control.querySelectorAll<HTMLButtonElement>('button[data-mode]');

    setMapViewMode('canton');

    const cantonButton = Array.from(buttons).find((btn) => btn.dataset.mode === 'canton');
    const nationButton = Array.from(buttons).find((btn) => btn.dataset.mode === 'nation');

    expect(cantonButton?.getAttribute('aria-pressed')).toBe('true');
    expect(nationButton?.getAttribute('aria-pressed')).toBe('false');
  });
});
