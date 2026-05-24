/** Make an id-keyed template lookup over a data-file catalog. The returned
 *  function throws `Unknown ${label}: ${id}` on a miss — every id flows from
 *  the data files, so a miss means a typo or stale reference, not a runtime
 *  case to handle. This is the one canonical place that check lives. */
export function templateLookupById<Id extends string, Template extends { id: Id }>(
  items: readonly Template[],
  label: string,
): (id: Id) => Template {
  const byId = new Map<Id, Template>(items.map((item) => [item.id, item]));
  return (id: Id): Template => {
    const template = byId.get(id);
    if (!template) throw new Error(`Unknown ${label}: ${id}`);
    return template;
  };
}
