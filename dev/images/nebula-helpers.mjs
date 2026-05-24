import { createCanvas } from "canvas";

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

/** Returns a fresh PRNG seeded by `id + "-" + phase` so each phase reproduces independently. */
export function phaseRng(id, phase) {
  return mulberry32(hashStr(id + "-" + phase));
}

export function splatDensity(densityBuffer, { cx, cy, radius, intensity }, size) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(size - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(size - 1, Math.ceil(cy + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx,
        dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const f = 1 - d2 / r2;
        densityBuffer[py * size + px] += f * f * intensity;
      }
    }
  }
}

export function compositeLayer(canvas, densityBuffer, { r, g, b, peakAlpha }, size) {
  let maxVal = 0;
  for (let i = 0; i < densityBuffer.length; i++) if (densityBuffer[i] > maxVal) maxVal = densityBuffer[i];
  if (maxVal === 0) return;
  const layer = createCanvas(size, size);
  const layerCtx = layer.getContext("2d");
  const imageData = layerCtx.createImageData(size, size);
  for (let i = 0; i < densityBuffer.length; i++) {
    const v = Math.max(0, densityBuffer[i]) / maxVal;
    const curved = v * v;
    imageData.data[i * 4] = r;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = b;
    imageData.data[i * 4 + 3] = Math.round(curved * peakAlpha * 255);
  }
  layerCtx.putImageData(imageData, 0, 0);
  const ctx = canvas.getContext("2d");
  ctx.globalAlpha = 1;
  ctx.drawImage(layer, 0, 0);
}
