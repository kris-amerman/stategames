import Delaunator from "delaunator";
import { generatePoints } from "./seed-points";
import { DualMesh } from "./dual-mesh";
import { MESH_CONFIG } from "./config";
import type { MeshData, MapSize } from "./types";

export function generateMesh(size: MapSize): MeshData {
  console.time(`${size} mesh generation`);

  const { width, height, radiusOptions } = MESH_CONFIG;
  const mesh = new DualMesh(width, height);
  const radius = radiusOptions[size];

  console.time("generatePoints");
  const points: Float64Array = generatePoints({ x: width, y: height }, radius);
  console.timeEnd("generatePoints");

  console.time("Delaunator");
  const delaunay = new Delaunator(points);
  console.timeEnd("Delaunator");

  console.time("mesh.generate");
  const meshData: MeshData = mesh.generate(points, delaunay);
  console.timeEnd("mesh.generate");

  console.timeEnd(`${size} mesh generation`);

  return meshData;
}
