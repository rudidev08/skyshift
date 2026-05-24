/** Editor panels share the same outer chrome (`<div class="panel">` + header + `<h2>` title). These helpers emit that chrome so each panel file stays focused on its own table/control markup. */

export function openPanel(title: string, extraPanelClass?: string, headerExtraHtml?: string): string {
  const classAttribute = extraPanelClass ? `panel ${extraPanelClass}` : "panel";
  const headerHtml = headerExtraHtml ?? "";
  return `<div class="${classAttribute}"><div class="panel-header"><h2>${title}</h2>${headerHtml}</div>`;
}

export function closePanel(): string {
  return "</div>";
}
