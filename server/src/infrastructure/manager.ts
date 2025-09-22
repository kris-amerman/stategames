// server/src/infrastructure/manager.ts
import type {
  EconomyState,
  InfrastructureType,
  InfrastructureData,
} from '../types';
import type { Mode, NetworkNode, Gateway } from '../logistics/manager';

export interface InfraDefinition {
  build: { gold: number; production: number; time: number };
  oAndM: { gold: number; energy: number };
}

export const INFRA_DEFINITIONS: Record<InfrastructureType, InfraDefinition> = {
  airport: {
    build: { gold: 120, production: 80, time: 3 },
    oAndM: { gold: 4, energy: 2 },
  },
  port: {
    build: { gold: 140, production: 100, time: 3 },
    oAndM: { gold: 3, energy: 2 },
  },
  rail: {
    build: { gold: 60, production: 45, time: 2 },
    oAndM: { gold: 2, energy: 1 },
  },
};

export function getInfraDefinition(
  type: InfrastructureType,
  national = false,
): InfraDefinition {
  const base = INFRA_DEFINITIONS[type];
  if (!national) return base;
  return {
    build: {
      gold: Math.round(base.build.gold * 1.5),
      production: Math.round(base.build.production * 1.5),
      time: base.build.time,
    },
    oAndM: {
      gold: base.oAndM.gold * 2,
      energy: base.oAndM.energy * 2,
    },
  };
}

export interface NetworkBuildContext {
  portDistances?: Record<string, Record<string, number>>;
  railAdjacency?: Record<string, Record<string, string>>;
}

function bfs(graph: Record<string, string[]>, start?: string): Record<string, number> {
  const dist: Record<string, number> = {};
  if (!start) return dist;
  const q: string[] = [start];
  dist[start] = 0;
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of graph[cur] || []) {
      if (dist[nb] !== undefined) continue;
      dist[nb] = dist[cur] + 1;
      q.push(nb);
    }
  }
  return dist;
}

function plural(type: InfrastructureType): 'airports' | 'ports' | 'railHubs' {
  return type === 'airport' ? 'airports' : type === 'port' ? 'ports' : 'railHubs';
}

export interface NavalUnit {
  stockpile: number;
  maxStockpile: number;
}

export class InfrastructureManager {
  static build(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
    opts: { national?: boolean; owner?: string } = {},
  ): void {
    const def = getInfraDefinition(type, opts.national);
    if (opts.national) {
      const current = state.infrastructure.national;
      const key = type === 'airport' ? 'airport' : type === 'port' ? 'port' : 'rail';
      if ((current as any)[key]) {
        throw new Error(`National ${type} already exists`);
      }
      (state.infrastructure.national as any)[key] = canton;
    }
    const entry: InfrastructureData = {
      owner: opts.owner ?? 'national',
      status: 'building',
      national: opts.national ?? false,
      turns_remaining: def.build.time,
      hp: 100,
    };
    (state.infrastructure[plural(type)] as any)[canton] = entry;
    state.resources.gold -= def.build.gold;
    state.resources.production -= def.build.production;
  }

  static toggle(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
    target: 'active' | 'inactive',
  ): void {
    const entry = (state.infrastructure[plural(type)] as any)[canton] as
      | InfrastructureData
      | undefined;
    if (!entry) return;
    entry.toggle = { target, turns: 1 };
  }

  static pillage(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
  ): void {
    const entry = (state.infrastructure[plural(type)] as any)[canton] as
      | InfrastructureData
      | undefined;
    if (!entry) return;
    entry.hp = 0;
    entry.status = 'inactive';
  }

  static repair(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
  ): void {
    const entry = (state.infrastructure[plural(type)] as any)[canton] as
      | InfrastructureData
      | undefined;
    if (!entry) return;
    if (state.resources.production < 5) throw new Error('insufficient production');
    state.resources.production -= 5;
    entry.hp = 100;
    if (entry.status !== 'building') entry.status = 'active';
  }

  static capture(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
    newOwner: string,
  ): void {
    const entry = (state.infrastructure[plural(type)] as any)[canton] as
      | InfrastructureData
      | undefined;
    if (!entry) return;
    entry.owner = newOwner;
  }

  static redesignate(
    state: EconomyState,
    type: InfrastructureType,
    canton: string,
  ): void {
    const list = (state.infrastructure[plural(type)] as any) as Record<
      string,
      InfrastructureData
    >;
    const entry = list[canton];
    if (!entry) throw new Error('infrastructure not found');
    const key = type === 'airport' ? 'airport' : type === 'port' ? 'port' : 'rail';
    const current = (state.infrastructure.national as any)[key];
    if (current && current !== canton) {
      const prev = list[current];
      if (prev) prev.national = false;
    }
    entry.national = true;
    (state.infrastructure.national as any)[key] = canton;
  }

  static navalResupply(unit: NavalUnit): void {
    unit.stockpile = unit.maxStockpile;
  }

  static progressTurn(
    state: EconomyState,
    ctx: NetworkBuildContext = {},
  ): {
    networks: Record<string, Partial<Record<Mode, NetworkNode>>>;
    gatewayCapacities: Partial<Record<Gateway, number>>;
    lpBonus: number;
  } {
    const applyProgress = (
      type: InfrastructureType,
      list: Record<string, InfrastructureData>,
    ) => {
      for (const entry of Object.values(list)) {
        if (entry.status === 'active') {
          const def = getInfraDefinition(type, entry.national);
          state.resources.gold -= def.oAndM.gold;
          state.resources.energy -= def.oAndM.energy;
        }
        if (entry.status === 'building') {
          entry.turns_remaining! -= 1;
          if (entry.turns_remaining! <= 0) {
            entry.status = 'inactive';
            entry.toggle = { target: 'active', turns: 1 };
            entry.turns_remaining = 0;
          }
        }
        if (entry.toggle) {
          entry.toggle.turns -= 1;
          if (entry.toggle.turns <= 0) {
            entry.status = entry.toggle.target;
            entry.toggle = undefined;
          }
        }
      }
    };
    applyProgress('airport', state.infrastructure.airports);
    applyProgress('port', state.infrastructure.ports);
    applyProgress('rail', state.infrastructure.railHubs);
    return this.computeNetworks(state, ctx);
  }

  static computeNetworks(
    state: EconomyState,
    ctx: NetworkBuildContext = {},
  ) {
    const networks: Record<string, Partial<Record<Mode, NetworkNode>>> = {};
    const gatewayCapacities: Partial<Record<Gateway, number>> = {};
    let lpBonus = 0;

    // Airports
    const natAirport = state.infrastructure.national.airport;
    if (natAirport && state.infrastructure.airports[natAirport]?.status === 'active') {
      gatewayCapacities.air = Infinity;
    }
    for (const [canton, air] of Object.entries(state.infrastructure.airports)) {
      if (air.status !== 'active') continue;
      const hops = natAirport ? (canton === natAirport ? 0 : 1) : Infinity;
      networks[canton] = networks[canton] || {};
      networks[canton].air = {
        connected: hops !== Infinity,
        hops,
        capacity_per_turn: Infinity,
      };
    }

    // Ports graph
    const activePorts = Object.entries(state.infrastructure.ports).filter(
      ([, p]) => p.status === 'active',
    );
    const portGraph: Record<string, string[]> = {};
    for (const [id] of activePorts) portGraph[id] = [];
    for (const [id] of activePorts) {
      const distances = ctx.portDistances?.[id] || {};
      const candidates = Object.entries(distances)
        .filter(([other, d]) => portGraph[other] && d <= 15)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2);
      for (const [other] of candidates) {
        portGraph[id].push(other);
        portGraph[other].push(id);
      }
    }
    const natPort = state.infrastructure.national.port;
    const portDist = bfs(portGraph, natPort);
    if (natPort && state.infrastructure.ports[natPort]?.status === 'active') {
      gatewayCapacities.port = Infinity;
    }
    for (const [id, p] of activePorts) {
      networks[id] = networks[id] || {};
      const hops = portDist[id];
      networks[id].sea = {
        connected: hops !== undefined,
        hops: hops ?? Infinity,
        capacity_per_turn: Infinity,
      };
      lpBonus += 10;
    }

    // Rail graph
    const activeRails = Object.entries(state.infrastructure.railHubs).filter(
      ([, h]) => h.status === 'active' && h.hp > 0,
    );
    const railGraph: Record<string, string[]> = {};
    for (const [id] of activeRails) railGraph[id] = [];
    const forbids = new Set(['mountains', 'shallows', 'deep_ocean', 'deepOcean']);
    for (const [id] of activeRails) {
      const adj = ctx.railAdjacency?.[id] || {};
      for (const [nb, terrain] of Object.entries(adj)) {
        if (!railGraph[nb]) continue; // neighbor lacks active hub
        if (forbids.has(terrain)) continue;
        railGraph[id].push(nb);
      }
    }
    const natRail = state.infrastructure.national.rail;
    const railDist = bfs(railGraph, natRail);
    if (natRail && state.infrastructure.railHubs[natRail]?.status === 'active') {
      gatewayCapacities.rail = Infinity;
    }
    for (const [id] of activeRails) {
      networks[id] = networks[id] || {};
      const hops = railDist[id];
      networks[id].rail = {
        connected: hops !== undefined,
        hops: hops ?? Infinity,
        capacity_per_turn: Infinity,
      };
    }

    return { networks, gatewayCapacities, lpBonus };
  }

  static railMovementSpeed(
    unitSpeed: number,
    path: string[],
    state: EconomyState,
    ctx: NetworkBuildContext,
  ): number {
    // path is sequence of cantons including start and end
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      const hub = state.infrastructure.railHubs[c];
      if (!hub || hub.status !== 'active' || hub.hp <= 0) return unitSpeed;
      if (i < path.length - 1) {
        const next = path[i + 1];
        const terr = ctx.railAdjacency?.[c]?.[next];
        if (!terr) return unitSpeed;
        const forbids = new Set(['mountains', 'shallows', 'deep_ocean', 'deepOcean']);
        if (forbids.has(terr)) return unitSpeed;
        const nextHub = state.infrastructure.railHubs[next];
        if (!nextHub || nextHub.status !== 'active' || nextHub.hp <= 0)
          return unitSpeed;
      }
    }
    return Math.max(unitSpeed, 4);
  }
}
