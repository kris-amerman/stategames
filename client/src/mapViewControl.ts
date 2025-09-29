import { getMapViewMode, onMapViewModeChange, setMapViewMode, MapViewMode } from './mapViewState';

let controlRoot: HTMLDivElement | null = null;
let unsubscribe: (() => void) | null = null;

function applyButtonState(container: HTMLDivElement, mode: MapViewMode) {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-mode]'));
  for (const button of buttons) {
    const targetMode = button.dataset.mode as MapViewMode | undefined;
    const active = targetMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'transparent';
    button.style.color = active ? '#ffffff' : '#d7d7d7';
  }
}

function ensureContainerPosition(container: HTMLElement) {
  const style = window.getComputedStyle(container);
  if (style.position === 'static' || !style.position) {
    container.style.position = 'relative';
  }
}

function createToggleButton(label: string, mode: MapViewMode): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.mode = mode;
  button.textContent = label;
  button.style.cssText = `
    border: none;
    background: transparent;
    color: inherit;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    transition: background 0.2s ease;
  `;
  button.addEventListener('click', () => setMapViewMode(mode));
  return button;
}

export function initializeMapViewControl(canvasContainer: HTMLElement): HTMLDivElement {
  if (controlRoot) {
    return controlRoot;
  }

  ensureContainerPosition(canvasContainer);

  const root = document.createElement('div');
  root.id = 'mapViewControlRoot';
  root.style.cssText = `
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #f5f5f5;
    border-radius: 999px;
    padding: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    z-index: 1200;
    pointer-events: auto;
    font-family: 'Segoe UI', Arial, sans-serif;
  `;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Map View Mode');

  const nationButton = createToggleButton('Nation', 'nation');
  const cantonButton = createToggleButton('Canton', 'canton');

  root.appendChild(nationButton);
  root.appendChild(cantonButton);

  const updateButtons = (mode: MapViewMode) => {
    applyButtonState(root, mode);
  };

  unsubscribe = onMapViewModeChange(updateButtons);
  updateButtons(getMapViewMode());

  root.addEventListener('pointerenter', () => {
    root.style.background = 'rgba(0, 0, 0, 0.72)';
  });
  root.addEventListener('pointerleave', () => {
    root.style.background = 'rgba(0, 0, 0, 0.6)';
  });

  const styleObserver = new MutationObserver(() => {
    if (!canvasContainer.contains(root)) {
      styleObserver.disconnect();
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      controlRoot = null;
    }
  });
  styleObserver.observe(canvasContainer, { childList: true });

  canvasContainer.appendChild(root);
  controlRoot = root;
  return root;
}

export function resetMapViewControlForTests() {
  if (controlRoot?.parentElement) {
    controlRoot.parentElement.removeChild(controlRoot);
  }
  controlRoot = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
