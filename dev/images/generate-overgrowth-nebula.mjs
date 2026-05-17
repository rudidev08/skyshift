// Generates a wide C-shaped crescent of dark woody branches with bright green leaf clusters
// (inspired by palo verde and the White Tree of Numenor). Branches are bumpy and irregular —
// organic, not geometrically perfect.

import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../..", "src/assets/backgrounds");

const SIZE = 1500;
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

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function phaseRng(id, phase) {
  return mulberry32(hashString(id + "-" + phase));
}

function splatDensity(buf, cx, cy, radius, intensity) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx,
        dy = py - cy;
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

/** Layered noise (slow wander + medium bumps + fine grain) gives the arc a bark-like silhouette instead of a clean curve. */
function walkArc(rng, arcCenterX, arcCenterY, arcRadius, startAngle, endAngle, stepCount) {
  const points = [];

  // Slow wander — broad branch-bending undulations in radius.
  const wanderPhase = rng() * Math.PI * 2;
  const wanderFreq = 2 + rng() * 2;
  const wanderAmp = 15 + rng() * 15;

  // Medium bumps — knots and bends.
  const bumpPhase = rng() * Math.PI * 2;
  const bumpFreq = 8 + rng() * 6;
  const bumpAmp = 6 + rng() * 8;

  // Fine grain — rough bark texture.
  const grainAmp = 3;

  for (let i = 0; i <= stepCount; i++) {
    const progress = i / stepCount;
    const angle = startAngle + (endAngle - startAngle) * progress;

    const wander = Math.sin(progress * Math.PI * 2 * wanderFreq + wanderPhase) * wanderAmp;
    const bump = Math.sin(progress * Math.PI * 2 * bumpFreq + bumpPhase) * bumpAmp;
    const grain = (rng() - 0.5) * grainAmp * 2;
    const tangentGrain = (rng() - 0.5) * grainAmp * 2;

    const r = arcRadius + wander + bump + grain;
    const x = arcCenterX + Math.cos(angle) * r + Math.sin(angle) * tangentGrain;
    const y = arcCenterY + Math.sin(angle) * r - Math.cos(angle) * tangentGrain;
    points.push({ x, y, progress, angle });
  }
  return points;
}

/** Curls offshoots with bump-modulated angle so they read as twigs, not arcs. */
function walkBranch(rng, startX, startY, startAngle, length, stepSize, curlBias) {
  const points = [];
  let x = startX;
  let y = startY;
  let angle = startAngle;
  const steps = Math.ceil(length / stepSize);
  // Pre-generate bump pattern for this branch
  const bumpPhase = rng() * Math.PI * 2;
  const bumpFreq = 4 + rng() * 4;
  const bumpAmp = 0.08 + rng() * 0.06;

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    points.push({ x, y, progress });
    const bump = Math.sin(progress * Math.PI * 2 * bumpFreq + bumpPhase) * bumpAmp;
    angle += curlBias + bump + (rng() - 0.5) * 0.12;
    x += Math.cos(angle) * stepSize;
    y += Math.sin(angle) * stepSize;
  }
  return points;
}

/** Rotates the whole arc — including the right-side opening — into final composition orientation. */
function rotatePoint(point) {
  const rotationAngle = (52 * Math.PI) / 180; // clockwise; 52 degrees positions the C opening to the upper-right of the canvas
  const dx = point.x - CENTER;
  const dy = point.y - CENTER;
  const cos = Math.cos(rotationAngle);
  const sin = Math.sin(rotationAngle);
  return { ...point, x: CENTER + dx * cos + dy * sin, y: CENTER - dx * sin + dy * cos };
}

function buildOvergrowth() {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  const arcRng = phaseRng("overgrowth", "arc5");
  const glowBuf = new Float32Array(SIZE * SIZE);

  // Main arc — wide C-shape opening to the right, ~200 degrees of arc.
  const arcCenterX = CENTER + 150;
  const arcCenterY = CENTER;
  const arcRadius = 500;
  const arcStartAngle = 0.9;
  const arcEndAngle = Math.PI * 2 - 0.9;
  const mainPointsRaw = walkArc(arcRng, arcCenterX, arcCenterY, arcRadius, arcStartAngle, arcEndAngle, 500);
  const mainPoints = mainPointsRaw.map(rotatePoint);

  // Glow halo along the arc — peaks at the C's midpoint and tapers at the tips.
  for (const point of mainPoints) {
    const midFactor = 1 - Math.abs(point.progress - 0.5) * 1.6;
    const thickness = 50 + Math.max(0, midFactor) * 55;
    splatDensity(glowBuf, point.x, point.y, thickness, 0.2 + Math.max(0, midFactor) * 0.3);
  }

  // 3 offshoot branches curling outward from the arc — spawn fractions and curl directions paired by index below.
  const offshootSpawns = [0.15, 0.5, 0.85];
  const offshootCurls = [0.04, -0.035, 0.04];
  const allBranchPoints = [...mainPoints];
  const offshootPaths = [];

  const rotatedArcCenter = rotatePoint({ x: arcCenterX, y: arcCenterY });

  for (let i = 0; i < 3; i++) {
    const spawnIndex = Math.floor(offshootSpawns[i] * mainPoints.length);
    const spawnPoint = mainPoints[spawnIndex];
    const outwardAngle = Math.atan2(spawnPoint.y - rotatedArcCenter.y, spawnPoint.x - rotatedArcCenter.x);
    const forkAngle = outwardAngle + (arcRng() - 0.5) * 0.7;
    const offshootLength = 200 + arcRng() * 180;
    const offshootPointsRaw = walkBranch(
      arcRng,
      spawnPoint.x,
      spawnPoint.y,
      forkAngle,
      offshootLength,
      4,
      offshootCurls[i],
    );
    const offshootPoints = offshootPointsRaw;
    allBranchPoints.push(...offshootPoints);
    offshootPaths.push(offshootPoints);

    for (const point of offshootPoints) {
      const taper = 1 - point.progress * 0.6;
      const thickness = 35 + taper * 40;
      splatDensity(glowBuf, point.x, point.y, thickness, 0.12 + taper * 0.22);
    }
  }

  // Desaturated grey-brown glow — keeps the leaf greens reading as the only color in the piece.
  compositeLayer(canvas, glowBuf, 45, 42, 38, 0.72);

  // Phase 2: solid branch strokes laid over the glow halo.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Main arc stroke — bark texture comes from the jitter baked into mainPoints, not from this loop.
  for (let i = 1; i < mainPoints.length; i++) {
    const previous = mainPoints[i - 1];
    const current = mainPoints[i];
    const midFactor = 1 - Math.abs(current.progress - 0.5) * 1.4;
    const width = 4 + Math.max(0, midFactor) * 5;
    ctx.globalAlpha = 0.4 + Math.max(0, midFactor) * 0.3;
    ctx.strokeStyle = "#252220";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }

  // Offshoot strokes — taper toward the tip so they look like thinning twigs.
  for (const offshoot of offshootPaths) {
    for (let i = 1; i < offshoot.length; i++) {
      const previous = offshoot[i - 1];
      const current = offshoot[i];
      const taper = 1 - current.progress * 0.8;
      const width = 3 + taper * 4.5;
      ctx.globalAlpha = 0.35 + taper * 0.3;
      ctx.strokeStyle = "#252220";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
    }
  }

  // Phase 3: leaf clusters — the only saturated color, painted last to sit on top of branches.
  const leafRng = phaseRng("overgrowth", "leaves5");
  const leafColors = ["#50a030", "#60b040", "#40882a", "#70c050", "#80d060", "#55a535", "#45953a", "#90dd70"];

  // Leaf clusters along the inside of the arc — offset toward the C's center so they hug the concave face.
  const leafArcSpots = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
  for (const spot of leafArcSpots) {
    const index = Math.floor(spot * mainPoints.length);
    const point = mainPoints[index];
    const inwardAngle = Math.atan2(rotatedArcCenter.y - point.y, rotatedArcCenter.x - point.x);
    const offsetDistance = 12 + leafRng() * 18;
    const clusterX = point.x + Math.cos(inwardAngle) * offsetDistance;
    const clusterY = point.y + Math.sin(inwardAngle) * offsetDistance;
    const count = 35 + Math.floor(leafRng() * 25);
    const spread = 30 + leafRng() * 35;
    placeLeafBatch(ctx, leafRng, clusterX, clusterY, leafColors, count, spread);
  }

  // Leaf clusters near the offshoot tips — placed at 0.75 progress so leaves sit slightly inboard, not at the very point.
  for (const offshoot of offshootPaths) {
    const tipIndex = Math.floor(offshoot.length * 0.75);
    const tip = offshoot[tipIndex];
    const count = 28 + Math.floor(leafRng() * 18);
    const spread = 28 + leafRng() * 22;
    placeLeafBatch(ctx, leafRng, tip.x, tip.y, leafColors, count, spread);
  }

  // Large leaf clusters at the offshoot-to-arc junctions — anchors the eye where two branches meet.
  for (let i = 0; i < 3; i++) {
    const spawnIndex = Math.floor(offshootSpawns[i] * mainPoints.length);
    const junction = mainPoints[spawnIndex];
    const count = 60 + Math.floor(leafRng() * 30);
    const spread = 50 + leafRng() * 35;
    placeLeafBatch(ctx, leafRng, junction.x, junction.y, leafColors, count, spread);
  }

  // Phase 4: radial alpha fade so the nebula blends into the void instead of cutting off at the canvas edge.
  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  const pixels = imageData.data;
  const fadeStart = 0.72;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = px - CENTER,
        dy = py - CENTER;
      const distance = Math.sqrt(dx * dx + dy * dy) / (SIZE * 0.5);
      if (distance > fadeStart) {
        const fade = Math.min(1, (distance - fadeStart) / (1.0 - fadeStart));
        const pixelIndex = (py * SIZE + px) * 4;
        pixels[pixelIndex + 3] = Math.round(pixels[pixelIndex + 3] * (1 - fade));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/** Scatters a cluster of small dots in a randomized disc — used for both arc-side and tip leaves. */
function placeLeafBatch(ctx, rng, cx, cy, colors, count, spread) {
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = rng() * spread;
    const leafX = cx + Math.cos(angle) * distance;
    const leafY = cy + Math.sin(angle) * distance;
    const leafSize = 0.6 + rng() * 1.8;
    ctx.globalAlpha = 0.4 + rng() * 0.45;
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.beginPath();
    ctx.arc(leafX, leafY, leafSize, 0, Math.PI * 2);
    ctx.fill();
  }
}

const canvas = buildOvergrowth();
const filename = "nebula-overgrowth.png";
const outPath = path.join(outDir, filename);
fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
console.log(`Built ${filename} (${SIZE}x${SIZE})`);
