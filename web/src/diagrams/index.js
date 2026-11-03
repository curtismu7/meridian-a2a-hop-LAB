import diagram from './mh-delegation-chain.json';

// Diagrams are diagram-studio/1 data, loaded by name. No nodes or edges are built in JSX (rule 17).
const ALL = [diagram];
const BY_ID = new Map(ALL.map((d) => [d.id, d]));

export function loadDiagram(id) {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Unknown diagram: ${id}`);
  return d;
}
export const DIAGRAM_IDS = ALL.map((d) => d.id);
