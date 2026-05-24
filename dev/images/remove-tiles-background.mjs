import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.resolve(__dirname, "../../local/images/backup");
const tilesDir = path.resolve(__dirname, "../../local/images");

function findMostCommonColor(data) {
  const pixelCountByColor = {};
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    pixelCountByColor[key] = (pixelCountByColor[key] || 0) + 1;
  }
  let backgroundColorKey = "";
  let maxCount = 0;
  for (const [key, count] of Object.entries(pixelCountByColor)) {
    if (count > maxCount) {
      maxCount = count;
      backgroundColorKey = key;
    }
  }
  const [r, g, b] = backgroundColorKey.split(",").map(Number);
  return { r, g, b };
}

function replaceColorWithTransparency(data, { r, g, b }) {
  let replaced = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === r && data[i + 1] === g && data[i + 2] === b) {
      data[i + 3] = 0;
      replaced++;
    }
  }
  return replaced;
}

const files = fs
  .readdirSync(backupDir)
  .filter((f) => f.startsWith("background_space_") && f.endsWith(".png"));

for (const file of files) {
  const { data, info } = await sharp(path.join(backupDir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const backgroundColor = findMostCommonColor(data);
  const replaced = replaceColorWithTransparency(data, backgroundColor);

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(path.join(tilesDir, file));

  const { r, g, b } = backgroundColor;
  console.log(`${file}: replaced ${replaced} pixels of background color (${r},${g},${b})`);
}
