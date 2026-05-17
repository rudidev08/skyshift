import { resolve } from "node:path";
import { defineConfig } from "vite";
import { economyApiPlugin } from "./dev/vite/economy-api-plugin";
import { htmlRoutePlugin } from "./dev/vite/html-route-plugin";

const repositoryRoot = import.meta.dirname!;

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
const cleanUrlRouteDefinitions = [
  { routePattern: /^\/start\/[^/]+\/?$/, templatePath: "universe.html" },
  { routePattern: /^\/universe\/?$/, templatePath: "universe.html" },
];

export default defineConfig({
  base: "/",
  appType: "mpa",
  plugins: [htmlRoutePlugin(cleanUrlRouteDefinitions), economyApiPlugin()],
  build: {
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
