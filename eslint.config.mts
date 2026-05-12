import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

const browserTypeScriptFiles = [
  "src/**/*.{ts,tsx,mts,cts}",
  "data/**/*.{ts,tsx,mts,cts}",
];

const nodeTypeScriptFiles = [
  "vite.config.ts",
  "eslint.config.mts",
  "dev/**/*.{ts,tsx,mts,cts}",
  "src/editor/tools/**/*.{ts,tsx,mts,cts}",
];

const nodeJavaScriptFiles = [
  "dev/**/*.{js,mjs,cjs}",
];

const repositoryTypeScriptFiles = [
  ...browserTypeScriptFiles,
  ...nodeTypeScriptFiles,
];

const repositoryLintFiles = [
  ...repositoryTypeScriptFiles,
  ...nodeJavaScriptFiles,
];

export default defineConfig(
  // Keep repo-wide ignores limited to generated, vendored, or local-only output.
  globalIgnores([
    "node_modules/**",
    "dist/**",
    "build/**",
    "local/**",
    "dev/phaser-docs.local/**",
    ".claude/worktrees/**",
  ]),

  // Scope the baseline bug-prevention rules to the files this repo explicitly
  // owns instead of relying on ESLint's default filesystem matching.
  {
    ...js.configs.recommended,
    files: repositoryLintFiles,
  },

  // Apply the TypeScript preset only to repo-owned TypeScript files.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: repositoryTypeScriptFiles,
  })),

  // Browser/runtime code: the actual game and the in-browser economy editor both
  // use DOM globals, browser APIs, and Phaser-driven UI wiring.
  //
  // `src/**/sim-*.ts` is excluded here so it does NOT inherit `globals.browser`.
  // The sim block below gives those files a Node-only global set; without that
  // exclusion, accidental `document` / `requestAnimationFrame` / `fetch` usage
  // would lint clean, defeating the sim/render boundary.
  {
    files: browserTypeScriptFiles,
    ignores: [
      "src/editor/tools/**/*.{ts,tsx,mts,cts}",
      "src/**/sim-*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // DOM lookup patterns in this codebase intentionally assert presence after
      // grabbing fixed HUD elements from index.html.
      "@typescript-eslint/no-non-null-assertion": "off",

      // Type-only imports keep emitted code cleaner and make intent obvious in
      // larger simulation/render files, but this should stay advisory for now.
      "@typescript-eslint/consistent-type-imports": "warn",

      // Phaser callbacks and DOM handlers often receive unused placeholder args.
      // Underscore-prefixed names should be allowed for that case.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Browser game code and in-repo tooling use console intentionally for dev
      // toggles, diagnostics, and simulation output.
      "no-console": "off",
    },
  },

  // Node-side TypeScript config and dev scripts: asset generators, Vite config,
  // and CLI analysis tools run under Node, not in the browser. Keep the
  // browser economy editor entrypoints out of this block.
  {
    files: nodeTypeScriptFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ESM Node scripts in this repo still use deliberate non-null assertions in
      // a few file-system and data-loading paths.
      "@typescript-eslint/no-non-null-assertion": "off",

      // Keep nudging TS files toward explicit type imports without making that a
      // blocking migration task across the dev tools folder.
      "@typescript-eslint/consistent-type-imports": "warn",

      // CLI tools also use placeholder callback args and temporary variables.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Console output is the primary interface for these scripts.
      "no-console": "off",
    },
  },

  // Node-side JavaScript tools only need Node globals plus the shared core JS
  // recommendations from @eslint/js above.
  {
    files: nodeJavaScriptFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // Static-page smoke tests run under Node (Puppeteer driver) but pass callbacks
  // into `page.evaluate(() => ...)` that execute in the browser context. Allow
  // both global sets so DOM references inside those callbacks lint clean.
  {
    files: ["dev/static-tests/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Tests are lightweight repo-local scripts rather than a full framework setup.
  // Give them Node globals and keep console output available for custom test runners.
  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // Simulation files must stay engine-headless (Node, no Phaser, no DOM) so
  // unit tests and the CLI economy report can run without a browser.
  // See AGENTS.md §Separation of concerns.
  //
  // Enforced in three layers: (1) the browser block above excludes `**/sim-*.ts`
  // so browser globals fail `no-undef`; (2) `no-restricted-imports` bans the
  // impure layers (phaser/render/ui/editor/static-pages/game) to block
  // transitive re-export paths; (3) `no-restricted-globals` fires as a
  // fallback with a sim-boundary-specific message if layer (1) is ever
  // weakened (e.g. a test-block overlap re-introducing `globals.browser`).
  //
  // Known gaps (not enforced):
  //  - `globalThis.document` bracket-access escapes all three layers. Accidental
  //    breach only; no rule catches determined circumvention.
  //  - Pure helpers at src/ root (util-ids, util-html-escape, util-date-format)
  //    are implicitly allowed. If one grows a DOM/Phaser dep, add its path to
  //    the ban list below.
  //  - src/editor/tools/** imports sim directly — reverse direction, intended.
  {
    files: ["src/**/sim-*.ts"],
    languageOptions: {
      // Sim runs under Node (tests + CLI); browser globals would fail no-undef.
      globals: { ...globals.node },
    },
    rules: {
      // Match the browser block's defaults so sim isn't accidentally stricter.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",

      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["phaser", "phaser/*"],
              message: "Simulation files must not import the Phaser runtime — the game must run headless for economy reports and unit tests. Move render-dependent code to src/phaser/ or to a render-* module.",
            },
            {
              group: ["**/phaser/**"],
              message: "Simulation files must not import from src/phaser/ — these files transitively pull in Phaser through re-exports. Move pure helpers to a render-* module if they don't need Phaser, or expose sim-safe values through data/.",
            },
            {
              group: ["**/render-*"],
              message: "Simulation files must not import from render-* modules — render helpers may use Canvas2D / DOM APIs. Sim code stays engine-headless; expose sim-safe values through data/ if needed.",
            },
            {
              group: ["**/ui-*"],
              message: "Simulation files must not import from ui-* modules — UI code uses DOM globals (document / window) and must not be reachable from sim.",
            },
            {
              group: ["**/audio-*"],
              message: "Simulation files must not import from audio-* modules — they use AudioContext, fetch, and Vite asset globbing, which the headless sim can't run.",
            },
            {
              group: ["**/game", "**/game-entry"],
              message: "Simulation files must not import from src/game.ts or src/game-entry.ts — these are top-level browser entry points that bring in Phaser + DOM.",
            },
            {
              group: ["**/editor/**"],
              message: "Simulation files must not import from src/editor/ — the editor spans all layers by design. Editor imports sim; sim must not import editor.",
            },
            {
              group: ["**/static-pages/**"],
              message: "Simulation files must not import from src/static-pages/ — these are standalone HTML-page modules with DOM dependencies.",
            },
          ],
        },
      ],

      "no-restricted-globals": [
        "error",
        { name: "document", message: "Simulation files cannot use DOM globals. Move DOM work to a ui-* or render-* module." },
        { name: "window", message: "Simulation files cannot use DOM globals." },
        { name: "navigator", message: "Simulation files cannot use DOM globals." },
        { name: "localStorage", message: "Simulation files cannot use DOM globals. Use src/storage-save-slots.ts for persistence." },
        { name: "sessionStorage", message: "Simulation files cannot use DOM globals." },
        { name: "HTMLElement", message: "Simulation files cannot use DOM types — use domain types from data/ instead." },
        { name: "requestAnimationFrame", message: "Simulation files cannot use browser animation frame callbacks — sim progresses on sim ticks, not wall-clock frames." },
        { name: "cancelAnimationFrame", message: "Simulation files cannot use browser animation frame callbacks." },
        { name: "fetch", message: "Simulation files cannot perform browser network I/O — it is outside the sim loop and not deterministic." },
      ],
    },
  },
);
