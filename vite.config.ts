import { resolve } from "node:path";
import { defineConfig } from "vite";
import { economyApiPlugin } from "./dev/vite/economy-api-plugin";
import { htmlRoutePlugin } from "./dev/vite/html-route-plugin";

const repositoryRoot = import.meta.dirname!;

// Build date (YYYY-MM-DD) stamped into the UI; recomputed on each production build.
const buildDate = new Date().toISOString().slice(0, 10);

const htmlEntryPoints = {
  root: resolve(repositoryRoot, "index.html"),
  notFound: resolve(repositoryRoot, "404.html"),
  universe: resolve(repositoryRoot, "universe.html"),
  tools: resolve(repositoryRoot, "tools.html"),
  lore: resolve(repositoryRoot, "lore.html"),
  design: resolve(repositoryRoot, "design.html"),
  help: resolve(repositoryRoot, "help.html"),
};

// Both /start/:preset (fresh start with a preset) and /universe
// (continue-latest-save) serve the same universe.html shell; game-entry
// parses the path client-side and dispatches on it.
const cleanUrlRoutes = [
  { routePattern: /^\/(start\/[^/]+|universe)\/?$/, templatePath: "universe.html" },
];

export default defineConfig({
  base: "/",
  appType: "mpa",
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [htmlRoutePlugin(cleanUrlRoutes), economyApiPlugin()],
  build: {
    // Browser-support floor for v1, pinned explicitly. These are the versions
    // Vite's default "baseline-widely-available" target currently resolves to;
    // pinning them keeps the floor a deliberate choice instead of quietly
    // shifting when Vite bumps its baseline on a future upgrade.
    target: ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"],
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: htmlEntryPoints,
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) {
            return "phaser";
          }
        },
      },
    },
  },
});
