// Generates strings.html at the project root — every game string from the data
// files in one printable page for marking up lore and naming on paper.
//
// Run: node --import tsx dev/strings/generate.ts

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allNations } from "../../data/nations.ts";
import { allStationTypes } from "../../data/stations.ts";
import { allShips } from "../../data/ships.ts";
import { allWares } from "../../data/wares.ts";
import { sectors } from "../../data/map-sectors.ts";
import { presets } from "../../data/map-presets.ts";
import * as saveError from "../../data/strings-save.ts";
import { escapeHtml } from "../../src/util-html-escape.ts";
import { formatLocalDateTime } from "../../src/util-date-format.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { SectorTemplate } from "../../data/map-types.ts";
import type { StationTypeTemplate } from "../../data/station-types.ts";
import type { ShipTypeTemplate } from "../../data/ship-types.ts";
import type { WareTemplate } from "../../data/ware-types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outputPath = path.join(projectRoot, "strings.html");

function renderNameList(names: readonly string[]): string {
  const items = names.map((name) => `      <li>${escapeHtml(name)}</li>`).join("\n");
  return `<ol class="name-list">\n${items}\n    </ol>`;
}

function renderSuffixList(suffixes: readonly string[]): string {
  return suffixes.map(escapeHtml).join(" &nbsp;·&nbsp; ");
}

function renderNation(nation: NationTemplate): string {
  const shipNamesBlock =
    nation.shipNames.length > 0
      ? `
    <h4>Ship names <span class="count">(${nation.shipNames.length})</span></h4>
    ${renderNameList(nation.shipNames)}`
      : "";
  const suffixesBlock =
    nation.nameSuffixes.length > 0
      ? `
    <h4>Name suffixes <span class="count">(${nation.nameSuffixes.length})</span></h4>
    <p class="suffix-list">${renderSuffixList(nation.nameSuffixes)}</p>`
      : "";
  const shortNameTag =
    nation.shortName !== nation.name
      ? `\n      <span class="entity-shortname">${escapeHtml(nation.shortName)}</span>`
      : "";
  return `  <article class="entity nation" id="nation-${escapeHtml(nation.id)}">
    <h3 class="entity-name">
      <span class="entity-code">${escapeHtml(nation.codeName)}</span>
      <span class="entity-title">${escapeHtml(nation.name)}</span>${shortNameTag}
    </h3>
    <dl class="meta">
      <dt>Naming style</dt><dd>${escapeHtml(nation.namingStyle)}</dd>
      <dt>Desire</dt><dd><em>${escapeHtml(nation.desire.verb)}</em> ${escapeHtml(nation.desire.object)}</dd>
    </dl>
    <p class="lore">${escapeHtml(nation.lore)}</p>

    <h4>Station names <span class="count">(${nation.stationNames.length})</span></h4>
    ${renderNameList(nation.stationNames)}${shipNamesBlock}${suffixesBlock}
  </article>`;
}

function renderSectorRow(rowSectors: SectorTemplate[]): string {
  const rowEntries = rowSectors
    .map(
      (sector) => `    <article class="entity sector" id="sector-${escapeHtml(sector.id)}">
      <h3 class="entity-name">
        <span class="entity-code">${sector.gridX},${sector.gridY}</span>
        <span class="entity-title">${escapeHtml(sector.name)}</span>
        <span class="entity-env">${escapeHtml(sector.environment)}</span>
      </h3>
      <p class="lore">${escapeHtml(sector.lore)}</p>
    </article>`,
    )
    .join("\n");
  const rowIndex = rowSectors[0]?.gridY ?? 0;
  return `  <div class="sector-row">
    <h3 class="row-label">Row ${rowIndex}</h3>
${rowEntries}
  </div>`;
}

function renderStationType(stationType: StationTypeTemplate): string {
  const producesTag =
    stationType.produces.length > 0
      ? `\n      <span class="entity-meta">${stationType.produces.map(escapeHtml).join(", ")}</span>`
      : "";
  return `  <article class="entity station-type" id="station-${escapeHtml(stationType.id)}">
    <h3 class="entity-name">
      <span class="entity-title">${escapeHtml(stationType.name)}</span>
      <span class="entity-meta">${escapeHtml(stationType.namePlural)}</span>${producesTag}
    </h3>
    <p class="lore">${escapeHtml(stationType.lore)}</p>
  </article>`;
}

function renderShip(ship: ShipTypeTemplate): string {
  return `  <article class="entity ship" id="ship-${escapeHtml(ship.id)}">
    <h3 class="entity-name">
      <span class="entity-title">${escapeHtml(ship.name)}</span>
      <span class="entity-meta">${ship.cargoCapacity.toLocaleString()} cargo</span>
      <span class="entity-meta">${ship.speed} speed</span>
      <span class="entity-meta">${ship.allowedWares.map(escapeHtml).join(", ")}</span>
    </h3>
    <p class="lore">${escapeHtml(ship.lore)}</p>
  </article>`;
}

function renderWareRow(ware: WareTemplate): string {
  const inputs =
    ware.productionInputs.length > 0
      ? ware.productionInputs.map((input) => `${input.unitsPerTick}× ${input.wareId}`).join(" + ")
      : "—";
  return `    <li>
      <span class="ware-name">${escapeHtml(ware.name)}</span>
      <span><span class="stat-label">Output</span>${ware.productionOutput}</span>
      <span><span class="stat-label">Inputs</span>${escapeHtml(inputs)}</span>
      <p class="lore">${escapeHtml(ware.lore)}</p>
    </li>`;
}

function renderKeyValueRow(key: string, value: string): string {
  return `    <li>
      <span class="kv-key">${escapeHtml(key)}</span>
      <span class="kv-value">${escapeHtml(value)}</span>
    </li>`;
}

function renderSaveErrors(saveErrors: Record<string, string>): string {
  const rows = Object.entries(saveErrors)
    .map(([key, value]) => renderKeyValueRow(key, value))
    .join("\n");
  return `  <ul class="kv-list mono-keys">\n${rows}\n  </ul>`;
}

function groupSectorsByRow(allSectors: SectorTemplate[]): SectorTemplate[][] {
  const rows = new Map<number, SectorTemplate[]>();
  for (const sector of allSectors) {
    const row = rows.get(sector.gridY) ?? [];
    row.push(sector);
    rows.set(sector.gridY, row);
  }
  return Array.from(rows.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, row]) => row.sort((leftSector, rightSector) => leftSector.gridX - rightSector.gridX));
}

function renderSectorMinimap(groupedSectors: SectorTemplate[][]): string {
  const cells = groupedSectors
    .flatMap((row) =>
      row.map(
        (sector) => `      <div class="minimap-cell">
        <span class="minimap-coord">${sector.gridX},${sector.gridY}</span>
        <span class="minimap-name">${escapeHtml(sector.name)}</span>
      </div>`,
      ),
    )
    .join("\n");
  return `  <div class="sector-minimap" aria-hidden="true">
${cells}
  </div>`;
}

type ChapterId = "nations" | "sectors" | "stations" | "ships" | "wares" | "presets" | "save-errors";

interface ChapterEntry {
  id: ChapterId;
  title: string;
  body: string;
}

function generateStringsReference(): void {
  const groupedSectors = groupSectorsByRow(sectors);

  const nationsBlock = allNations.map(renderNation).join("\n\n");
  const sectorRows = groupedSectors.map(renderSectorRow).join("\n\n");
  const sectorMinimap = renderSectorMinimap(groupedSectors);
  const stationTypesBlock = allStationTypes.map(renderStationType).join("\n\n");
  const shipsBlock = allShips.map(renderShip).join("\n\n");
  const waresBlock = `  <ul class="ware-list">\n${allWares.map(renderWareRow).join("\n")}\n  </ul>`;
  const presetsBlock = `  <ul class="kv-list">\n${presets.map((preset) => renderKeyValueRow(preset.name, preset.description)).join("\n")}\n  </ul>`;
  const saveErrorsBlock = renderSaveErrors(saveError);

  const reticleSvg = `<svg class="reticle" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="0.75"/>
    <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="0.5"/>
    <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" stroke-width="0.5"/>
    <line x1="6" y1="16" x2="26" y2="16" stroke="currentColor" stroke-width="0.5"/>
    <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
  </svg>`;

  const chapters: ChapterEntry[] = [
    { id: "nations", title: "Nations", body: nationsBlock },
    { id: "sectors", title: "Sectors", body: `${sectorMinimap}\n${sectorRows}` },
    { id: "stations", title: "Station Types", body: stationTypesBlock },
    { id: "ships", title: "Ships", body: shipsBlock },
    { id: "wares", title: "Wares", body: waresBlock },
    { id: "presets", title: "Map Presets", body: presetsBlock },
    { id: "save-errors", title: "Save Messages", body: saveErrorsBlock },
  ];

  const totalChapters = String(chapters.length).padStart(2, "0");

  function buildChapterSection(chapter: ChapterEntry, index: number): string {
    return `<section class="chapter" id="chapter-${chapter.id}">
  <header>
    <span class="chapter-bar" aria-hidden="true"></span>
    <h2 class="chapter-title">${escapeHtml(chapter.title)}</h2>
    <span class="chapter-num">${String(index + 1).padStart(2, "0")} / ${totalChapters}</span>
  </header>
${chapter.body}
</section>`;
  }

  const css = readFileSync(path.join(__dirname, "strings.css"), "utf8");

  const totalStationNames = allNations.reduce((sum, nation) => sum + nation.stationNames.length, 0);
  const totalShipNames = allNations.reduce((sum, nation) => sum + nation.shipNames.length, 0);
  const today = formatLocalDateTime(new Date()).date;
  const metaline = `Generated ${today} · ${allNations.length} nations · ${sectors.length} sectors · ${allStationTypes.length} station types · ${allShips.length} ships · ${allWares.length} wares · ${totalStationNames} station names · ${totalShipNames} ship names`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Skyshift — Strings Reference</title>
  <style>
${css}
  </style>
</head>
<body>
<div class="sheet">

<header class="title">
  ${reticleSvg}
  <p class="bureau-label" aria-hidden="true">Skyshift // Strings Archive</p>
  <h1>Skyshift</h1>
  <p class="metaline">${metaline}</p>
</header>

${chapters.map(buildChapterSection).join("\n\n")}

</div>
</body>
</html>
`;

  writeFileSync(outputPath, html, "utf8");
  console.log(`Wrote ${path.relative(projectRoot, outputPath)} (${html.length.toLocaleString()} bytes)`);
}

generateStringsReference();
