import type { RgbaColor } from './mapColors';

export interface BorderMeshData {
  allVertices: Float64Array;
  cellOffsets: Uint32Array;
  cellVertexIndices: Uint32Array;
  cellNeighbors: Int32Array;
  cellCount: number;
}

export type OutlinePoint = [number, number];

export interface OutlinePath {
  nationId: string;
  vertices: number[];
  points: OutlinePoint[];
  closed: boolean;
}

export interface CantonOutlinePath extends OutlinePath {
  cantonIds: [string, string];
}

export interface CantonViewBorderInput {
  cellOwnership: Record<string, string>;
  cellCantons?: Record<string, string | undefined>;
  mesh: BorderMeshData;
}

export interface CantonViewBorders {
  nationOutlines: OutlinePath[];
  cantonOutlines: CantonOutlinePath[];
}

interface Edge {
  start: number;
  end: number;
}

const FALLBACK_PREFIX = '__fallback__';

function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

export function darkenColor(color: RgbaColor, amount: number): RgbaColor {
  const factor = Math.max(0, Math.min(1, amount));
  return {
    r: clampByte(color.r * (1 - factor)),
    g: clampByte(color.g * (1 - factor)),
    b: clampByte(color.b * (1 - factor)),
    a: color.a,
  };
}

export function lightenColor(color: RgbaColor, amount: number): RgbaColor {
  const factor = Math.max(0, Math.min(1, amount));
  return {
    r: clampByte(color.r + (255 - color.r) * factor),
    g: clampByte(color.g + (255 - color.g) * factor),
    b: clampByte(color.b + (255 - color.b) * factor),
    a: color.a,
  };
}

function lookupOwner(ownership: Record<string, string>, cellId: number): string | undefined {
  return ownership[cellId] ?? ownership[String(cellId)];
}

function lookupCanton(
  cellCantons: Record<string, string | undefined>,
  cellId: number,
  owner: string | undefined,
): string | null {
  const key = String(cellId);
  const explicit = cellCantons[key];
  if (explicit) return explicit;
  if (!owner) return null;
  return `${FALLBACK_PREFIX}${owner}`;
}

function addEdge(map: Map<string, Edge[]>, key: string, edge: Edge): void {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(edge);
}

function buildAdjacency(edges: Edge[]): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  edges.forEach((edge, index) => {
    if (!adjacency.has(edge.start)) adjacency.set(edge.start, []);
    if (!adjacency.has(edge.end)) adjacency.set(edge.end, []);
    adjacency.get(edge.start)!.push(index);
    adjacency.get(edge.end)!.push(index);
  });
  for (const [vertex, indices] of adjacency.entries()) {
    indices.sort((a, b) => {
      const otherA = edges[a].start === vertex ? edges[a].end : edges[a].start;
      const otherB = edges[b].start === vertex ? edges[b].end : edges[b].start;
      if (otherA === otherB) return a - b;
      return otherA - otherB;
    });
  }
  return adjacency;
}

function buildClosedRings(edges: Edge[]): number[][] {
  if (edges.length === 0) return [];
  const adjacency = buildAdjacency(edges);
  const visited = new Array(edges.length).fill(false);
  const rings: number[][] = [];

  for (let i = 0; i < edges.length; i++) {
    if (visited[i]) continue;
    const ring: number[] = [];
    let edgeIndex = i;
    let currentEdge = edges[edgeIndex];
    visited[edgeIndex] = true;
    ring.push(currentEdge.start);
    ring.push(currentEdge.end);
    let currentVertex = currentEdge.end;
    let guard = 0;

    while (currentVertex !== ring[0] && guard < edges.length * 2) {
      guard++;
      const candidates = adjacency.get(currentVertex);
      if (!candidates) {
        ring.length = 0;
        break;
      }
      let nextEdgeIndex = -1;
      for (const candidate of candidates) {
        if (visited[candidate]) continue;
        nextEdgeIndex = candidate;
        break;
      }
      if (nextEdgeIndex === -1) {
        ring.length = 0;
        break;
      }
      visited[nextEdgeIndex] = true;
      const nextEdge = edges[nextEdgeIndex];
      const nextVertex = nextEdge.start === currentVertex ? nextEdge.end : nextEdge.start;
      ring.push(nextVertex);
      currentVertex = nextVertex;
    }

    if (ring.length >= 4 && currentVertex === ring[0]) {
      rings.push(ring);
    }
  }

  return rings;
}

function toPoints(vertices: Float64Array, ring: number[]): OutlinePoint[] {
  const points: OutlinePoint[] = [];
  for (const vertexIndex of ring) {
    const x = vertices[vertexIndex * 2];
    const y = vertices[vertexIndex * 2 + 1];
    points.push([x, y]);
  }
  return points;
}

function minVertex(vertices: number[], closed: boolean): number {
  if (vertices.length === 0) return Number.POSITIVE_INFINITY;
  const limit = closed && vertices.length > 1 ? vertices.length - 1 : vertices.length;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < limit; i++) {
    if (vertices[i] < min) min = vertices[i];
  }
  return min;
}

function compareOutlinePaths(a: OutlinePath, b: OutlinePath): number {
  if (a.nationId !== b.nationId) return a.nationId < b.nationId ? -1 : 1;
  const aMin = minVertex(a.vertices, a.closed);
  const bMin = minVertex(b.vertices, b.closed);
  if (aMin !== bMin) return aMin - bMin;
  if (a.vertices.length !== b.vertices.length) return a.vertices.length - b.vertices.length;
  const aPoint = a.points[0];
  const bPoint = b.points[0];
  if (aPoint[0] !== bPoint[0]) return aPoint[0] - bPoint[0];
  return aPoint[1] - bPoint[1];
}

interface PolylinePath {
  vertices: number[];
  closed: boolean;
}

function buildPolylinePaths(edges: Edge[]): PolylinePath[] {
  if (edges.length === 0) return [];

  const adjacency = new Map<number, { edgeIndex: number; vertex: number }[]>();
  const pushNeighbor = (from: number, to: number, index: number) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ edgeIndex: index, vertex: to });
  };

  edges.forEach((edge, index) => {
    pushNeighbor(edge.start, edge.end, index);
    pushNeighbor(edge.end, edge.start, index);
  });

  const visited = new Array(edges.length).fill(false);
  const paths: PolylinePath[] = [];

  const consumePath = (startVertex: number): number[] => {
    const path: number[] = [startVertex];
    let current = startVertex;
    let guard = 0;
    while (guard < edges.length * 2) {
      guard++;
      const neighbors = adjacency.get(current);
      if (!neighbors) break;
      let nextInfo: { edgeIndex: number; vertex: number } | undefined;
      for (const info of neighbors) {
        if (!visited[info.edgeIndex]) {
          nextInfo = info;
          break;
        }
      }
      if (!nextInfo) break;
      visited[nextInfo.edgeIndex] = true;
      current = nextInfo.vertex;
      path.push(current);
    }
    return path;
  };

  for (const [vertex, neighbors] of adjacency.entries()) {
    if (neighbors.length === 1) {
      const pathVertices = consumePath(vertex);
      if (pathVertices.length > 1) {
        paths.push({ vertices: pathVertices, closed: false });
      }
    }
  }

  for (let i = 0; i < edges.length; i++) {
    if (visited[i]) continue;
    const edge = edges[i];
    const start = edge.start;
    const path: number[] = [start];
    visited[i] = true;
    let currentEdgeIndex = i;
    let currentVertex = start;
    let guard = 0;

    while (guard < edges.length * 2) {
      guard++;
      const edgeRef = edges[currentEdgeIndex];
      currentVertex = edgeRef.start === currentVertex ? edgeRef.end : edgeRef.start;
      path.push(currentVertex);
      if (currentVertex === start) break;
      const neighbors = adjacency.get(currentVertex);
      if (!neighbors) break;
      let nextIndex = -1;
      for (const info of neighbors) {
        if (!visited[info.edgeIndex]) {
          nextIndex = info.edgeIndex;
          break;
        }
      }
      if (nextIndex === -1) break;
      visited[nextIndex] = true;
      currentEdgeIndex = nextIndex;
    }

    if (path.length > 2 && path[path.length - 1] === start) {
      paths.push({ vertices: path, closed: true });
    }
  }

  return paths;
}

export function computeCantonViewBorders(input: CantonViewBorderInput): CantonViewBorders {
  const cellCantons = input.cellCantons ?? {};
  const { mesh } = input;
  const totalCells = mesh.cellCount;

  const nationEdges = new Map<string, Edge[]>();
  const cantonEdgeGroups = new Map<string, { nationId: string; cantons: [string, string]; edges: Edge[] }>();

  for (let cellId = 0; cellId < totalCells; cellId++) {
    const owner = lookupOwner(input.cellOwnership, cellId);
    if (!owner) continue;

    const start = mesh.cellOffsets[cellId];
    const end = mesh.cellOffsets[cellId + 1];
    if (start >= end) continue;

    const cantonId = lookupCanton(cellCantons, cellId, owner);

    for (let ptr = start; ptr < end; ptr++) {
      const vertexA = mesh.cellVertexIndices[ptr];
      const nextIndex = ptr + 1 < end ? ptr + 1 : start;
      const vertexB = mesh.cellVertexIndices[nextIndex];
      const neighborId = mesh.cellNeighbors[ptr];
      const neighborOwner =
        neighborId >= 0 && neighborId < totalCells
          ? lookupOwner(input.cellOwnership, neighborId)
          : undefined;

      if (neighborId < 0 || neighborOwner !== owner) {
        addEdge(nationEdges, owner, { start: vertexA, end: vertexB });
        continue;
      }

      if (!cantonId) continue;
      const neighborCanton = lookupCanton(cellCantons, neighborId, neighborOwner);
      if (!neighborCanton || neighborCanton === cantonId) continue;
      if (cellId > neighborId) continue;

      const pair = cantonId < neighborCanton ? [cantonId, neighborCanton] : [neighborCanton, cantonId];
      const key = `${owner}|${pair[0]}|${pair[1]}`;
      if (!cantonEdgeGroups.has(key)) {
        cantonEdgeGroups.set(key, { nationId: owner, cantons: pair as [string, string], edges: [] });
      }
      cantonEdgeGroups.get(key)!.edges.push({ start: vertexA, end: vertexB });
    }
  }

  const nationOutlines: OutlinePath[] = [];
  for (const [nationId, edges] of nationEdges.entries()) {
    const rings = buildClosedRings(edges);
    for (const ring of rings) {
      nationOutlines.push({
        nationId,
        vertices: ring,
        points: toPoints(mesh.allVertices, ring),
        closed: true,
      });
    }
  }

  const cantonOutlines: CantonOutlinePath[] = [];
  for (const group of cantonEdgeGroups.values()) {
    const paths = buildPolylinePaths(group.edges);
    for (const path of paths) {
      const points = toPoints(mesh.allVertices, path.vertices);
      if (points.length < 2) continue;
      cantonOutlines.push({
        nationId: group.nationId,
        cantonIds: group.cantons,
        vertices: path.vertices,
        points,
        closed: path.closed,
      });
    }
  }

  nationOutlines.sort(compareOutlinePaths);
  cantonOutlines.sort((a, b) => {
    if (a.nationId !== b.nationId) return a.nationId < b.nationId ? -1 : 1;
    if (a.cantonIds[0] !== b.cantonIds[0]) return a.cantonIds[0] < b.cantonIds[0] ? -1 : 1;
    if (a.cantonIds[1] !== b.cantonIds[1]) return a.cantonIds[1] < b.cantonIds[1] ? -1 : 1;
    const aMin = minVertex(a.vertices, a.closed);
    const bMin = minVertex(b.vertices, b.closed);
    if (aMin !== bMin) return aMin - bMin;
    if (a.vertices.length !== b.vertices.length) return a.vertices.length - b.vertices.length;
    const aPoint = a.points[0];
    const bPoint = b.points[0];
    if (aPoint[0] !== bPoint[0]) return aPoint[0] - bPoint[0];
    return aPoint[1] - bPoint[1];
  });

  return { nationOutlines, cantonOutlines };
}
