import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

type EconomyConfigChange = {
  field: string;
  value: number;
};

type EconomyShipChange = {
  cargoCapacity: number;
  id: string;
  speed: number;
};

type EconomyWareChange = {
  id: string;
  productionOutput: number;
};

type EconomyWareInputChange = {
  unitsPerTick: number;
  inputWareId: string;
  wareId: string;
};

type EconomyConsumptionChange = {
  amount: number;
  stationTypeId: string;
  wareId: string;
};

type EconomySavePayload = {
  config?: EconomyConfigChange[];
  consumption?: EconomyConsumptionChange[];
  removedStationIds?: string[];
  ships?: EconomyShipChange[];
  wareInputs?: EconomyWareInputChange[];
  wares?: EconomyWareChange[];
};

const economyDataFiles = [
  "data/economy-config.ts",
  "data/ships.ts",
  "data/wares.ts",
  "data/stations.ts",
  "data/map-preset-settled.ts",
];

function sanitizeDraftName(name: unknown): string {
  return String(name ?? "").replace(/[^a-zA-Z0-9 _-]/g, "").substring(0, 64);
}

/** Replaces the first match of `pattern` inside the 2000-char window after `anchor`. The pattern's first capture group is preserved as the prefix; the captured text plus `newValue` replaces the match. The window keeps each anchored edit local to its target declaration so a later same-name match elsewhere in the file isn't touched. */
function replaceAfterAnchor(content: string, anchor: string, pattern: string, newValue: string | number): string {
  const anchorIndex = content.indexOf(anchor);
  if (anchorIndex === -1) return content;
  const windowEnd = Math.min(anchorIndex + 2000, content.length);
  const region = content.substring(anchorIndex, windowEnd);
  const updatedRegion = region.replace(new RegExp(pattern), `$1${newValue}`);
  return content.substring(0, anchorIndex) + updatedRegion + content.substring(windowEnd);
}

function applyConfigChanges(repositoryRoot: string, changes: EconomyConfigChange[]) {
  const filePath = resolve(repositoryRoot, "data/economy-config.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const entry of changes) {
    content = replaceAfterAnchor(content, "economyConfig", `(${entry.field}:\\s*)[\\d.]+`, entry.value);
  }
  writeFileSync(filePath, content);
}

function applyShipChanges(repositoryRoot: string, ships: EconomyShipChange[]) {
  const filePath = resolve(repositoryRoot, "data/ships.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const ship of ships) {
    content = replaceAfterAnchor(content, `export const ${ship.id}:`, "(cargoCapacity:\\s*)[\\d.]+", ship.cargoCapacity);
    content = replaceAfterAnchor(content, `export const ${ship.id}:`, "(speed:\\s*)[\\d.]+", ship.speed);
  }
  writeFileSync(filePath, content);
}

function applyWareOutputChanges(repositoryRoot: string, wares: EconomyWareChange[]) {
  const filePath = resolve(repositoryRoot, "data/wares.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const ware of wares) {
    content = replaceAfterAnchor(content, `export const ${ware.id}:`, "(productionOutput:\\s*)[\\d.]+", ware.productionOutput);
  }
  writeFileSync(filePath, content);
}

/** Inner wareId disambiguates between multiple inputs on the same ware; the outer context only scopes to the consuming ware's declaration. */
function applyWareInputChanges(repositoryRoot: string, inputs: EconomyWareInputChange[]) {
  const filePath = resolve(repositoryRoot, "data/wares.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const input of inputs) {
    content = replaceAfterAnchor(
      content,
      `export const ${input.wareId}:`,
      `(\\{ wareId: "${input.inputWareId}", unitsPerTick: )[\\d.]+`,
      input.unitsPerTick,
    );
  }
  writeFileSync(filePath, content);
}

function applyConsumptionChanges(repositoryRoot: string, entries: EconomyConsumptionChange[]) {
  const filePath = resolve(repositoryRoot, "data/stations.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const entry of entries) {
    content = replaceAfterAnchor(content, `id: "${entry.stationTypeId}"`, `(wareId: "${entry.wareId}", amount: )[\\d.]+`, entry.amount);
  }
  writeFileSync(filePath, content);
}

/** Match `stationId:`, not `id:` — the file's own `id: "settled"` preset key would otherwise match first. */
function removeStationsFromSettledPreset(repositoryRoot: string, stationIds: string[]) {
  const filePath = resolve(repositoryRoot, "data/map-preset-settled.ts");
  let content = readFileSync(filePath, "utf-8");
  for (const stationId of stationIds) {
    const stationPattern = new RegExp(`[ \\t]*\\{[^}]*stationId: "${stationId}"[^}]*\\},?\\n`);
    content = content.replace(stationPattern, "");
  }
  writeFileSync(filePath, content);
}

function applyEconomyChanges(repositoryRoot: string, payload: EconomySavePayload) {
  if (payload.config?.length) applyConfigChanges(repositoryRoot, payload.config);
  if (payload.ships?.length) applyShipChanges(repositoryRoot, payload.ships);
  if (payload.wares?.length) applyWareOutputChanges(repositoryRoot, payload.wares);
  if (payload.wareInputs?.length) applyWareInputChanges(repositoryRoot, payload.wareInputs);
  if (payload.consumption?.length) applyConsumptionChanges(repositoryRoot, payload.consumption);
  if (payload.removedStationIds?.length) removeStationsFromSettledPreset(repositoryRoot, payload.removedStationIds);
}

function backupEconomyFiles(repositoryRoot: string) {
  const backupRoot = resolve(repositoryRoot, "backup.local");

  for (const relativePath of economyDataFiles) {
    const sourcePath = resolve(repositoryRoot, relativePath);
    const backupPath = resolve(backupRoot, relativePath);
    if (!existsSync(sourcePath)) continue;

    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(sourcePath, backupPath);
  }
}

function revertEconomyFiles(repositoryRoot: string): boolean {
  const backupRoot = resolve(repositoryRoot, "backup.local");
  const hasAnyBackup = economyDataFiles.some((relativePath) => existsSync(resolve(backupRoot, relativePath)));
  if (!hasAnyBackup) return false;

  for (const relativePath of economyDataFiles) {
    const sourcePath = resolve(backupRoot, relativePath);
    if (!existsSync(sourcePath)) continue;
    copyFileSync(sourcePath, resolve(repositoryRoot, relativePath));
  }

  return true;
}

function readDraftsDirectory(repositoryRoot: string): string[] {
  const draftsDirectory = resolve(repositoryRoot, "drafts.local");
  if (!existsSync(draftsDirectory)) return [];
  return readdirSync(draftsDirectory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(/\.json$/, ""));
}

function parseJsonBody<T>(
  request: IncomingMessage,
  sendJson: (status: number, data: object) => void,
  handler: (payload: T) => void,
) {
  let body = "";
  request.on("data", (chunk: Buffer) => {
    body += chunk;
  });
  request.on("end", () => {
    try {
      handler(JSON.parse(body) as T);
    } catch (error) {
      sendJson(500, { error: String(error) });
    }
  });
}

export function economyApiPlugin(): Plugin {
  return {
    name: "economy-api",
    apply: "serve",
    configureServer(server) {
      const repositoryRoot = server.config.root;

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/economy/")) return next();

        const sendJson = (status: number, data: object) => {
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify(data));
        };

        if (request.url === "/api/economy/save" && request.method === "POST") {
          parseJsonBody<EconomySavePayload>(request, sendJson, (payload) => {
            backupEconomyFiles(repositoryRoot);
            applyEconomyChanges(repositoryRoot, payload);
            sendJson(200, { success: true });
          });
          return;
        }

        if (request.url === "/api/economy/revert" && request.method === "POST") {
          try {
            if (revertEconomyFiles(repositoryRoot)) sendJson(200, { success: true });
            else sendJson(404, { error: "No backup found" });
          } catch (error) {
            sendJson(500, { error: String(error) });
          }
          return;
        }

        if (request.url === "/api/economy/drafts/list" && request.method === "GET") {
          try {
            sendJson(200, { drafts: readDraftsDirectory(repositoryRoot) });
          } catch (error) {
            sendJson(500, { error: String(error) });
          }
          return;
        }

        if (request.url === "/api/economy/drafts/save" && request.method === "POST") {
          parseJsonBody<{ name: unknown; snapshot: unknown }>(request, sendJson, ({ name, snapshot }) => {
            const safeName = sanitizeDraftName(name);
            if (!safeName) {
              sendJson(400, { error: "Invalid draft name" });
              return;
            }

            const draftsDirectory = resolve(repositoryRoot, "drafts.local");
            mkdirSync(draftsDirectory, { recursive: true });
            writeFileSync(resolve(draftsDirectory, `${safeName}.json`), JSON.stringify(snapshot, null, 2));
            sendJson(200, { success: true });
          });
          return;
        }

        if (request.url === "/api/economy/drafts/load" && request.method === "POST") {
          parseJsonBody<{ name: unknown }>(request, sendJson, ({ name }) => {
            const safeName = sanitizeDraftName(name);
            if (!safeName) {
              sendJson(400, { error: "Invalid draft name" });
              return;
            }

            const filePath = resolve(repositoryRoot, "drafts.local", `${safeName}.json`);
            if (!existsSync(filePath)) {
              sendJson(404, { error: "Draft not found" });
              return;
            }

            const snapshot = JSON.parse(readFileSync(filePath, "utf-8"));
            sendJson(200, { snapshot });
          });
          return;
        }

        if (request.url === "/api/economy/drafts/delete" && request.method === "POST") {
          parseJsonBody<{ name: unknown }>(request, sendJson, ({ name }) => {
            const safeName = sanitizeDraftName(name);
            if (!safeName) {
              sendJson(400, { error: "Invalid draft name" });
              return;
            }

            const filePath = resolve(repositoryRoot, "drafts.local", `${safeName}.json`);
            if (existsSync(filePath)) unlinkSync(filePath);
            sendJson(200, { success: true });
          });
          return;
        }

        next();
      });
    },
  };
}
