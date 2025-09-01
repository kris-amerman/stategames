// server/src/projects/manager.ts
import type { EconomyState, ProjectTier, ProjectData, SectorType } from '../types';

export interface ProjectDefinition {
  slots: number;
  build: { gold: number; production: number; time: number };
  oAndM: { gold: number; energy: number };
}

export const PROJECT_DEFINITIONS: Record<ProjectTier, ProjectDefinition> = {
  small: {
    slots: 1,
    build: { gold: 50, production: 20, time: 2 },
    oAndM: { gold: 1, energy: 1 },
  },
  medium: {
    slots: 2,
    build: { gold: 100, production: 35, time: 3 },
    oAndM: { gold: 2, energy: 2 },
  },
  large: {
    slots: 4,
    build: { gold: 150, production: 100, time: 4 },
    oAndM: { gold: 3, energy: 3 },
  },
  mega: {
    slots: 6,
    build: { gold: 300, production: 200, time: 6 },
    oAndM: { gold: 5, energy: 5 },
  },
};

export function getProjectDefinition(tier: ProjectTier): ProjectDefinition {
  return PROJECT_DEFINITIONS[tier];
}

export interface ProjectAdvanceContext {
  energyDeficit?: boolean;
  lpDeficit?: boolean;
  debtStress?: boolean;
}

function applyCapacity(state: EconomyState, project: ProjectData, enable: boolean) {
  const canton = state.cantons[project.canton];
  if (!canton) return;
  const sec = (canton.sectors as any)[project.sector];
  if (!sec) return;
  if (enable) {
    sec.capacity += project.slots;
  } else {
    sec.capacity -= project.slots;
  }
}

export class ProjectsManager {
  static start(
    state: EconomyState,
    canton: string,
    sector: SectorType,
    tier: ProjectTier,
    owner = 'national',
  ): number {
    const def = getProjectDefinition(tier);
    state.resources.gold -= def.build.gold;
    state.resources.production -= def.build.production;
    const project: ProjectData = {
      id: state.projects.nextId++,
      canton,
      sector,
      tier,
      slots: def.slots,
      status: 'building',
      owner,
      turns_remaining: def.build.time,
      cost: { ...def.build },
      completed: false,
    };
    state.projects.projects.push(project);
    // ensure sector exists
    const cantonEco = state.cantons[canton];
    if (cantonEco && !cantonEco.sectors[sector]) {
      cantonEco.sectors[sector] = {
        capacity: 0,
        funded: 0,
        idle: 0,
        utilization: 0,
      } as any;
    }
    return project.id;
  }

  static advance(state: EconomyState, ctx: ProjectAdvanceContext = {}): void {
    let debtApplied = false;
    for (const project of state.projects.projects) {
      if (project.status === 'active') {
        const def = getProjectDefinition(project.tier);
        state.resources.gold -= def.oAndM.gold;
        state.resources.energy -= def.oAndM.energy;
      }
      if (project.toggle) {
        project.toggle.turns -= 1;
        if (project.toggle.turns <= 0) {
          project.status = project.toggle.target;
          project.toggle = undefined;
          if (project.completed) {
            applyCapacity(state, project, project.status === 'active');
          }
        }
      }
      if (project.status !== 'building') continue;
      let penalty = 0;
      if (ctx.energyDeficit) penalty++;
      if (ctx.lpDeficit) penalty++;
      if (ctx.debtStress && !debtApplied) {
        penalty++;
        debtApplied = true;
      }
      project.turns_remaining += penalty;
      project.turns_remaining -= 1;
      if (project.turns_remaining <= 0) {
        project.completed = true;
        project.status = 'inactive';
        project.turns_remaining = 0;
        project.toggle = { target: 'active', turns: 1 };
      }
    }
  }

  static toggle(state: EconomyState, id: number, target: 'active' | 'inactive'): void {
    const project = state.projects.projects.find((p) => p.id === id);
    if (!project) return;
    project.toggle = { target, turns: 1 };
  }

  static suspend(state: EconomyState, id: number): void {
    const project = state.projects.projects.find((p) => p.id === id);
    if (!project) return;
    if (project.status === 'building') project.status = 'suspended';
  }

  static resume(state: EconomyState, id: number): void {
    const project = state.projects.projects.find((p) => p.id === id);
    if (!project) return;
    if (project.status === 'suspended') project.status = 'building';
  }

  static cancel(state: EconomyState, id: number): void {
    const idx = state.projects.projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const project = state.projects.projects[idx];
    state.resources.production += Math.floor(project.cost.production * 0.25);
    const materials = (project.cost as any).materials;
    if (materials) state.resources.materials += Math.floor(materials * 0.5);
    state.projects.projects.splice(idx, 1);
  }

  static capture(state: EconomyState, id: number, newOwner: string): void {
    const project = state.projects.projects.find((p) => p.id === id);
    if (!project) return;
    project.owner = newOwner;
    if (project.status === 'building') project.status = 'suspended';
  }
}
