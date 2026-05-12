import type { NationTemplate } from "../data/nation-types";
import { allNations } from "../data/nations";

/** Runtime instance type for a nation. */
export type Nation = NationTemplate;

export function getNationById(id: string): Nation {
  const nation = allNations.find((candidate) => candidate.id === id);
  if (!nation) throw new Error(`getNationById: nation ${id} not found`);
  return nation;
}
