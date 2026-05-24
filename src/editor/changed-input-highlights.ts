/** Toggles `.changed` on number inputs that drift from their data-file baseline so unsaved edits stand out from saved values. */
export function highlightChangedInputs(editorRootElement: HTMLElement) {
  for (const input of editorRootElement.querySelectorAll<HTMLInputElement>("input[data-baseline]")) {
    const baseline = parseFloat(input.dataset.baseline ?? "");
    const current = parseFloat(input.value);
    input.classList.toggle("changed", current !== baseline);
  }
}
