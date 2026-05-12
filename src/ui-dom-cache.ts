// DOM-cache helpers — skip writes when the value hasn't changed. Setting
// textContent / innerHTML always reflows even when the string is identical,
// and the HUD refreshes many labels per tick. WeakMap keys on the element so
// callers don't need their own `last*` fields and entries free automatically
// when an element is garbage-collected.

const lastHtml = new WeakMap<Element, string>();
const lastText = new WeakMap<Element, string>();
// Attribute cache nests: element → (attribute name → last value).
const lastAttr = new WeakMap<Element, Map<string, string | null>>();

/** Set innerHTML only when it differs from the last value written via this
 *  helper. Returns true if a write happened. */
export function setHtmlIfChanged(element: Element, html: string): boolean {
  if (lastHtml.get(element) === html) return false;
  element.innerHTML = html;
  lastHtml.set(element, html);
  return true;
}

/** Set textContent only when it differs from the last value written via this
 *  helper. Returns true if a write happened. */
export function setTextIfChanged(element: Element, text: string): boolean {
  if (lastText.get(element) === text) return false;
  element.textContent = text;
  lastText.set(element, text);
  return true;
}

/** setAttribute (or removeAttribute when value is null) only when it differs
 *  from the last value written via this helper. Returns true if a write happened. */
export function setAttrIfChanged(element: Element, name: string, value: string | null): boolean {
  let perElement = lastAttr.get(element);
  if (!perElement) {
    perElement = new Map();
    lastAttr.set(element, perElement);
  }
  if (perElement.get(name) === value) return false;
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
  perElement.set(name, value);
  return true;
}
