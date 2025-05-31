#!/usr/bin/env bun

import {
  generateMesh,
  saveMeshData,
  meshDataExists,
  MESH_CONFIG,
} from "../mesh";
import type { MapSize } from "../mesh/types";

const MAP_SIZES: MapSize[] = ["small", "medium", "large", "xl"];

async function generateAllMeshes(force = false): Promise<void> {
  console.log("🚀 Starting mesh generation...");
  console.log(`Config: ${MESH_CONFIG.width}x${MESH_CONFIG.height}`);
  console.log(`Sizes: ${MAP_SIZES.join(", ")}`);
  console.log("---");

  for (const size of MAP_SIZES) {
    if (!force && meshDataExists(size)) {
      console.log(
        `⏭️  Skipping ${size} (already exists, use --force to regenerate)`
      );
      continue;
    }

    console.log(`🔄 Generating ${size} mesh...`);
    try {
      const meshData = generateMesh(size);
      await saveMeshData(size, meshData);
      console.log(`✅ ${size} mesh completed\n`);
    } catch (error) {
      console.error(`❌ Failed to generate ${size} mesh:`, error);
      process.exit(1);
    }
  }

  console.log("🎉 All meshes generated successfully!");
}

async function generateSpecificMesh(
  size: string,
  force = false
): Promise<void> {
  if (!MAP_SIZES.includes(size as MapSize)) {
    console.error(`❌ Invalid size: ${size}`);
    console.error(`Valid sizes: ${MAP_SIZES.join(", ")}`);
    process.exit(1);
  }

  const mapSize = size as MapSize;

  if (!force && meshDataExists(mapSize)) {
    console.log(`⏭️  ${size} mesh already exists (use --force to regenerate)`);
    return;
  }

  console.log(`🔄 Generating ${size} mesh...`);
  try {
    const meshData = generateMesh(mapSize);
    await saveMeshData(mapSize, meshData);
    console.log(`✅ ${size} mesh completed`);
  } catch (error) {
    console.error(`❌ Failed to generate ${size} mesh:`, error);
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
Usage: bun run generate-meshes [options] [size]

Options:
  --force     Regenerate meshes even if they already exist
  --help      Show this help message

Arguments:
  size        Generate only a specific size (${MAP_SIZES.join(", ")})
              If not provided, generates all sizes

Examples:
  bun run generate-meshes                    # Generate all missing meshes
  bun run generate-meshes --force            # Regenerate all meshes
  bun run generate-meshes medium             # Generate only medium mesh
  bun run generate-meshes large --force      # Force regenerate large mesh
`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const force = args.includes("--force");
const help = args.includes("--help");
const size = args.find((arg) => !arg.startsWith("--"));

if (help) {
  printUsage();
  process.exit(0);
}

// Main execution
(async () => {
  try {
    if (size) {
      await generateSpecificMesh(size, force);
    } else {
      await generateAllMeshes(force);
    }
  } catch (error) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  }
})();
