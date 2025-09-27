import { MapSize } from './mesh';
import { loadOrGetMesh, generateTerrain, elevationConfig, biomeConfig, setCurrentMapSize } from './terrain';

const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: 'Industrializing Exporter', label: 'Industrializing Exporter' },
  { value: 'Agrarian Surplus', label: 'Agrarian Surplus' },
  { value: 'Finance and Services Hub', label: 'Finance and Services Hub' },
  { value: 'Research State', label: 'Research State' },
  { value: 'Defense-Manufacturing Complex', label: 'Defense-Manufacturing Complex' },
  { value: 'Balanced Mixed Economy', label: 'Balanced Mixed Economy' },
];

const DEFAULT_NATION_NAMES = [
  'Aurora Dominion',
  'Silverhaven',
  'Sunreach Coalition',
  'Northwind Pact',
  'Verdant Accord',
  'Ironcrest Union',
  'Azure Federation',
  'Highland Concordat',
  'Stormfall Republic',
  'Golden Meridian',
  'Starborne Compact',
  'Lakeshore Assembly',
  'Crimson Banner',
  'Riverlight League',
  'Thunderhold',
  'Everfree Collective',
  'Obsidian Frontier',
  'Coastwatch Alliance',
  'Celestial Ward',
  'Gilded Spire',
  'Midnight Expanse',
  'Emerald Reach',
  'Horizon Stronghold',
  'Radiant Isles',
  'Autumn Gate',
  'Frostwall Dominion',
  'Cinderveil',
  'Skyward Pact',
  'Oceanus Combine',
  'Granite Bastion',
];

type NationFormRow = {
  name: string;
  preset: string;
  errors?: { name?: string; preset?: string };
};

let nationFormState: NationFormRow[] = [];

export interface ClientNationInput {
  name: string;
  preset: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickUniqueName(existing: Set<string>): string {
  const pool = DEFAULT_NATION_NAMES.slice();
  while (pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const candidate = pool.splice(index, 1)[0];
    if (!existing.has(candidate.toLowerCase())) {
      existing.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `Nation ${existing.size + 1}`;
  existing.add(fallback.toLowerCase());
  return fallback;
}

function initializeNationForm(count: number): void {
  const usedNames = new Set<string>();
  nationFormState = Array.from({ length: count }, () => ({
    name: pickUniqueName(usedNames),
    preset: '',
  }));
}

function setNationCount(count: number): void {
  if (count < 2) count = 2;
  if (count > 25) count = 25;
  if (nationFormState.length === 0) {
    initializeNationForm(count);
    return;
  }
  const used = new Set<string>(nationFormState.map(row => row.name.toLowerCase()));
  if (count > nationFormState.length) {
    while (nationFormState.length < count) {
      nationFormState.push({ name: pickUniqueName(used), preset: '' });
    }
  } else if (count < nationFormState.length) {
    nationFormState = nationFormState.slice(0, count);
  }
}

function renderNationRows(): void {
  const container = document.getElementById('nationRows');
  if (!container) return;
  container.innerHTML = nationFormState
    .map((row, index) => {
      const presetOptions = PRESET_OPTIONS
        .map(
          option =>
            `<option value="${escapeHtml(option.value)}"${row.preset === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
        )
        .join('');
      return `
        <div id="nationRow-${index}" class="nation-row" data-index="${index}" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start;">
          <div id="nationNameColumn-${index}" style="flex: 1;">
            <input type="text" class="nation-name" data-index="${index}" value="${escapeHtml(row.name)}" placeholder="Nation name" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
            <div id="nationNameError-${index}" class="nation-error-name" style="min-height: 14px; font-size: 11px; color: #FF8A80; margin-top: 3px;">${row.errors?.name ? escapeHtml(row.errors.name) : ''}</div>
          </div>
          <div id="nationPresetColumn-${index}" style="flex: 1;">
            <select class="nation-preset" data-index="${index}" style="width: 100%; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;">
              <option value="">Select preset…</option>
              ${presetOptions}
            </select>
            <div id="nationPresetError-${index}" class="nation-error-preset" style="min-height: 14px; font-size: 11px; color: #FF8A80; margin-top: 3px;">${row.errors?.preset ? escapeHtml(row.errors.preset) : ''}</div>
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll<HTMLInputElement>('.nation-name').forEach(input => {
    const index = Number(input.dataset.index);
    input.addEventListener('input', () => {
      if (!Number.isFinite(index) || index >= nationFormState.length) return;
      nationFormState[index].name = input.value;
      if (nationFormState[index].errors) {
        delete nationFormState[index].errors!.name;
      }
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.nation-preset').forEach(select => {
    const index = Number(select.dataset.index);
    select.addEventListener('change', () => {
      if (!Number.isFinite(index) || index >= nationFormState.length) return;
      nationFormState[index].preset = select.value;
      if (nationFormState[index].errors) {
        delete nationFormState[index].errors!.preset;
      }
    });
  });
}

export function applyNationErrors(errors: Array<{ index: number; field: 'name' | 'preset'; message: string }>): void {
  nationFormState.forEach(row => {
    if (row.errors) {
      row.errors = {};
    }
  });
  for (const error of errors) {
    const row = nationFormState[error.index];
    if (!row) continue;
    if (!row.errors) row.errors = {};
    row.errors[error.field] = error.message;
  }
  renderNationRows();
}

export function collectNationPayload(): ClientNationInput[] {
  return nationFormState.map(row => ({
    name: row.name.trim(),
    preset: row.preset,
  }));
}

export function createUI(ctx: CanvasRenderingContext2D) {
  // Create UI panel
  const uiPanel = document.createElement("div");
  uiPanel.id = 'uiPanelRoot';
  uiPanel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 380px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 15px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 12px;
    max-height: 90vh;
    overflow-y: auto;
    z-index: 1000;
  `;

  uiPanel.innerHTML = `
    <div id="terrainControls">
    <h3 style="margin: 0 0 15px 0; color: #4CAF50;">Biome Terrain Controls</h3>

    <div id="islandModeContainer" style="margin-bottom: 15px;">
      <label>
        <input type="checkbox" id="useIslands" ${
          elevationConfig.useIslands ? "checked" : ""
        }>
        Island Mode
      </label>
    </div>

    <div id="smoothColorsContainer" style="margin-bottom: 15px;">
      <label>
        <input type="checkbox" id="smoothColors" ${
          biomeConfig.smoothColors ? "checked" : ""
        }>
        Smooth Colors
      </label>
    </div>

    <div id="mapSizeContainer" style="margin-bottom: 15px;">
      <label>Map Size:</label>
      <select id="mapSize" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
        <option value="small">Small</option>
        <option value="medium">Medium</option>
        <option value="large">Large</option>
        <option value="xl" selected>XL</option>
      </select>
    </div>

    <details style="margin-bottom: 15px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Biome Settings</summary>

      <div id="waterLevelContainer" style="margin-bottom: 10px;">
        <label>Water Level: <span id="waterLevelValue">${
          biomeConfig.waterLevel
        }</span></label>
        <input type="range" id="waterLevel" min="0.2" max="0.8" step="0.05" value="${
          biomeConfig.waterLevel
        }" style="width: 100%; margin-top: 5px;">
      </div>

      <div id="moistureFrequencyContainer" style="margin-bottom: 10px;">
        <label>Moisture Frequency: <span id="moistureFrequencyValue">${
          biomeConfig.moistureFrequency
        }</span></label>
        <input type="range" id="moistureFrequency" min="0.005" max="0.05" step="0.005" value="${
          biomeConfig.moistureFrequency
        }" style="width: 100%; margin-top: 5px;">
      </div>

      <div id="temperatureFrequencyContainer" style="margin-bottom: 10px;">
        <label>Temperature Frequency: <span id="temperatureFrequencyValue">${
          biomeConfig.temperatureFrequency
        }</span></label>
        <input type="range" id="temperatureFrequency" min="0.005" max="0.05" step="0.005" value="${
          biomeConfig.temperatureFrequency
        }" style="width: 100%; margin-top: 5px;">
      </div>

      <div id="moistureOctavesContainer" style="margin-bottom: 10px;">
        <label>Moisture Octaves: <span id="moistureOctavesValue">${
          biomeConfig.moistureOctaves
        }</span></label>
        <input type="range" id="moistureOctaves" min="1" max="5" step="1" value="${
          biomeConfig.moistureOctaves
        }" style="width: 100%; margin-top: 5px;">
      </div>

      <div id="temperatureOctavesContainer" style="margin-bottom: 15px;">
        <label>Temperature Octaves: <span id="temperatureOctavesValue">${
          biomeConfig.temperatureOctaves
        }</span></label>
        <input type="range" id="temperatureOctaves" min="1" max="5" step="1" value="${
          biomeConfig.temperatureOctaves
        }" style="width: 100%; margin-top: 5px;">
      </div>
      <hr></hr>
    </details>

    <div id="elevationShiftContainer" style="margin-bottom: 10px;">
      <label>Elevation Shift: <span id="elevationShiftValue">${
        elevationConfig.elevationShift
      }</span></label>
      <input type="range" id="elevationShift" min="-0.4" max="0.4" step="0.01" value="${
        elevationConfig.elevationShift
      }" style="width: 100%; margin-top: 5px;">
    </div>

    <div id="octavesContainer" style="margin-bottom: 10px;">
      <label>Octaves: <span id="octavesValue">${
        elevationConfig.octaves
      }</span></label>
      <input type="range" id="octaves" min="1" max="6" step="1" value="${
        elevationConfig.octaves
      }" style="width: 100%; margin-top: 5px;">
    </div>

    <div id="redistributionContainer" style="margin-bottom: 10px;">
      <label>Redistribution:</label>
      <select id="redistribution" style="width: 100%; margin-top: 5px; background: #333; color: white; border: 1px solid #555; padding: 4px;">
        <option value="none">None</option>
        <option value="linear">Linear</option>
        <option value="exponential" selected>Exponential</option>
      </select>
    </div>

    <div id="exponentialPowerDiv" style="margin-bottom: 10px;">
      <label>Exponential Power: <span id="exponentialPowerValue">${
        elevationConfig.exponentialPower
      }</span></label>
      <input type="range" id="exponentialPower" min="0.5" max="3" step="0.1" value="${
        elevationConfig.exponentialPower
      }" style="width: 100%; margin-top: 5px;">
    </div>

    <div id="seedContainer" style="margin-bottom: 10px;">
      <label>Seed:</label>
      <div id="seedInputGroup" style="display: flex; gap: 5px; margin-top: 5px; align-items: center;">
        <input type="number" id="seedInput" min="0" max="1" step="0.001" value="${elevationConfig.seed.toFixed(3)}" style="flex: 1; background: #333; color: white; border: 1px solid #555; padding: 4px; border-radius: 4px;">
        <button id="randomSeed" style="background: #666; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Random</button>
      </div>
    </div>

    <details style="margin-bottom: 10px;">
      <summary style="cursor: pointer; margin-bottom: 10px;">Advanced (Amplitudes & Frequencies)</summary>

      <div id="amplitudesContainer">
        <label>Amplitudes:</label>
        ${elevationConfig.amplitudes
          .map(
            (amp, i) =>
              `<div id="amplitudeControl-${i}" style="margin: 5px 0;">
            <label>Octave ${
              i + 1
            }: <span id="amp${i}Value">${amp}</span></label>
            <input type="range" id="amplitude${i}" min="0" max="1" step="0.025" value="${amp}" style="width: 100%;">
           </div>`
          )
          .join("")}
      </div>

      <div id="frequenciesContainer" style="margin-top: 10px;">
        <label>Frequencies:</label>
        ${elevationConfig.frequencies
          .map(
            (freq, i) =>
              `<div id="frequencyControl-${i}" style="margin: 5px 0;">
            <label>Octave ${
              i + 1
            }: <span id="freq${i}Value">${freq}</span></label>
            <input type="range" id="frequency${i}" min="0.001" max="0.05" step="0.001" value="${freq}" style="width: 100%;">
           </div>`
          )
          .join("")}
      </div>
    </details>

    <div id="terrainStatsSection" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
      <div id="stats"></div>
      <div id="biomeStats" style="margin-top: 10px;"></div>
    </div>

    <div id="nationControlsSection" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #555; font-size: 11px; color: #aaa;">
      <div id="nationInputsContainer" style="margin-bottom: 10px; display: grid; gap: 6px;">
        <label for="nationCount">Number of Nations (2–25):</label>
        <input type="number" id="nationCount" min="2" max="25" value="3" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px;">
        <label for="nationSeed" style="margin-top: 6px;">Seed (optional for reproducibility):</label>
        <input type="text" id="nationSeed" placeholder="Leave blank for random" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px;">
      </div>
      <div id="nationRows" style="margin-bottom: 10px;"></div>
      <div id="gameActionButtons" style="display: flex; gap: 10px; margin-bottom: 10px;">
        <button id="createGame" style="flex: 1; background: #4CAF50; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Create Game</button>
        <button id="joinGame" style="flex: 1; background: #2196F3; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">Join Game</button>
      </div>
    </div>
    </div>
    <div id="gameState" style="display: none;"></div>
    <div id="gameControls" style="display: none; margin-top: 12px;"></div>
  `;

  document.body.appendChild(uiPanel);

  const nationCountInput = document.getElementById("nationCount") as HTMLInputElement;
  const nationSeedInput = document.getElementById("nationSeed") as HTMLInputElement;

  const initialCount = Number(nationCountInput.value) || 3;
  setNationCount(initialCount);
  renderNationRows();

  nationCountInput.addEventListener('change', () => {
    const value = Number(nationCountInput.value) || initialCount;
    setNationCount(value);
    renderNationRows();
  });

  // Map size selectors
  document.getElementById("mapSize")!.addEventListener("change", async (e) => {
    const size = (e.target as HTMLSelectElement).value as MapSize;
    if (size) {
      setCurrentMapSize(size);
      await loadOrGetMesh(size, ctx);
    }
  });

  document.getElementById("randomSeed")!.addEventListener("click", () => {
    elevationConfig.seed = Math.random();
    (document.getElementById("seedInput") as HTMLInputElement).value =
      elevationConfig.seed.toFixed(3);
    generateTerrain(ctx);
  });

  // Seed input
  document.getElementById("seedInput")!.addEventListener("input", (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      elevationConfig.seed = Math.max(0, Math.min(1, value));
      generateTerrain(ctx);
    }
  });

  // Range inputs - all auto-regenerate
  ["elevationShift", "octaves", "exponentialPower"].forEach((param) => {
    const element = document.getElementById(param)!;
    element.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (elevationConfig as any)[param] =
        param === "octaves" ? Math.floor(value) : value;
      document.getElementById(param + "Value")!.textContent = value.toString();
      generateTerrain(ctx);
    });
  });

  // Biome config inputs
  [
    "waterLevel",
    "moistureFrequency",
    "temperatureFrequency",
    "moistureOctaves",
    "temperatureOctaves",
  ].forEach((param) => {
    const element = document.getElementById(param)!;
    element.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      (biomeConfig as any)[param] = [
        "moistureOctaves",
        "temperatureOctaves",
      ].includes(param)
        ? Math.floor(value)
        : value;
      document.getElementById(param + "Value")!.textContent = value.toString();
      generateTerrain(ctx);
    });
  });

  // Redistribution
  document.getElementById("redistribution")!.addEventListener("change", (e) => {
    elevationConfig.redistribution = (e.target as HTMLSelectElement)
      .value as any;
    document.getElementById("exponentialPowerDiv")!.style.display =
      elevationConfig.redistribution === "exponential" ? "block" : "none";
    generateTerrain(ctx);
  });

  // Islands checkbox
  document.getElementById("useIslands")!.addEventListener("change", (e) => {
    elevationConfig.useIslands = (e.target as HTMLInputElement).checked;
    generateTerrain(ctx);
  });

  // Smooth colors checkbox
  document.getElementById("smoothColors")!.addEventListener("change", (e) => {
    biomeConfig.smoothColors = (e.target as HTMLInputElement).checked;
    generateTerrain(ctx); // Re-render with new color smoothing
  });

  // Amplitude and frequency controls - auto-regenerate
  for (let i = 0; i < 4; i++) {
    const ampElement = document.getElementById(`amplitude${i}`);
    const freqElement = document.getElementById(`frequency${i}`);

    if (ampElement) {
      ampElement.addEventListener("input", (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.amplitudes[i] = value;
        document.getElementById(`amp${i}Value`)!.textContent = value.toString();
        generateTerrain(ctx);
      });
    }

    if (freqElement) {
      freqElement.addEventListener("input", (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        elevationConfig.frequencies[i] = value;
        document.getElementById(`freq${i}Value`)!.textContent =
          value.toString();
        generateTerrain(ctx);
      });
    }
  }
}

export function hideTerrainControls() {
  const controls = document.getElementById('terrainControls');
  if (controls) controls.style.display = 'none';
}
