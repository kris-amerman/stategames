import type { ResourceType, SectorType } from '../types';
import sectorOutputs from './data/sectorOutputs.json';
import slotRequirements from './data/slotRequirements.json';

export interface SectorOutputTable {
  [res: string]: number;
}

export interface SlotRequirement {
  energy: number;
  logistics: number;
  inputs: Partial<Record<ResourceType, number>>;
}

export const SECTOR_BASE_OUTPUT: Record<SectorType, SectorOutputTable> =
  sectorOutputs as any;

export const SLOT_REQUIREMENTS: Record<SectorType, SlotRequirement> =
  slotRequirements as any;
