import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

type EconomyWareOutputChange = {
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
  wares?: EconomyWareOutputChange[];
};

type SendJson = (status: number, data: object) => void;

const economyDataFiles = [
  "data/economy-config.ts",
  "data/ships.ts",
  "data/wares.ts",
  "data/stations.ts",
  "data/map-preset-settled.ts",
];

const draftsDirectoryName = "drafts.local";
const backupDirectoryName = "backup.local";

function draftsDirectoryPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, draftsDirectoryName);
}

function draftFilePath(repositoryRoot: string, safeName: string): string {
  return resolve(repositoryRoot, draftsDirectoryName, `${safeName}.json`);
}

function backupRootPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, backupDirectoryName);
}

function sanitizeDraftName(name: unknown): string {
  return String(name ?? "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .substring(0, 64);
}

function editFile(filePath: string, edit: (content: string) => string): void {
  writeFileSync(filePath, edit(readFileSync(filePath, "utf-8")));
}

function requireValidDraftName(
  payload: { name: unknown },
  sendJson: SendJson,
  handler: (safeName: string) => void,
): void {
  const safeName = sanitizeDraftName(payload.name);
  if (!safeName) {
    sendJson(400, { error: "Invalid draft name" });
    return;
  }
  handler(safeName);
}

/** Scopes the edit to a 2000-char window after `anchor` so a same-named match elsewhere in the file isn't touched. Capture group 1 is preserved as the prefix; `newValue` follows it. */
function replaceAfterAnchor(
  content: string,
  anchor: string,
  regexSource: string,
  newValue: string | number,
): string {
  const anchorIndex = content.indexOf(anchor);
  if (anchorIndex === -1) return content;
  const windowEnd = Math.min(anchorIndex + 2000, content.length);
  const region = content.substring(anchorIndex, windowEnd);
  const updatedRegion = region.replace(new RegExp(regexSource), `$1${newValue}`);
  return content.substring(0, anchorIndex) + updatedRegion + content.substring(windowEnd);
}

function applyChangesToFile<Entry>(
  repositoryRoot: string,
  relativePath: string,
  entries: readonly Entry[],
  applyEntry: (content: string, entry: Entry) => string,
): void {
  editFile(resolve(repositoryRoot, relativePath), (content) => {
    for (const entry of entries) {
      content = applyEntry(content, entry);
    }
    return content;
  });
}

function applyConfigChanges(repositoryRoot: string, changes: EconomyConfigChange[]) {
  applyChangesToFile(repositoryRoot, "data/economy-config.ts", changes, (content, entry) =>
    replaceAfterAnchor(content, "economyConfig", `(${entry.field}:\\s*)[\\d.]+`, entry.value),
  );
}

function applyShipChanges(repositoryRoot: string, ships: EconomyShipChange[]) {
  applyChangesToFile(repositoryRoot, "data/ships.ts", ships, (content, ship) => {
    content = replaceAfterAnchor(
      content,
      `export const ${ship.id}:`,
      "(cargoCapacity:\\s*)[\\d.]+",
      ship.cargoCapacity,
    );
    return replaceAfterAnchor(content, `export const ${ship.id}:`, "(speed:\\s*)[\\d.]+", ship.speed);
  });
}

function applyWareOutputChanges(repositoryRoot: string, wares: EconomyWareOutputChange[]) {
  applyChangesToFile(repositoryRoot, "data/wares.ts", wares, (content, ware) =>
    replaceAfterAnchor(
      content,
      `export const ${ware.id}:`,
      "(productionOutput:\\s*)[\\d.]+",
      ware.productionOutput,
    ),
  );
}

/** Inner wareId disambiguates between multiple inputs on the same ware; the outer context only scopes to the consuming ware's declaration. */
function applyWareInputChanges(repositoryRoot: string, inputs: EconomyWareInputChange[]) {
  applyChangesToFile(repositoryRoot, "data/wares.ts", inputs, (content, input) =>
    replaceAfterAnchor(
      content,
      `export const ${input.wareId}:`,
      `(\\{ wareId: "${input.inputWareId}", unitsPerTick: )[\\d.]+`,
      input.unitsPerTick,
    ),
  );
}

function applyConsumptionChanges(repositoryRoot: string, entries: EconomyConsumptionChange[]) {
  applyChangesToFile(repositoryRoot, "data/stations.ts", entries, (content, entry) =>
    replaceAfterAnchor(
      content,
      `id: "${entry.stationTypeId}"`,
      `(wareId: "${entry.wareId}", amount: )[\\d.]+`,
      entry.amount,
    ),
  );
}

/** Match `stationId:`, not `id:` — the file's own `id: "settled"` preset key would otherwise match first. */
function removeStationsFromSettledPreset(repositoryRoot: string, stationIds: string[]) {
  applyChangesToFile(repositoryRoot, "data/map-preset-settled.ts", stationIds, (content, stationId) => {
    const stationPattern = new RegExp(`[ \\t]*\\{[^}]*stationId: "${stationId}"[^}]*\\},?\\n`);
    return content.replace(stationPattern, "");
  });
}

function applyEconomyChanges(repositoryRoot: string, payload: EconomySavePayload) {
  if (payload.config?.length) applyConfigChanges(repositoryRoot, payload.config);
  if (payload.ships?.length) applyShipChanges(repositoryRoot, payload.ships);
  if (payload.wares?.length) applyWareOutputChanges(repositoryRoot, payload.wares);
  if (payload.wareInputs?.length) applyWareInputChanges(repositoryRoot, payload.wareInputs);
  if (payload.consumption?.length) applyConsumptionChanges(repositoryRoot, payload.consumption);
  if (payload.removedStationIds?.length)
    removeStationsFromSettledPreset(repositoryRoot, payload.removedStationIds);
}

function backupEconomyFiles(repositoryRoot: string) {
  const backupRoot = backupRootPath(repositoryRoot);

  for (const relativePath of economyDataFiles) {
    const sourcePath = resolve(repositoryRoot, relativePath);
    const backupPath = resolve(backupRoot, relativePath);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(sourcePath, backupPath);
  }
}

function revertEconomyFiles(repositoryRoot: string): boolean {
  const backupRoot = backupRootPath(repositoryRoot);
  const hasAnyBackup = economyDataFiles.some((relativePath) => existsSync(resolve(backupRoot, relativePath)));
  if (!hasAnyBackup) return false;

  for (const relativePath of economyDataFiles) {
    const sourcePath = resolve(backupRoot, relativePath);
    if (!existsSync(sourcePath)) continue;
    copyFileSync(sourcePath, resolve(repositoryRoot, relativePath));
  }

  return true;
}

function listDraftNames(repositoryRoot: string): string[] {
  const draftsDirectory = draftsDirectoryPath(repositoryRoot);
  if (!existsSync(draftsDirectory)) return [];
  return readdirSync(draftsDirectory)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(/\.json$/, ""));
}

function parseJsonBody<T>(
  request: IncomingMessage,
  sendJson: SendJson,
  handler: (payload: T) => void,
) {
  let body = "";
  request.on("data", (chunk: Buffer) => {
    body += chunk;
  });
  request.on("end", () => {
    let payload: T;
    try {
      payload = JSON.parse(body) as T;
    } catch (error) {
      sendJson(400, { error: `Invalid JSON: ${String(error)}` });
      return;
    }
    try {
      handler(payload);
    } catch (error) {
      sendJson(500, { error: String(error) });
    }
  });
}

function handleEconomySave(request: IncomingMessage, sendJson: SendJson, repositoryRoot: string) {
  parseJsonBody<EconomySavePayload>(request, sendJson, (payload) => {
    backupEconomyFiles(repositoryRoot);
    applyEconomyChanges(repositoryRoot, payload);
    sendJson(200, { success: true });
  });
}

function handleEconomyRevert(sendJson: SendJson, repositoryRoot: string) {
  try {
    if (revertEconomyFiles(repositoryRoot)) sendJson(200, { success: true });
    else sendJson(404, { error: "No backup found" });
  } catch (error) {
    sendJson(500, { error: String(error) });
  }
}

function handleDraftsList(sendJson: SendJson, repositoryRoot: string) {
  try {
    sendJson(200, { drafts: listDraftNames(repositoryRoot) });
  } catch (error) {
    sendJson(500, { error: String(error) });
  }
}

function handleDraftSave(request: IncomingMessage, sendJson: SendJson, repositoryRoot: string) {
  parseJsonBody<{ name: unknown; snapshot: unknown }>(request, sendJson, (payload) => {
    requireValidDraftName(payload, sendJson, (safeName) => {
      const draftsDirectory = draftsDirectoryPath(repositoryRoot);
      mkdirSync(draftsDirectory, { recursive: true });
      writeFileSync(
        draftFilePath(repositoryRoot, safeName),
        JSON.stringify(payload.snapshot, null, 2),
      );
      sendJson(200, { success: true });
    });
  });
}

function handleDraftLoad(request: IncomingMessage, sendJson: SendJson, repositoryRoot: string) {
  parseJsonBody<{ name: unknown }>(request, sendJson, (payload) => {
    requireValidDraftName(payload, sendJson, (safeName) => {
      const filePath = draftFilePath(repositoryRoot, safeName);
      if (!existsSync(filePath)) {
        sendJson(404, { error: "Draft not found" });
        return;
      }
      const snapshot = JSON.parse(readFileSync(filePath, "utf-8"));
      sendJson(200, { snapshot });
    });
  });
}

function handleDraftDelete(request: IncomingMessage, sendJson: SendJson, repositoryRoot: string) {
  parseJsonBody<{ name: unknown }>(request, sendJson, (payload) => {
    requireValidDraftName(payload, sendJson, (safeName) => {
      const filePath = draftFilePath(repositoryRoot, safeName);
      if (existsSync(filePath)) unlinkSync(filePath);
      sendJson(200, { success: true });
    });
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

        const sendJson: SendJson = (status, data) => {
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify(data));
        };

        if (request.url === "/api/economy/save" && request.method === "POST") {
          handleEconomySave(request, sendJson, repositoryRoot);
          return;
        }
        if (request.url === "/api/economy/revert" && request.method === "POST") {
          handleEconomyRevert(sendJson, repositoryRoot);
          return;
        }
        if (request.url === "/api/economy/drafts/list" && request.method === "GET") {
          handleDraftsList(sendJson, repositoryRoot);
          return;
        }
        if (request.url === "/api/economy/drafts/save" && request.method === "POST") {
          handleDraftSave(request, sendJson, repositoryRoot);
          return;
        }
        if (request.url === "/api/economy/drafts/load" && request.method === "POST") {
          handleDraftLoad(request, sendJson, repositoryRoot);
          return;
        }
        if (request.url === "/api/economy/drafts/delete" && request.method === "POST") {
          handleDraftDelete(request, sendJson, repositoryRoot);
          return;
        }

        next();
      });
    },
  };
}
