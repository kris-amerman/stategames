#!/usr/bin/env bun

import { generateMesh, saveMeshData, meshDataExists, MESH_CONFIG } from '../mesh';
import type { MapSize } from '../mesh/types';

const MAP_SIZES: MapSize[] = ['small', 'medium', 'large', 'xl'];

async function generateAllMeshes(): Promise<void> {
  console.log('🚀 Starting mesh generation...');
  console.log(`Config: ${MESH_CONFIG.width}x${MESH_CONFIG.height}`);
  console.log(`Sizes: ${MAP_SIZES.join(', ')}`);
  console.log('---');

  let generatedCount = 0;
  let skippedCount = 0;

  for (const size of MAP_SIZES) {
    if (meshDataExists(size)) {
      console.log(`Skipping ${size} (already exists)`);
      skippedCount++;
      continue;
    }

    console.log(`Generating ${size} mesh...`);
    try {
      const meshData = generateMesh(size);
      await saveMeshData(size, meshData);
      console.log(`✅ ${size} mesh completed\n`);
      generatedCount++;
    } catch (error) {
      console.error(`❌ Failed to generate ${size} mesh:`, error);
      process.exit(1);
    }
  }

  console.log(`Mesh generation complete!`);
  console.log(`   Generated: ${generatedCount} meshes`);
  console.log(`   Skipped: ${skippedCount} existing meshes`);
  
  if (skippedCount > 0) {
    console.log(`\nTo regenerate existing meshes:`);
    console.log(`   1. Delete the mesh files you want to regenerate`);
    console.log(`   2. Run this script again`);
    console.log(`   ‼️  WARNING: This will break existing saved games!`);
  }
}

async function generateSpecificMesh(size: string): Promise<void> {
  if (!MAP_SIZES.includes(size as MapSize)) {
    console.error(`❌ Invalid size: ${size}`);
    console.error(`Valid sizes: ${MAP_SIZES.join(', ')}`);
    process.exit(1);
  }

  const mapSize = size as MapSize;
  
  if (meshDataExists(mapSize)) {
    console.log(`⚠️  ${size} mesh already exists! To regenerate: delete the mesh file and run this command again.`);
    console.log(`‼️  WARNING: Regenerating will break existing saved games!`);
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

function showExistingMeshes(): void {
  console.log('Existing mesh files:');
  const existing = MAP_SIZES.filter(size => meshDataExists(size));
  
  if (existing.length === 0) {
    console.log('   None found - all meshes will be generated');
  } else {
    existing.forEach(size => console.log(`   ✅ ${size}`));
    const missing = MAP_SIZES.filter(size => !meshDataExists(size));
    if (missing.length > 0) {
      missing.forEach(size => console.log(`   ❌ ${size} (will be generated)`));
    }
  }
  console.log('');
}

function printUsage(): void {
  console.log(`
Usage: bun run generate-meshes [options] [size]

Options:
  --list      Show existing mesh files status
  --help      Show this help message

Arguments:
  size        Generate only a specific size (${MAP_SIZES.join(', ')})
              If not provided, generates all missing sizes

Examples:
  bun run generate-meshes                    # Generate all missing meshes
  bun run generate-meshes --list             # Show existing mesh status  
  bun run generate-meshes medium             # Generate only medium mesh

Safety Features:
  ✅ Never overwrites existing mesh files
  ✅ Protects existing saved games from corruption
  ✅ Clear error messages when mesh files already exist

To regenerate existing meshes:
  1. Manually delete the mesh files you want to regenerate
  2. Run this script again
  ⚠️  WARNING: This will break existing saved games!
`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const list = args.includes('--list');
const help = args.includes('--help');
const size = args.find(arg => !arg.startsWith('--'));

if (help) {
  printUsage();
  process.exit(0);
}

if (list) {
  showExistingMeshes();
  process.exit(0);
}

// Main execution
(async () => {
  try {
    if (size) {
      await generateSpecificMesh(size);
    } else {
      showExistingMeshes();
      await generateAllMeshes();
    }
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
})();