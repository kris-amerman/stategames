import type { EconomyState, InfrastructureType } from './types';

export interface StateChangeEvent {
  type: 'infrastructure_complete' | 'ul_change' | 'resource_default' | 'resource_shortage' | 'energy_shortage';
  canton?: string;
  infrastructureType?: InfrastructureType;
  resource?: string;
  from?: number;
  to?: number;
  ratio?: number;
}

export function collectStateChanges(prev: EconomyState, curr: EconomyState): StateChangeEvent[] {
  const events: StateChangeEvent[] = [];

  const checkInfra = (
    type: InfrastructureType,
    prevList: Record<string, any>,
    currList: Record<string, any>
  ) => {
    for (const canton of Object.keys(currList)) {
      const before = prevList[canton];
      const after = currList[canton];
      if (before && before.status !== 'active' && after.status === 'active') {
        events.push({ type: 'infrastructure_complete', infrastructureType: type, canton });
      }
    }
  };

  checkInfra('airport', prev.infrastructure.airports, curr.infrastructure.airports);
  checkInfra('port', prev.infrastructure.ports, curr.infrastructure.ports);
  checkInfra('rail', prev.infrastructure.railHubs, curr.infrastructure.railHubs);

  for (const canton of Object.keys(curr.cantons)) {
    const before = prev.cantons[canton];
    const after = curr.cantons[canton];
    if (before && after && before.urbanizationLevel !== after.urbanizationLevel) {
      events.push({
        type: 'ul_change',
        canton,
        from: before.urbanizationLevel,
        to: after.urbanizationLevel
      });
    }
  }

  for (const [res, val] of Object.entries(curr.resources)) {
    const prevVal = (prev.resources as any)[res];
    if (res === 'gold') {
      if (curr.finance?.defaulted && !prev.finance?.defaulted) {
        events.push({ type: 'resource_default', resource: res });
      } else if (prevVal >= 0 && val < 0) {
        events.push({ type: 'resource_shortage', resource: res, from: prevVal, to: val });
      }
    } else if (prevVal >= 0 && val < 0) {
      events.push({ type: 'resource_shortage', resource: res, from: prevVal, to: val });
    }
  }

  if (curr.energy.state && curr.energy.state.ratio < 1) {
    events.push({ type: 'energy_shortage', ratio: curr.energy.state.ratio });
  }

  return events;
}
