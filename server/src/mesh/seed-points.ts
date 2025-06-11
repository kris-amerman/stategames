interface Vector2D {
  x: number;
  y: number;
}

export function generatePoissonPoints(
  regionSize: Vector2D,
  radius: number,
  offset: number,
  rejectLimit: number = 30
): Float64Array {
  if (regionSize.x < 0 || regionSize.y < 0) {
    throw new Error("not enough room for poisson disc sampling");
  }

  const cellSize = radius / Math.SQRT2;
  const cols = Math.ceil(regionSize.x / cellSize);
  const rows = Math.ceil(regionSize.y / cellSize);
  const radiusSq = radius * radius;

  // Pre-calculate sin/cos lookup table for performance
  const ANGLE_SAMPLES = 64;
  const cosTable = new Float64Array(ANGLE_SAMPLES);
  const sinTable = new Float64Array(ANGLE_SAMPLES);
  for (let i = 0; i < ANGLE_SAMPLES; i++) {
    const angle = (i / ANGLE_SAMPLES) * Math.PI * 2;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }

  // flat grid for cache-friendly access
  const grid = new Int32Array(cols * rows).fill(-1);
  // master list of all accepted points
  const points: Vector2D[] = [];
  // active front: pool of accepted points from which
  // we might still be able to generate new neighbors
  const spawnPoints: Vector2D[] = [];

  // Optimized isValid function
  function isValid(newX: number, newY: number): boolean {
    // Early bounds check (fastest rejection)
    if (newX < 0 || newX >= regionSize.x || newY < 0 || newY >= regionSize.y)
      return false;

    const cellX = Math.floor(newX / cellSize);
    const cellY = Math.floor(newY / cellSize);

    // Tighter bounds calculation
    const startX = Math.max(0, cellX - 2);
    const endX = Math.min(cellX + 2, cols - 1);
    const startY = Math.max(0, cellY - 2);
    const endY = Math.min(cellY + 2, rows - 1);

    // Cache radiusSq locally to avoid repeated property access
    const radiusSqLocal = radiusSq;

    // Optimized nested loop with better memory access pattern
    for (let y = startY; y <= endY; y++) {
      const rowOffset = y * cols;
      for (let x = startX; x <= endX; x++) {
        const idx = grid[rowOffset + x];
        if (idx !== -1) {
          const point = points[idx];
          const dx = newX - point.x;
          const dy = newY - point.y;
          if (dx * dx + dy * dy < radiusSqLocal) return false;
        }
      }
    }
    return true;
  }

  // seed with center
  spawnPoints.push({ x: regionSize.x / 2, y: regionSize.y / 2 });

  let iterations = 0;
  let rejections = 0;
  let validationCalls = 0;

  while (spawnPoints.length > 0) {
    iterations++;

    // Smarter spawn point selection - bias toward newer points (more likely to succeed)
    const spawnIndex =
      spawnPoints.length > 6
        ? Math.floor(Math.random() * Math.min(6, spawnPoints.length))
        : Math.floor(Math.random() * spawnPoints.length);

    const spawnCenter = spawnPoints[spawnIndex];
    let accepted = false;

    // Adaptive reject limit based on grid density
    const density = points.length / (cols * rows * 0.1); // Rough density estimate
    const adaptiveRejectLimit = Math.max(
      10,
      Math.floor(rejectLimit * Math.max(0.3, 1 - density))
    );

    for (let i = 0; i < adaptiveRejectLimit; i++) {
      // Use lookup table instead of Math.cos/sin
      const angleIdx = Math.floor(Math.random() * ANGLE_SAMPLES);
      const dist = radius + Math.random() * radius;
      const dx = cosTable[angleIdx] * dist;
      const dy = sinTable[angleIdx] * dist;
      const newX = spawnCenter.x + dx;
      const newY = spawnCenter.y + dy;

      validationCalls++;
      if (isValid(newX, newY)) {
        // accept point
        points.push({ x: newX, y: newY });
        spawnPoints.push({ x: newX, y: newY });

        const cellX = Math.floor(newX / cellSize);
        const cellY = Math.floor(newY / cellSize);
        grid[cellY * cols + cellX] = points.length - 1;

        accepted = true;
        break;
      } else {
        rejections++;
      }
    }

    if (!accepted) {
      // O(1) removal: swap-with-last + pop, instead of splice
      const last = spawnPoints.pop()!;
      if (spawnIndex < spawnPoints.length) {
        spawnPoints[spawnIndex] = last;
      }
    }
  }

  // pack into a Float64Array
  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[2 * i] = points[i].x + offset;
    out[2 * i + 1] = points[i].y + offset;
  }

  return out;
}

export function generateBoundingPoints(
  regionSize: Vector2D,
  radius: number
): Float64Array {
  if (regionSize.x % radius != 0 || regionSize.y % radius != 0) {
    throw new Error("regionSize not divisible by radius");
  }

  const points: Vector2D[] = [];

  let outerPoints = 0;
  let innerPoints = 0;

  // outer
  for (let j = 0; j <= regionSize.y; j += radius) {
    for (let i = 0; i <= regionSize.x; i += radius) {
      if (i == 0 || j == 0 || i == regionSize.x || j == regionSize.y) {
        if (
          i == radius ||
          i == regionSize.x - radius ||
          j == radius ||
          j == regionSize.y - radius
        ) {
          continue;
        }
        points.push({ x: i, y: j });
        outerPoints++;
      }
    }
  }

  // inner
  for (let j = radius; j <= regionSize.y - radius; j += radius) {
    for (let i = radius; i <= regionSize.x - radius; i += radius) {
      if (
        i == radius ||
        j == radius ||
        i == regionSize.x - radius ||
        j == regionSize.y - radius
      ) {
        points.push({ x: i, y: j });
        innerPoints++;
      }
    }
  }

  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[2 * i] = points[i].x;
    out[2 * i + 1] = points[i].y;
  }

  return out;
}

export function generatePoints(
  regionSize: Vector2D,
  radius: number
): Float64Array {
  const boundingPoints = generateBoundingPoints(regionSize, radius);
  const poissonPoints = generatePoissonPoints(
    { x: regionSize.x - 4 * radius, y: regionSize.y - 4 * radius },
    radius,
    2 * radius
  );
  const out = new Float64Array(poissonPoints.length + boundingPoints.length);

  out.set(poissonPoints);
  out.set(boundingPoints, poissonPoints.length);

  return out;
}
