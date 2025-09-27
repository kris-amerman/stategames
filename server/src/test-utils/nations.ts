import type { NationCreationInput, NationPreset } from '../types';

const PRESET_ORDER: NationPreset[] = [
  'Industrializing Exporter',
  'Agrarian Surplus',
  'Finance and Services Hub',
  'Research State',
  'Defense-Manufacturing Complex',
  'Balanced Mixed Economy',
];

export function buildNationInputs(presets: NationPreset[]): NationCreationInput[] {
  return presets.map((preset, index) => ({
    name: `Nation ${index + 1} (${preset})`,
    preset,
  }));
}

export function defaultNationInputs(count: number): NationCreationInput[] {
  const inputs: NationCreationInput[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      name: `Nation ${i + 1}`,
      preset: PRESET_ORDER[i % PRESET_ORDER.length],
    });
  }
  return inputs;
}
