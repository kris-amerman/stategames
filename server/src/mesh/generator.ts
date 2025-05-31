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

  console.time("pointGeneration");
  const points: Float64Array = generatePoints({ x: width, y: height }, radius);
  console.timeEnd("pointGeneration");

  console.time("triangulation");
  const delaunay = new Delaunator(points);
  console.timeEnd("triangulation");

  console.time("meshUpdate");
  const meshData: MeshData = mesh.generate(points, delaunay);
  console.timeEnd("meshUpdate");

  console.timeEnd(`${size} mesh generation`);
  console.log(
    `Generated ${size} mesh with ${meshData.cellOffsets.length - 1} cells`
  );

  return meshData;
}
