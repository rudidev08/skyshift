import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../..", "src/assets/backgrounds");

const SIZE = 3000;
const CENTER = SIZE / 2;

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

function phaseRng(id, phase) {
  return mulberry32(hashStr(id + "-" + phase));
}

function splatDensity(buf, cx, cy, radius, intensity) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx, dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const f = 1 - d2 / r2;
        buf[py * SIZE + px] += f * f * intensity;
      }
    }
  }
}

function compositeLayer(canvas, buf, r, g, b, peakAlpha) {
  let maxVal = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > maxVal) maxVal = buf[i];
  if (maxVal === 0) return;
  const layer = createCanvas(SIZE, SIZE);
  const layerCtx = layer.getContext("2d");
  const imageData = layerCtx.createImageData(SIZE, SIZE);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(0, buf[i]) / maxVal;
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

function densityToCanvas(buf, r, g, b, peakAlpha) {
  let maxVal = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > maxVal) maxVal = buf[i];
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(0, buf[i]) / maxVal;
    const curved = v * v;
    imageData.data[i * 4] = r;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = b;
    imageData.data[i * 4 + 3] = Math.round(curved * peakAlpha * 255);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Radial edge fade — shared by all dark nebulas
function applyEdgeFade(buf) {
  for (let i = 0; i < buf.length; i++) {
    const px = i % SIZE, py = Math.floor(i / SIZE);
    const dx = px - CENTER, dy = py - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy) / (SIZE * 0.45);
    if (dist > 1) { buf[i] = 0; }
    else if (dist > 0.7) { buf[i] *= 1 - (dist - 0.7) / 0.3; }
  }
}

// ---- DENSITY L: broad smooth dark cloud ----
function buildDensityL() {
  const rng1 = phaseRng("dark-nebula1", "base");
  const buf = new Float32Array(SIZE * SIZE);

  const anchors = [
    { x: CENTER - 600, y: CENTER - 400 },
    { x: CENTER + 300, y: CENTER - 700 },
    { x: CENTER + 700, y: CENTER + 200 },
    { x: CENTER - 200, y: CENTER + 600 },
    { x: CENTER - 800, y: CENTER + 100 },
    { x: CENTER + 100, y: CENTER - 100 },
    { x: CENTER + 500, y: CENTER + 700 },
  ];

  for (let s = 0; s < 800; s++) {
    const anchor = anchors[Math.floor(rng1() * anchors.length)];
    const cx = anchor.x + (rng1() - 0.5) * 700;
    const cy = anchor.y + (rng1() - 0.5) * 700;
    const radius = 100 + rng1() * 400;
    splatDensity(buf, cx, cy, radius, 0.3 + rng1() * 0.7);
  }

  for (let v = 0; v < 12; v++) {
    const cx = CENTER + (rng1() - 0.5) * SIZE * 0.6;
    const cy = CENTER + (rng1() - 0.5) * SIZE * 0.6;
    splatDensity(buf, cx, cy, 150 + rng1() * 350, -(0.3 + rng1() * 0.5));
  }

  applyEdgeFade(buf);

  return densityToCanvas(buf, 0, 0, 0, 0.7);
}

// ---- DENSITY M: wispy dark tendrils reaching across ----
function buildDensityM() {
  const rng1 = phaseRng("dark-nebula2", "base");
  const canvas = createCanvas(SIZE, SIZE);

  const tendrilBuf = new Float32Array(SIZE * SIZE);
  const tendrils = [
    { x: CENTER - 400, y: CENTER - 300, angle: 0.3,  len: 1800 },
    { x: CENTER + 200, y: CENTER + 100, angle: 2.1,  len: 1500 },
    { x: CENTER - 100, y: CENTER + 500, angle: 1.0,  len: 1200 },
    { x: CENTER + 600, y: CENTER - 200, angle: 3.8,  len: 1400 },
    { x: CENTER - 500, y: CENTER + 300, angle: 5.5,  len: 1000 },
  ];

  for (const t of tendrils) {
    const curve = (rng1() - 0.5) * 400;
    for (let s = 0; s < 150; s++) {
      const frac = rng1();
      const curveOffset = Math.sin(frac * Math.PI) * curve;
      const perpX = -Math.sin(t.angle);
      const perpY = Math.cos(t.angle);
      const cx = t.x + Math.cos(t.angle) * (frac - 0.5) * t.len + perpX * curveOffset + (rng1() - 0.5) * 120;
      const cy = t.y + Math.sin(t.angle) * (frac - 0.5) * t.len + perpY * curveOffset + (rng1() - 0.5) * 120;
      const radius = 60 + rng1() * 200;
      const edgeFade = Math.sin(frac * Math.PI);
      splatDensity(tendrilBuf, cx, cy, radius, (0.3 + rng1() * 0.7) * edgeFade);
    }
  }

  applyEdgeFade(tendrilBuf);
  compositeLayer(canvas, tendrilBuf, 0, 0, 0, 0.6);

  return canvas;
}

// ---- DENSITY S: mottled dark patches — irregular clumps ----
function buildDensityS() {
  const rng1 = phaseRng("dark-nebula3", "base");
  const buf = new Float32Array(SIZE * SIZE);

  const clumps = [
    { x: CENTER - 700, y: CENTER - 500, weight: 0.8 },
    { x: CENTER + 400, y: CENTER - 600, weight: 0.6 },
    { x: CENTER + 800, y: CENTER + 300, weight: 0.9 },
    { x: CENTER - 300, y: CENTER + 700, weight: 0.7 },
    { x: CENTER + 100, y: CENTER - 200, weight: 1.0 },
    { x: CENTER - 600, y: CENTER + 200, weight: 0.5 },
    { x: CENTER + 600, y: CENTER + 600, weight: 0.7 },
    { x: CENTER - 200, y: CENTER - 800, weight: 0.6 },
  ];

  for (let s = 0; s < 1000; s++) {
    const clump = clumps[Math.floor(rng1() * clumps.length)];
    const cx = clump.x + (rng1() - 0.5) * 500;
    const cy = clump.y + (rng1() - 0.5) * 500;
    const radius = 40 + rng1() * 200;
    splatDensity(buf, cx, cy, radius, (0.2 + rng1() * 0.8) * clump.weight);
  }

  for (let v = 0; v < 18; v++) {
    const cx = CENTER + (rng1() - 0.5) * SIZE * 0.7;
    const cy = CENTER + (rng1() - 0.5) * SIZE * 0.7;
    splatDensity(buf, cx, cy, 100 + rng1() * 300, -(0.4 + rng1() * 0.5));
  }

  applyEdgeFade(buf);

  return densityToCanvas(buf, 0, 0, 0, 0.8);
}

// ---- DENSITY XL: large diffuse dark region with subtle deep-blue tint ----
function buildDensityXL() {
  const rng1 = phaseRng("dark-nebula4", "base");
  const buf = new Float32Array(SIZE * SIZE);

  const anchors = [
    { x: CENTER - 500, y: CENTER - 600 },
    { x: CENTER + 600, y: CENTER - 300 },
    { x: CENTER + 200, y: CENTER + 500 },
    { x: CENTER - 400, y: CENTER + 300 },
    { x: CENTER,        y: CENTER - 100 },
  ];

  for (let s = 0; s < 500; s++) {
    const anchor = anchors[Math.floor(rng1() * anchors.length)];
    const cx = anchor.x + (rng1() - 0.5) * 900;
    const cy = anchor.y + (rng1() - 0.5) * 900;
    const radius = 200 + rng1() * 600;
    splatDensity(buf, cx, cy, radius, 0.2 + rng1() * 0.6);
  }

  for (let v = 0; v < 6; v++) {
    const cx = CENTER + (rng1() - 0.5) * SIZE * 0.5;
    const cy = CENTER + (rng1() - 0.5) * SIZE * 0.5;
    splatDensity(buf, cx, cy, 200 + rng1() * 400, -(0.2 + rng1() * 0.4));
  }

  applyEdgeFade(buf);

  const canvas = densityToCanvas(buf, 0, 0, 0, 0.9);

  // Subtle deep-blue tint overlay
  const tintBuf = new Float32Array(SIZE * SIZE);
  const rng2 = phaseRng("dark-nebula4", "tint");
  for (let s = 0; s < 200; s++) {
    const anchor = anchors[Math.floor(rng2() * anchors.length)];
    const cx = anchor.x + (rng2() - 0.5) * 600;
    const cy = anchor.y + (rng2() - 0.5) * 600;
    const radius = 100 + rng2() * 400;
    splatDensity(tintBuf, cx, cy, radius, 0.3 + rng2() * 0.7);
  }

  applyEdgeFade(tintBuf);
  compositeLayer(canvas, tintBuf, 5, 5, 15, 0.1);

  return canvas;
}

// ---- Build all ----
const builders = {
  "dark-nebula-density-s":  buildDensityS,
  "dark-nebula-density-m":  buildDensityM,
  "dark-nebula-density-l":  buildDensityL,
  "dark-nebula-density-xl": buildDensityXL,
};

for (const [id, builder] of Object.entries(builders)) {
  const canvas = builder();
  const filename = `${id}.png`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`Built ${filename} (${SIZE}x${SIZE})`);
}
