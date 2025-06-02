import { BIOME_COLORS } from "./main";

export function drawCells(
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D,
  allVertices: Float64Array,
  cellOffsets: Uint32Array,
  cellVertexIndices: Uint32Array,
  cellBiomes: Uint8Array,
  cellNeighbors: Int32Array,
  smoothColors: boolean = true
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const nCells = cellOffsets.length - 1;

  for (let cellId = 0; cellId < nCells; cellId++) {
    const start = cellOffsets[cellId];
    const end = cellOffsets[cellId + 1];
    if (start >= end) continue;

    const biome = cellBiomes[cellId];
    let color = BIOME_COLORS[biome] || "#888888";

    // optional smoothing of fill‐colors
    if (smoothColors) {
      let totalWeight = 1;
      let r = parseInt(color.substr(1, 2), 16),
        g = parseInt(color.substr(3, 2), 16),
        b = parseInt(color.substr(5, 2), 16);

      const neighborCount = Math.min(3, end - start);
      for (let k = 0; k < neighborCount; k++) {
        const nbId = cellNeighbors[start + k];
        if (nbId >= 0 && nbId < nCells) {
          const nbColor = BIOME_COLORS[cellBiomes[nbId]] || "#888888";
          const weight = 0.15;
          const nr = parseInt(nbColor.substr(1, 2), 16),
            ng = parseInt(nbColor.substr(3, 2), 16),
            nb = parseInt(nbColor.substr(5, 2), 16);
          r += nr * weight;
          g += ng * weight;
          b += nb * weight;
          totalWeight += weight;
        }
      }
      color = `rgb(${Math.round(r / totalWeight)}, ${Math.round(
        g / totalWeight
      )}, ${Math.round(b / totalWeight)})`;
    }

    // draw cell fill
    ctx.fillStyle = color;
    ctx.beginPath();
    const v0 = cellVertexIndices[start];
    ctx.moveTo(allVertices[v0 * 2], allVertices[v0 * 2 + 1]);
    for (let j = start + 1; j < end; j++) {
      const vi = cellVertexIndices[j];
      ctx.lineTo(allVertices[vi * 2], allVertices[vi * 2 + 1]);
    }
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}
