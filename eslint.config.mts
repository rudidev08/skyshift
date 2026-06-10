import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import type { Linter } from "eslint";

const browserTypeScriptFiles = ["src/**/*.{ts,tsx,mts,cts}", "data/**/*.{ts,tsx,mts,cts}"];

const nodeTypeScriptFiles = [
  "vite.config.ts",
  "eslint.config.mts",
  "dev/**/*.{ts,tsx,mts,cts}",
  "src/editor/tools/**/*.{ts,tsx,mts,cts}",
];

const nodeJavaScriptFiles = ["dev/**/*.{js,mjs,cjs}"];

const repositoryTypeScriptFiles = [...browserTypeScriptFiles, ...nodeTypeScriptFiles];

const repositoryLintFiles = [...repositoryTypeScriptFiles, ...nodeJavaScriptFiles];

// Baseline shared by every TypeScript block (browser, node tooling, sim).
// DOM-assertion patterns and console-driven dev/diagnostic output are intentional
// throughout the repo; underscore-prefixed unused vars are reserved for Phaser/DOM
// callback placeholder args; type-imports stay advisory rather than blocking.
const sharedRepoRules: Linter.RulesRecord = {
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
};

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
    ignores: ["src/editor/tools/**/*.{ts,tsx,mts,cts}", "src/**/sim-*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...sharedRepoRules,
      // Shipping browser runtime: a stray console.log is debug residue, so flag it
      // (and console.debug) while leaving console.warn / console.error available for
      // genuine runtime diagnostics. Node tooling and tests keep console fully open
      // via their own blocks.
      "no-console": ["warn", { allow: ["warn", "error"] }],
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
      ...sharedRepoRules,
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

  // Static-page load checks run under Node (Puppeteer driver) but pass callbacks
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
  //    the ban list below (as done for util-analytics).
  //  - src/editor/tools/** imports sim directly — reverse direction, intended.
  {
    files: ["src/**/sim-*.ts"],
    languageOptions: {
      // Sim runs under Node (tests + CLI); browser globals would fail no-undef.
      globals: { ...globals.node },
    },
    rules: {
      // Match the browser block's defaults so sim isn't accidentally stricter.
      ...sharedRepoRules,
      // Same console guardrail as the browser block: sim ships in the browser
      // bundle too, so flag stray console.log / console.debug while keeping
      // console.warn / console.error open for diagnostics.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["phaser", "phaser/*"],
              message:
                "Simulation files must not import the Phaser runtime — the game must run headless for economy reports and unit tests. Move render-dependent code to src/phaser/ or to a render-* module.",
            },
            {
              group: ["**/phaser/**"],
              message:
                "Simulation files must not import from src/phaser/ — these files transitively pull in Phaser through re-exports. Move pure helpers to a render-* module if they don't need Phaser, or expose sim-safe values through data/.",
            },
            {
              group: ["**/render-*"],
              message:
                "Simulation files must not import from render-* modules — render helpers may use Canvas2D / DOM APIs. Sim code stays engine-headless; expose sim-safe values through data/ if needed.",
            },
            {
              group: ["**/ui-*"],
              message:
                "Simulation files must not import from ui-* modules — UI code uses DOM globals (document / window) and must not be reachable from sim.",
            },
            {
              group: ["**/audio-*"],
              message:
                "Simulation files must not import from audio-* modules — they use AudioContext, fetch, and Vite asset globbing, which the headless sim can't run.",
            },
            {
              group: ["**/game", "**/game-entry"],
              message:
                "Simulation files must not import from src/game.ts or src/game-entry.ts — these are top-level browser entry points that bring in Phaser + DOM.",
            },
            {
              group: ["**/editor/**"],
              message:
                "Simulation files must not import from src/editor/ — the editor spans all layers by design. Editor imports sim; sim must not import editor.",
            },
            {
              group: ["**/static-pages/**"],
              message:
                "Simulation files must not import from src/static-pages/ — these are standalone HTML-page modules with DOM dependencies.",
            },
            {
              group: ["**/util-analytics"],
              message:
                "Simulation files must not import util-analytics — it injects the Vercel Analytics beacon (writes window.va, appends a script tag), which the headless sim can't run.",
            },
          ],
        },
      ],

      "no-restricted-globals": [
        "error",
        {
          name: "document",
          message: "Simulation files cannot use DOM globals. Move DOM work to a ui-* or render-* module.",
        },
        { name: "window", message: "Simulation files cannot use DOM globals." },
        { name: "navigator", message: "Simulation files cannot use DOM globals." },
        {
          name: "localStorage",
          message: "Simulation files cannot use DOM globals. Use src/storage-save-slots.ts for persistence.",
        },
        { name: "sessionStorage", message: "Simulation files cannot use DOM globals." },
        {
          name: "HTMLElement",
          message: "Simulation files cannot use DOM types — use domain types from data/ instead.",
        },
        {
          name: "requestAnimationFrame",
          message:
            "Simulation files cannot use browser animation frame callbacks — sim progresses on sim ticks, not wall-clock frames.",
        },
        {
          name: "cancelAnimationFrame",
          message: "Simulation files cannot use browser animation frame callbacks.",
        },
        {
          name: "fetch",
          message:
            "Simulation files cannot perform browser network I/O — it is outside the sim loop and not deterministic.",
        },
      ],
    },
  },

  // ui-* modules are DOM panels outside the Phaser canvas — they must stay
  // loadable without the engine (AGENTS.md §Separation of concerns). Runtime
  // values cross this boundary through render-* seams or setup-time injection;
  // type-only imports are erased at compile time and stay legal.
  {
    files: ["src/ui-*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["phaser", "phaser/*", "**/phaser/**"],
              allowTypeImports: true,
              message:
                "ui-* modules must not import Phaser or src/phaser/ values — move shared helpers to a render-* module or inject them where the panel is wired (type-only imports are fine).",
            },
          ],
        },
      ],
    },
  },
);
