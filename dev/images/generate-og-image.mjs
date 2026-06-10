// Crops a hand-captured landing frame into the social-share image.
//
// Output:
//   - public/og-image.png  (1200×630, the standard link-preview size)
//
// The card is just the landing sector scene — the three stations (Drifthollow,
// Bloomreach, Ironvein) with ships flying between them, no title text. That
// scene is a live animation, so the frame is grabbed by hand (saved as
// dev/images/og-source.png) and this script crops it to the card's wide 1.91:1
// shape and scales to 1200×630.
//
// The three stations sit in a row that's wider than the card, so the crop is
// tuned to keep all three and their labels while trimming the empty space
// around them as tight as that row allows — Bloomreach (top) and Ironvein
// (bottom) land near the top/bottom edges. The constants below are measured
// against the current grab; re-measure them if you replace og-source.png.
// The source is smaller than the card, so it scales up a little.
//
// Re-run after replacing og-source.png:
//   node dev/images/generate-og-image.mjs

import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const sourcePath = path.join(__dirname, "og-source.png");
const outPath = path.join(root, "public", "og-image.png");

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 630;
const targetAspect = TARGET_WIDTH / TARGET_HEIGHT;

// Horizontal crop edges, sitting just outside the outermost labels
// ("Drifthollow" on the left, "Ironvein" on the right).
const CROP_LEFT = 145;
const CROP_RIGHT = 878;
// Vertical extent of the cluster, from the top station's ring to the bottom
// station's label — the crop centers on this so the leftover margin splits
// evenly top and bottom.
const CONTENT_TOP = 190;
const CONTENT_BOTTOM = 505;

const { height: sourceHeight } = await sharp(sourcePath).metadata();

const cropWidth = CROP_RIGHT - CROP_LEFT;
const cropHeight = Math.round(cropWidth / targetAspect);
const contentCenter = (CONTENT_TOP + CONTENT_BOTTOM) / 2;
const cropTop = Math.max(0, Math.min(Math.round(contentCenter - cropHeight / 2), sourceHeight - cropHeight));

await sharp(sourcePath)
  .extract({ left: CROP_LEFT, top: cropTop, width: cropWidth, height: cropHeight })
  .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "fill" })
  .png()
  .toFile(outPath);

const rel = (p) => path.relative(root, p);
console.log(`Wrote ${rel(outPath)}  (${TARGET_WIDTH}×${TARGET_HEIGHT}, cropped ${cropWidth}×${cropHeight} from ${rel(sourcePath)})`);
