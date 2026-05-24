import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const tilesDir = path.join(root, "local/images");
const outDir = path.join(root, "src/assets/backgrounds");

const SIZE = 1024;
const TILE = 16;
const ROTATIONS = [0, 90, 180, 270];

const variants = {
  strong: ["background_space_strong1.png", "background_space_strong2.png", "background_space_strong3.png"],
  medium: ["background_space_medium1.png", "background_space_medium2.png", "background_space_medium3.png"],
  weak: ["background_space_weak1.png", "background_space_weak2.png", "background_space_weak3.png"],
};

function pickFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function rotateTile(filePath) {
  const angle = ROTATIONS[Math.floor(Math.random() * ROTATIONS.length)];
  if (angle === 0) return filePath;
  return await sharp(filePath).rotate(angle).toBuffer();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomTileCoord() {
  return Math.floor(Math.random() * (SIZE - TILE));
}

async function composeTileAt(file, left, top) {
  return {
    input: await rotateTile(path.join(tilesDir, file)),
    left,
    top,
  };
}

async function placeClusterAround(seedLeft, seedTop, clusterOptions, pickTile, composites, remainingCount) {
  const extraStarCount =
    clusterOptions.clusterMin + Math.floor(Math.random() * (clusterOptions.clusterMax - clusterOptions.clusterMin + 1));
  const cap = Math.min(extraStarCount, remainingCount);
  let placed = 0;
  for (let j = 0; j < cap; j++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * clusterOptions.clusterRadius;
    composites.push(
      await composeTileAt(
        pickTile(),
        clamp(Math.round(seedLeft + Math.cos(angle) * distance), 0, SIZE - TILE),
        clamp(Math.round(seedTop + Math.sin(angle) * distance), 0, SIZE - TILE),
      ),
    );
    placed++;
  }
  return placed;
}

async function buildLayer(filename, count, pickTile, guaranteedTiles, clusterOptions = {}) {
  const composites = [];

  // Place each required file once before random fill so every variant is guaranteed in the output.
  for (const file of guaranteedTiles) {
    composites.push(await composeTileAt(file, randomTileCoord(), randomTileCoord()));
  }

  // Each placed star may seed a cluster of nearby stars when clusterOptions.cluster is set.
  for (let i = composites.length; i < count; i++) {
    const cx = randomTileCoord();
    const cy = randomTileCoord();

    composites.push(await composeTileAt(pickTile(), cx, cy));

    if (clusterOptions.cluster && Math.random() < clusterOptions.clusterChance) {
      i += await placeClusterAround(cx, cy, clusterOptions, pickTile, composites, count - composites.length);
    }
  }

  const outPath = path.join(outDir, filename);
  await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  console.log(`Built ${filename} (${SIZE}x${SIZE}, ${count} tiles)`);
}

const totalSlots = (SIZE / TILE) * (SIZE / TILE); // 4096

// Far layer (drawn behind near layer): sparse medium tiles with each strong variant guaranteed once.
await buildLayer(
  "stars-far.png",
  Math.round(totalSlots * 0.005),
  () => {
    return pickFrom(variants.medium);
  },
  [...variants.medium, ...variants.strong],
);

// Near layer (drawn in front of far layer): denser weak tiles with clustering for visual variety.
const nearCount = Math.round(totalSlots * 0.025);
const CLUSTER_CHANCE = 0.15; // chance a star spawns a cluster
const CLUSTER_MIN = 2;
const CLUSTER_MAX = 6;
const CLUSTER_RADIUS = 128; // px spread from cluster center

await buildLayer("stars-near.png", nearCount, () => pickFrom(variants.weak), variants.weak, {
  cluster: true,
  clusterChance: CLUSTER_CHANCE,
  clusterMin: CLUSTER_MIN,
  clusterMax: CLUSTER_MAX,
  clusterRadius: CLUSTER_RADIUS,
});
