import { expect, test } from 'bun:test';
import { EconomyManager } from '.';

test('initial economy state has zeroed resources', () => {
  const state = EconomyManager.createInitialState();
  expect(state.resources.gold).toBe(0);
  expect(state.resources.food).toBe(0);
});
