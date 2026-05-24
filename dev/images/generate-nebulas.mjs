import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { phaseRng, splatDensity, compositeLayer } from "./nebula-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../..", "src/assets/backgrounds");

const SIZE = 1500;
const CENTER = SIZE / 2;

function parseHex(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function drawBlob(ctx, cx, cy, radius, fillStyle, maxAlpha, steps = 60) {
  for (let i = steps; i >= 0; i--) {
    const frac = i / steps;
    ctx.globalAlpha = (1 - frac * frac) * maxAlpha;
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderDensity(buf, r, g, b, peakAlpha) {
  let maxVal = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > maxVal) maxVal = buf[i];
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(0, buf[i]) / maxVal;
    const curved = v * v;
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = Math.round(curved * peakAlpha * 255);
  }
  return pixels;
}

function createCanvasFromPixels(pixels) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(SIZE, SIZE);
  imgData.data.set(pixels);
  ctx.putImageData(imgData, 0, 0);
  return { canvas, ctx };
}

function buildCore() {
  const { r, g, b } = parseHex("#4A3050");

  // Phase 1: purple nebula — asymmetric clusters, NOT a ring
  const baseRng = phaseRng("core", "base");
  const buf = new Float32Array(SIZE * SIZE);

  const purpleClusters = [
    { x: CENTER - 350, y: CENTER - 200 },
    { x: CENTER + 200, y: CENTER - 380 },
    { x: CENTER + 400, y: CENTER + 100 },
    { x: CENTER - 100, y: CENTER + 400 },
    { x: CENTER - 400, y: CENTER + 200 },
    { x: CENTER + 250, y: CENTER + 350 },
    { x: CENTER + 50, y: CENTER - 450 },
  ];

  for (let s = 0; s < 600; s++) {
    const cl = purpleClusters[Math.floor(baseRng() * purpleClusters.length)];
    const cx = cl.x + (baseRng() - 0.5) * 350;
    const cy = cl.y + (baseRng() - 0.5) * 350;
    const radius = 50 + baseRng() * 180;
    const intensity = 0.3 + baseRng() * 0.7;
    splatDensity(buf, { cx, cy, radius, intensity }, SIZE);
  }

  const voidsRng = phaseRng("core", "voids");
  for (let v = 0; v < 10; v++) {
    const cx = CENTER + (voidsRng() - 0.5) * 400;
    const cy = CENTER + (voidsRng() - 0.5) * 400;
    const radius = 100 + voidsRng() * 200;
    splatDensity(buf, { cx, cy, radius, intensity: -(0.5 + voidsRng() * 0.6) }, SIZE);
  }

  const pixels = renderDensity(buf, r, g, b, 0.625);
  const { canvas, ctx } = createCanvasFromPixels(pixels);

  // Phase 3: dark interior — many overlapping low-alpha blobs for smooth coverage
  const darkOverlayRng = phaseRng("core", "dark-overlay");
  const darkRadius = 550;
  const darkAnchors = [];
  // Hardcoded so regenerated PNGs match across runs; varying distances keep the dark mass off-center.
  const anchorAngles = [0.4, 1.5, 2.8, 3.9, 5.2, 0.8];
  const anchorDists = [0.2, 0.7, 0.4, 0.9, 0.5, 0.3];
  for (let i = 0; i < 6; i++) {
    const dist = anchorDists[i] * darkRadius;
    darkAnchors.push({
      x: CENTER + Math.cos(anchorAngles[i]) * dist + (darkOverlayRng() - 0.5) * 250,
      y: CENTER + Math.sin(anchorAngles[i]) * dist + (darkOverlayRng() - 0.5) * 250,
    });
  }
  for (let s = 0; s < 100; s++) {
    const anchor = darkAnchors[Math.floor(darkOverlayRng() * darkAnchors.length)];
    const cx = anchor.x + (darkOverlayRng() - 0.5) * 400;
    const cy = anchor.y + (darkOverlayRng() - 0.5) * 400;
    const blobRadius = 80 + darkOverlayRng() * 300;
    drawBlob(ctx, cx, cy, blobRadius, "#000000", 0.015, 40);
  }

  return canvas;
}

function buildSkyshiftBase() {
  const { r, g, b } = parseHex("#2A4070");
  const baseRng = phaseRng("skyshift", "base");
  const baseBuf = new Float32Array(SIZE * SIZE);

  const clusterCount = 7 + Math.floor(baseRng() * 4);
  const clusters = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      x: CENTER + (baseRng() - 0.5) * SIZE * 0.7,
      y: CENTER + (baseRng() - 0.5) * SIZE * 0.7,
      weight: 0.4 + baseRng() * 0.6,
    });
  }

  for (let s = 0; s < 800; s++) {
    const cluster = clusters[Math.floor(baseRng() * clusters.length)];
    const spread = 150 + baseRng() * 400;
    const cx = cluster.x + (baseRng() - 0.5) * spread * 2;
    const cy = cluster.y + (baseRng() - 0.5) * spread * 2;
    const radius = 40 + baseRng() * 180;
    const intensity = (0.3 + baseRng() * 0.7) * cluster.weight;
    splatDensity(baseBuf, { cx, cy, radius, intensity }, SIZE);
  }

  for (let v = 0; v < 5; v++) {
    const cx = CENTER + (baseRng() - 0.5) * SIZE * 0.5;
    const cy = CENTER + (baseRng() - 0.5) * SIZE * 0.5;
    const radius = 100 + baseRng() * 200;
    splatDensity(baseBuf, { cx, cy, radius, intensity: -(0.3 + baseRng() * 0.4) }, SIZE);
  }

  const pixels = renderDensity(baseBuf, r, g, b, 0.6875);
  const { canvas, ctx } = createCanvasFromPixels(pixels);
  return { canvas, ctx, clusters };
}

function paintSkyshiftWhiteOverlay(canvas, clusters) {
  const whiteRng = phaseRng("skyshift", "white");
  const whiteBuf = new Float32Array(SIZE * SIZE);
  for (let s = 0; s < 600; s++) {
    const cluster = clusters[Math.floor(whiteRng() * clusters.length)];
    const spread = 100 + whiteRng() * 300;
    const cx = cluster.x + (whiteRng() - 0.5) * spread * 2;
    const cy = cluster.y + (whiteRng() - 0.5) * spread * 2;
    const radius = 30 + whiteRng() * 120;
    const intensity = (0.2 + whiteRng() * 0.8) * cluster.weight;
    splatDensity(whiteBuf, { cx, cy, radius, intensity }, SIZE);
  }
  for (let v = 0; v < 6; v++) {
    const cx = CENTER + (whiteRng() - 0.5) * SIZE * 0.6;
    const cy = CENTER + (whiteRng() - 0.5) * SIZE * 0.6;
    const radius = 80 + whiteRng() * 150;
    splatDensity(whiteBuf, { cx, cy, radius, intensity: -(0.3 + whiteRng() * 0.5) }, SIZE);
  }
  compositeLayer(canvas, whiteBuf, { r: 220, g: 230, b: 245, peakAlpha: 0.45 }, SIZE);
}

function paintSkyshiftStreaks(ctx, clusters) {
  const streaksRng = phaseRng("skyshift", "streaks");
  const streakColors = ["#ddeeff", "#c8dfff", "#e8f4ff"];

  // Place streaks near brightest nebula clusters, oriented mostly parallel to center.
  const sortedClusters = [...clusters].sort((a, b) => b.weight - a.weight);
  let clusterIdx = 1; // Skip index 0 — that's where the crossing pair lives.
  function streakNearCluster() {
    const cl = sortedClusters[clusterIdx % sortedClusters.length];
    clusterIdx++;
    const ox = (streaksRng() - 0.5) * 200;
    const oy = (streaksRng() - 0.5) * 200;
    const sx = cl.x + ox;
    const sy = cl.y + oy;
    const radialAngle = Math.atan2(sy - CENTER, sx - CENTER);
    const angle = radialAngle - Math.PI / 2 + (streaksRng() - 0.5) * 0.4;
    return {
      x: sx,
      y: sy,
      angle,
      len: 150 + streaksRng() * 200,
      thick: 8 + streaksRng() * 10,
    };
  }

  const crossCluster = sortedClusters[0];
  const crossX = crossCluster.x + (streaksRng() - 0.5) * 150;
  const crossY = crossCluster.y + (streaksRng() - 0.5) * 150;
  const radAngle = Math.atan2(crossY - CENTER, crossX - CENTER);
  const baseAngle = radAngle - Math.PI / 2;
  const crossStreaks = [
    {
      x: crossX,
      y: crossY,
      angle: baseAngle + (streaksRng() - 0.5) * 0.3,
      len: 200 + streaksRng() * 150,
      thick: 8 + streaksRng() * 10,
    },
    {
      x: crossX,
      y: crossY,
      angle: baseAngle + 0.5 + streaksRng() * 0.6,
      len: 180 + streaksRng() * 150,
      thick: 8 + streaksRng() * 10,
    },
  ];

  const soloStreaks = [];
  for (let i = 0; i < 6; i++) {
    soloStreaks.push(streakNearCluster());
  }

  for (const def of [...crossStreaks, ...soloStreaks]) {
    const alphaBase = 0.015;
    ctx.save();
    ctx.translate(def.x, def.y);
    ctx.rotate(def.angle);
    for (let p = 0; p < 60; p++) {
      const t = p / 59;
      const px = (t - 0.5) * def.len;
      const py = Math.sin(t * Math.PI) * def.thick * 0.5;
      const localThick = def.thick * Math.sin(t * Math.PI);
      for (let si = 4; si >= 0; si--) {
        const frac = si / 4;
        ctx.globalAlpha = (1 - frac) * alphaBase;
        ctx.fillStyle = streakColors[Math.floor(streaksRng() * streakColors.length)];
        ctx.beginPath();
        ctx.arc(px, py, localThick * (0.3 + frac * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function paintSkyshiftBrightSpots(canvas) {
  const brightSpotsRng = phaseRng("skyshift", "bright-spots");
  const brightBuf = new Float32Array(SIZE * SIZE);
  const spots = [
    { x: CENTER + (brightSpotsRng() - 0.5) * 600, y: CENTER + (brightSpotsRng() - 0.5) * 600 },
    { x: CENTER + (brightSpotsRng() - 0.5) * 600, y: CENTER + (brightSpotsRng() - 0.5) * 600 },
    { x: CENTER + (brightSpotsRng() - 0.5) * 600, y: CENTER + (brightSpotsRng() - 0.5) * 600 },
  ];
  for (const spot of spots) {
    for (let s = 0; s < 80; s++) {
      const cx = spot.x + (brightSpotsRng() - 0.5) * 200;
      const cy = spot.y + (brightSpotsRng() - 0.5) * 200;
      const radius = 20 + brightSpotsRng() * 80;
      splatDensity(brightBuf, { cx, cy, radius, intensity: 0.5 + brightSpotsRng() * 0.5 }, SIZE);
    }
  }
  compositeLayer(canvas, brightBuf, { r: 240, g: 245, b: 255, peakAlpha: 0.2 }, SIZE);
}

function buildSkyshift() {
  const { canvas, ctx, clusters } = buildSkyshiftBase();
  paintSkyshiftWhiteOverlay(canvas, clusters);
  paintSkyshiftStreaks(ctx, clusters);
  paintSkyshiftBrightSpots(canvas);
  return canvas;
}

function buildMining() {
  const { r, g, b } = parseHex("#3A2510");

  // Phase 1: nebula patches — placed at specific positions spread across sector
  const baseRng = phaseRng("mining", "base");
  const buf = new Float32Array(SIZE * SIZE);

  // 7 patches arranged along two crossing lines (rotated 90° CW)
  const patches = [
    { x: SIZE * 0.85, y: SIZE * 0.8 },
    { x: SIZE * 0.65, y: SIZE * 0.6 },
    { x: SIZE * 0.45, y: SIZE * 0.4 },
    { x: SIZE * 0.25, y: SIZE * 0.2 },
    { x: SIZE * 0.3, y: SIZE * 0.75 },
    { x: SIZE * 0.4, y: SIZE * 0.55 },
    { x: SIZE * 0.55, y: SIZE * 0.85 },
  ];

  for (const patch of patches) {
    for (let s = 0; s < 220; s++) {
      const cx = patch.x + (baseRng() - 0.5) * 400;
      const cy = patch.y + (baseRng() - 0.5) * 400;
      const radius = 50 + baseRng() * 150;
      const intensity = 0.4 + baseRng() * 0.6;
      splatDensity(buf, { cx, cy, radius, intensity }, SIZE);
    }
  }

  const voidsRng = phaseRng("mining", "voids");
  for (let v = 0; v < 3; v++) {
    const cx = CENTER + (voidsRng() - 0.5) * SIZE * 0.4;
    const cy = CENTER + (voidsRng() - 0.5) * SIZE * 0.4;
    const radius = 60 + voidsRng() * 120;
    splatDensity(buf, { cx, cy, radius, intensity: -(0.15 + voidsRng() * 0.25) }, SIZE);
  }

  const pixels = renderDensity(buf, r, g, b, 0.8125);
  const { canvas, ctx } = createCanvasFromPixels(pixels);

  const asteroidsRng = phaseRng("mining", "asteroids");
  const asteroidColors = ["#4a3a2a", "#5c4a3a", "#3a2e20", "#6b5040"];
  for (const patch of patches) {
    const clusterCount = 8 + Math.floor(asteroidsRng() * 6);
    for (let c = 0; c < clusterCount; c++) {
      const clusterX = patch.x + (asteroidsRng() - 0.5) * 250;
      const clusterY = patch.y + (asteroidsRng() - 0.5) * 250;
      const count = 10 + Math.floor(asteroidsRng() * 18);
      const clusterSpread = 15 + asteroidsRng() * 40;

      for (let i = 0; i < count; i++) {
        const angle = asteroidsRng() * Math.PI * 2;
        const dist = asteroidsRng() * clusterSpread;
        const ax = clusterX + Math.cos(angle) * dist;
        const ay = clusterY + Math.sin(angle) * dist;
        const size = 1 + asteroidsRng() * 2.5;
        ctx.globalAlpha = 0.5 + asteroidsRng() * 0.4;
        ctx.fillStyle = asteroidColors[Math.floor(asteroidsRng() * asteroidColors.length)];
        ctx.beginPath();
        ctx.arc(ax, ay, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const dustRng = phaseRng("mining", "dust");
  for (let c = 0; c < 5; c++) {
    const cx = CENTER + (dustRng() - 0.5) * 1000;
    const cy = CENTER + (dustRng() - 0.5) * 1000;
    const cloudRadius = 80 + dustRng() * 180;
    drawBlob(ctx, cx, cy, cloudRadius, "#000000", 0.012, 30);
  }

  return canvas;
}

function buildOminousBase(rng, anchors) {
  const buf = new Float32Array(SIZE * SIZE);
  for (let s = 0; s < 500; s++) {
    const a = anchors[Math.floor(rng() * anchors.length)];
    const cx = a.x + (rng() - 0.5) * 525;
    const cy = a.y + (rng() - 0.5) * 525;
    const radius = 60 + rng() * 225;
    splatDensity(buf, { cx, cy, radius, intensity: 0.3 + rng() * 0.7 }, SIZE);
  }
  for (let v = 0; v < 8; v++) {
    const cx = CENTER + (rng() - 0.5) * SIZE * 0.4;
    const cy = CENTER + (rng() - 0.5) * SIZE * 0.4;
    splatDensity(buf, { cx, cy, radius: 60 + rng() * 180, intensity: -(0.3 + rng() * 0.5) }, SIZE);
  }
  return buf;
}

function extractRedEdgeBuf(buf, redSectors) {
  let maxVal = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > maxVal) maxVal = buf[i];

  const edgeBuf = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(0, buf[i]) / maxVal;
    if (v < 0.1 || v > 0.45) continue;

    const px = i % SIZE,
      py = Math.floor(i / SIZE);
    let angle = Math.atan2(py - CENTER, px - CENTER);
    if (angle < 0) angle += Math.PI * 2;

    const fadeWidth = 0.3;
    let sectorWeight = 0;
    for (const s of redSectors) {
      if (angle >= s.from && angle <= s.to) {
        const fadeIn = Math.min(1, (angle - s.from) / fadeWidth);
        const fadeOut = Math.min(1, (s.to - angle) / fadeWidth);
        sectorWeight = Math.max(sectorWeight, Math.min(fadeIn, fadeOut));
      }
    }
    if (sectorWeight <= 0) continue;

    const edgeness = 1 - Math.abs(v - 0.25) / 0.2;
    edgeBuf[i] = edgeness * edgeness * sectorWeight;
  }
  return edgeBuf;
}

function paintOminousStarsAndHalo(canvas, ctx, rng, stars) {
  // Red flow nebula around star clusters — wide and prominent
  const starFlowBuf = new Float32Array(SIZE * SIZE);
  for (const star of stars) {
    for (let s = 0; s < 80; s++) {
      const cx = star.x + (rng() - 0.5) * 250;
      const cy = star.y + (rng() - 0.5) * 250;
      const radius = 25 + rng() * 80;
      splatDensity(starFlowBuf, { cx, cy, radius, intensity: 0.3 + rng() * 0.7 }, SIZE);
    }
  }
  compositeLayer(canvas, starFlowBuf, { r: 120, g: 25, b: 20, peakAlpha: 0.25 }, SIZE);

  for (const star of stars) {
    drawBlob(ctx, star.x, star.y, 4, "#cc4030", 0.4, 15);
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#fff0e8";
    ctx.beginPath();
    ctx.arc(star.x, star.y, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildOminous(variant) {
  // Irregular centered dark mass — each variant has unique shape
  const allAnchors = {
    1: [
      { x: CENTER - 200, y: CENTER - 150 },
      { x: CENTER + 180, y: CENTER - 250 },
      { x: CENTER + 280, y: CENTER + 100 },
      { x: CENTER - 100, y: CENTER + 280 },
      { x: CENTER - 300, y: CENTER + 50 },
    ],
    2: [
      { x: CENTER + 150, y: CENTER - 200 },
      { x: CENTER - 250, y: CENTER - 180 },
      { x: CENTER - 150, y: CENTER + 250 },
      { x: CENTER + 300, y: CENTER + 150 },
      { x: CENTER + 50, y: CENTER + 50 },
    ],
    3: [
      { x: CENTER - 100, y: CENTER - 300 },
      { x: CENTER + 250, y: CENTER - 100 },
      { x: CENTER + 100, y: CENTER + 300 },
      { x: CENTER - 280, y: CENTER + 150 },
      { x: CENTER - 50, y: CENTER + 50 },
    ],
  };
  // Extract edge band with red glow on ~33% of perimeter
  const allRedSectors = {
    1: [
      { from: 0.2, to: 1.4 },
      { from: 3.8, to: 4.8 },
    ],
    2: [
      { from: 1.5, to: 2.8 },
      { from: 4.5, to: 5.5 },
    ],
    3: [
      { from: 0.8, to: 2.0 },
      { from: 4.0, to: 5.0 },
    ],
  };
  // Per-variant star anchors — small, near-white points placed inside the nebula mass.
  const allStars = {
    1: [
      { x: CENTER - 80, y: CENTER + 30 },
      { x: CENTER + 200, y: CENTER - 120 },
      { x: CENTER - 150, y: CENTER + 200 },
    ],
    2: [
      { x: CENTER + 120, y: CENTER - 60 },
      { x: CENTER - 100, y: CENTER + 100 },
      { x: CENTER + 50, y: CENTER + 220 },
      { x: CENTER - 200, y: CENTER - 80 },
      { x: CENTER + 250, y: CENTER + 150 },
    ],
    3: [
      { x: CENTER - 50, y: CENTER - 150 },
      { x: CENTER + 150, y: CENTER + 50 },
      { x: CENTER - 30, y: CENTER + 180 },
      { x: CENTER + 230, y: CENTER - 200 },
      { x: CENTER - 180, y: CENTER + 80 },
      { x: CENTER + 80, y: CENTER - 50 },
      { x: CENTER - 250, y: CENTER - 180 },
    ],
  };

  const shapeRng = phaseRng("ominous" + variant, "shape");
  const buf = buildOminousBase(shapeRng, allAnchors[variant]);
  const edgeBuf = extractRedEdgeBuf(buf, allRedSectors[variant]);

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const darkPixels = renderDensity(buf, 8, 4, 6, 0.8);
  const imgData = ctx.createImageData(SIZE, SIZE);
  imgData.data.set(darkPixels);
  ctx.putImageData(imgData, 0, 0);
  compositeLayer(canvas, edgeBuf, { r: 180, g: 40, b: 30, peakAlpha: 0.15 }, SIZE);

  const starflowRng = phaseRng("ominous" + variant, "starflow");
  paintOminousStarsAndHalo(canvas, ctx, starflowRng, allStars[variant]);

  return canvas;
}

function buildVoid(variant) {
  const variantConfig = {
    "1": { starCount: 4, starRadius: 5, starAlpha: 0.45, starSteps: 10, coreRadius: 0.7 },
    "2": { starCount: 2, starRadius: 6, starAlpha: 0.55, starSteps: 12, coreRadius: 0.9 },
  };
  const config = variantConfig[variant];
  const seedKey = variant === "1" ? "void" : "void2";

  const baseRng = phaseRng(seedKey, "base");
  const buf = new Float32Array(SIZE * SIZE);

  // Wide spread teal cloud — 6 clusters spread across sector
  const clusters = [];
  for (let i = 0; i < 6; i++) {
    clusters.push({
      x: CENTER + (baseRng() - 0.5) * SIZE * 0.7,
      y: CENTER + (baseRng() - 0.5) * SIZE * 0.7,
    });
  }
  for (let s = 0; s < 500; s++) {
    const cl = clusters[Math.floor(baseRng() * clusters.length)];
    const cx = cl.x + (baseRng() - 0.5) * 500;
    const cy = cl.y + (baseRng() - 0.5) * 500;
    const radius = 50 + baseRng() * 200;
    splatDensity(buf, { cx, cy, radius, intensity: 0.3 + baseRng() * 0.7 }, SIZE);
  }
  for (let v = 0; v < 6; v++) {
    const cx = CENTER + (baseRng() - 0.5) * SIZE * 0.6;
    const cy = CENTER + (baseRng() - 0.5) * SIZE * 0.6;
    splatDensity(buf, { cx, cy, radius: 80 + baseRng() * 180, intensity: -(0.3 + baseRng() * 0.4) }, SIZE);
  }

  const pixels = renderDensity(buf, 20, 65, 60, 0.35);
  const { canvas, ctx } = createCanvasFromPixels(pixels);

  // Teal dust clusters — concentrated near nebula
  const dustRng = phaseRng(seedKey, "dust");
  const dustColors = ["#205050", "#256060", "#1a4545", "#308070", "#184040"];
  for (let c = 0; c < 8; c++) {
    const ncl = clusters[Math.floor(dustRng() * clusters.length)];
    const dcx = ncl.x + (dustRng() - 0.5) * 300;
    const dcy = ncl.y + (dustRng() - 0.5) * 300;
    const count = 6 + Math.floor(dustRng() * 12);
    const spread = 20 + dustRng() * 50;
    for (let i = 0; i < count; i++) {
      const angle = dustRng() * Math.PI * 2;
      const dist = dustRng() * spread;
      const ax = dcx + Math.cos(angle) * dist;
      const ay = dcy + Math.sin(angle) * dist;
      const size = 0.5 + dustRng() * 2;
      ctx.globalAlpha = 0.5 + dustRng() * 0.4;
      ctx.fillStyle = dustColors[Math.floor(dustRng() * dustColors.length)];
      ctx.beginPath();
      ctx.arc(ax, ay, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Stars inside nebula — teal halo + near-white core.
  for (let i = 0; i < config.starCount; i++) {
    const ncl = clusters[Math.floor(dustRng() * clusters.length)];
    const ax = ncl.x + (dustRng() - 0.5) * 200;
    const ay = ncl.y + (dustRng() - 0.5) * 200;
    drawBlob(ctx, ax, ay, config.starRadius, "#40ccaa", config.starAlpha, config.starSteps);
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#ccffee";
    ctx.beginPath();
    ctx.arc(ax, ay, config.coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function buildPurpleWisp(variant) {
  const baseRng = phaseRng("purple" + variant, "base");
  const buf = new Float32Array(SIZE * SIZE);

  // Elongated wisps — clusters stretched along random angles
  const wispCount = 3 + Math.floor(baseRng() * 2);
  for (let w = 0; w < wispCount; w++) {
    const angle = baseRng() * Math.PI;
    const wcx = CENTER + (baseRng() - 0.5) * SIZE * 0.5;
    const wcy = CENTER + (baseRng() - 0.5) * SIZE * 0.5;
    const len = 300 + baseRng() * 400;
    for (let s = 0; s < 80; s++) {
      const t = baseRng();
      const cx = wcx + Math.cos(angle) * (t - 0.5) * len + (baseRng() - 0.5) * 80;
      const cy = wcy + Math.sin(angle) * (t - 0.5) * len + (baseRng() - 0.5) * 80;
      const radius = 30 + baseRng() * 100;
      splatDensity(buf, { cx, cy, radius, intensity: 0.3 + baseRng() * 0.7 }, SIZE);
    }
  }

  const { r, g, b } = parseHex("#3A2050");
  return createCanvasFromPixels(renderDensity(buf, r, g, b, 0.325)).canvas;
}

function buildDustLane(variant) {
  const baseRng = phaseRng("dust" + variant, "base");
  const buf = new Float32Array(SIZE * SIZE);

  // 2-3 dust bands at random angles
  const bandCount = 2 + Math.floor(baseRng() * 2);
  for (let b = 0; b < bandCount; b++) {
    const angle = baseRng() * Math.PI;
    const bcx = CENTER + (baseRng() - 0.5) * SIZE * 0.3;
    const bcy = CENTER + (baseRng() - 0.5) * SIZE * 0.3;
    const len = 500 + baseRng() * 500;
    for (let s = 0; s < 120; s++) {
      const t = baseRng();
      const cx = bcx + Math.cos(angle) * (t - 0.5) * len + (baseRng() - 0.5) * 60;
      const cy = bcy + Math.sin(angle) * (t - 0.5) * len + (baseRng() - 0.5) * 60;
      const radius = 30 + baseRng() * 80;
      splatDensity(buf, { cx, cy, radius, intensity: 0.3 + baseRng() * 0.7 }, SIZE);
    }
  }

  const { r, g, b } = parseHex("#3A2510");
  const pixels = renderDensity(buf, r, g, b, 0.3);
  const { canvas, ctx } = createCanvasFromPixels(pixels);

  // Asteroid clusters near dust bands (like mining nebula)
  const asteroidsRng = phaseRng("dust" + variant, "asteroids");
  const asteroidColors = ["#4a3a2a", "#5c4a3a", "#3a2e20", "#6b5040"];
  const clusterCount = 4 + Math.floor(asteroidsRng() * 4);
  for (let c = 0; c < clusterCount; c++) {
    const clusterX = CENTER + (asteroidsRng() - 0.5) * SIZE * 0.6;
    const clusterY = CENTER + (asteroidsRng() - 0.5) * SIZE * 0.6;
    const count = 6 + Math.floor(asteroidsRng() * 12);
    const clusterSpread = 15 + asteroidsRng() * 35;
    for (let i = 0; i < count; i++) {
      const angle = asteroidsRng() * Math.PI * 2;
      const dist = asteroidsRng() * clusterSpread;
      const ax = clusterX + Math.cos(angle) * dist;
      const ay = clusterY + Math.sin(angle) * dist;
      const size = 1 + asteroidsRng() * 2.5;
      ctx.globalAlpha = 0.5 + asteroidsRng() * 0.4;
      ctx.fillStyle = asteroidColors[Math.floor(asteroidsRng() * asteroidColors.length)];
      ctx.beginPath();
      ctx.arc(ax, ay, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

const builders = {
  core: buildCore,
  skyshift: buildSkyshift,
  mining: buildMining,
  ominous1: () => buildOminous("1"),
  ominous2: () => buildOminous("2"),
  ominous3: () => buildOminous("3"),
  void1: () => buildVoid("1"),
  void2: () => buildVoid("2"),
  purple1: () => buildPurpleWisp("1"),
  purple2: () => buildPurpleWisp("2"),
  dust1: () => buildDustLane("1"),
  dust2: () => buildDustLane("2"),
};

for (const [id, builder] of Object.entries(builders)) {
  const canvas = builder();
  const filename = `nebula-${id}.png`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`Built ${filename} (${SIZE}x${SIZE})`);
}
