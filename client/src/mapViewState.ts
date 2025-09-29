export type MapViewMode = 'nation' | 'canton';

type Listener = (mode: MapViewMode) => void;

let currentMode: MapViewMode = 'nation';
const listeners = new Set<Listener>();

export function getMapViewMode(): MapViewMode {
  return currentMode;
}

export function setMapViewMode(mode: MapViewMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  for (const listener of Array.from(listeners)) {
    listener(currentMode);
  }
}

export function onMapViewModeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetMapViewStateForTests(mode: MapViewMode = 'nation'): void {
  currentMode = mode;
  listeners.clear();
}
