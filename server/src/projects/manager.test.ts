import { expect, test } from 'bun:test';
import { EconomyManager } from '../economy/manager';
import { ProjectsManager, getProjectDefinition } from './manager';
import type { EconomyState } from '../types';

function setup(): EconomyState {
  const s = EconomyManager.createInitialState();
  EconomyManager.addCanton(s, 'A');
  s.resources.gold = 10000;
  s.resources.production = 10000;
  return s;
}

// === Definitions coverage ===

test('project tier definitions and start for each tier', () => {
  expect(getProjectDefinition('small')).toEqual({
    slots: 1,
    build: { gold: 50, production: 20, time: 2 },
    oAndM: { gold: 1, energy: 1 },
  });
  expect(getProjectDefinition('medium').slots).toBe(2);
  expect(getProjectDefinition('large').build.production).toBe(100);
  expect(getProjectDefinition('mega').oAndM.energy).toBe(5);
  const state = setup();
  ProjectsManager.start(state, 'A', 'agriculture', 'small');
  ProjectsManager.start(state, 'A', 'agriculture', 'medium');
  ProjectsManager.start(state, 'A', 'agriculture', 'large');
  ProjectsManager.start(state, 'A', 'agriculture', 'mega');
  expect(state.projects.projects.length).toBe(4);
});

// === Delays ===

test('construction delays apply for deficits and debt stress', () => {
  const state = setup();
  const id1 = ProjectsManager.start(state, 'A', 'agriculture', 'small');
  const id2 = ProjectsManager.start(state, 'A', 'agriculture', 'small');
  ProjectsManager.advance(state, { energyDeficit: true });
  expect(state.projects.projects.find(p=>p.id===id1)!.turns_remaining).toBe(2);
  ProjectsManager.advance(state, { lpDeficit: true });
  expect(state.projects.projects.find(p=>p.id===id1)!.turns_remaining).toBe(2);
  ProjectsManager.advance(state, { debtStress: true });
  const p1 = state.projects.projects.find(p=>p.id===id1)!;
  const p2 = state.projects.projects.find(p=>p.id===id2)!;
  expect(p1.turns_remaining).toBe(2); // first project delayed
  expect(p2.turns_remaining).toBe(1); // second progressed normally
});

// === Suspend/Cancel ===

test('projects can suspend, resume and cancel with refunds', () => {
  const state = setup();
  const id = ProjectsManager.start(state, 'A', 'agriculture', 'medium');
  const proj = state.projects.projects.find(p=>p.id===id)!;
  ProjectsManager.suspend(state, id);
  ProjectsManager.advance(state);
  expect(proj.turns_remaining).toBe(getProjectDefinition('medium').build.time);
  ProjectsManager.resume(state, id);
  ProjectsManager.advance(state);
  expect(proj.turns_remaining).toBe(getProjectDefinition('medium').build.time - 1);
  const productionBefore = state.resources.production;
  ProjectsManager.cancel(state, id);
  expect(state.projects.projects.find(p=>p.id===id)).toBeUndefined();
  expect(state.resources.production).toBe(
    productionBefore + Math.floor(getProjectDefinition('medium').build.production * 0.25),
  );
});

// === Capture ===

test('capture transfers completed capacity and pauses builds', () => {
  const state = setup();
  const id = ProjectsManager.start(state, 'A', 'agriculture', 'small');
  for (let i = 0; i < 2; i++) ProjectsManager.advance(state); // finish build
  ProjectsManager.advance(state); // activate
  const canton = state.cantons['A'];
  const capacityBefore = canton.sectors.agriculture!.capacity;
  ProjectsManager.capture(state, id, 'Enemy');
  expect(state.projects.projects[0].owner).toBe('Enemy');
  expect(canton.sectors.agriculture!.capacity).toBe(capacityBefore);
  const id2 = ProjectsManager.start(state, 'A', 'agriculture', 'small');
  ProjectsManager.capture(state, id2, 'Enemy');
  expect(state.projects.projects.find(p=>p.id===id2)!.status).toBe('suspended');
  ProjectsManager.resume(state, id2);
  ProjectsManager.advance(state);
  expect(state.projects.projects.find(p=>p.id===id2)!.turns_remaining).toBe(
    getProjectDefinition('small').build.time - 1,
  );
});

// === On/off timing ===

test('project activation and deactivation take a full turn', () => {
  const state = setup();
  const id = ProjectsManager.start(state, 'A', 'agriculture', 'small');
  for (let i = 0; i < 2; i++) ProjectsManager.advance(state);
  // completed but waiting to activate
  expect(state.projects.projects.find(p=>p.id===id)!.status).toBe('inactive');
  ProjectsManager.advance(state); // activation
  const proj = state.projects.projects.find(p=>p.id===id)!;
  expect(proj.status).toBe('active');
  const cap = state.cantons['A'].sectors.agriculture!.capacity;
  ProjectsManager.toggle(state, id, 'inactive');
  ProjectsManager.advance(state); // toggle resolves
  expect(proj.status).toBe('inactive');
  expect(state.cantons['A'].sectors.agriculture!.capacity).toBe(cap - proj.slots);
});
