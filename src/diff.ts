import type {
  DeclaredBinding,
  DiffRow,
  LiveResource,
  ReferencedBinding,
} from "./types.js";

export function buildDiff(
  declared: DeclaredBinding[],
  referenced: ReferencedBinding[],
  live: LiveResource[]
): DiffRow[] {
  const refSet = new Set(referenced.map((r) => r.binding));
  const declMap = new Map(declared.map((d) => [d.binding, d]));
  const allBindings = new Set<string>([...refSet, ...declMap.keys()]);

  const liveByName = new Map<string, LiveResource>();
  const liveById = new Map<string, LiveResource>();
  for (const l of live) {
    liveByName.set(`${l.kind}:${l.name}`, l);
    liveById.set(`${l.kind}:${l.id}`, l);
  }

  const rows: DiffRow[] = [];
  for (const binding of allBindings) {
    const d = declMap.get(binding) ?? null;
    const referencedHere = refSet.has(binding);
    let liveMatch: LiveResource | null = null;

    if (d) {
      if (d.id) liveMatch = liveById.get(`${d.kind}:${d.id}`) ?? null;
      if (!liveMatch && d.name) liveMatch = liveByName.get(`${d.kind}:${d.name}`) ?? null;
    }

    let status: DiffRow["status"];
    if (!d && referencedHere) status = "missing-declared";
    else if (d && !referencedHere) status = "unreferenced";
    else if (d && d.kind !== "r2" && !d.id && !liveMatch) status = "missing-id";
    else if (d && !liveMatch) status = "missing-live";
    else status = "ok";

    rows.push({
      binding,
      kind: d?.kind ?? "unknown",
      declared: d,
      referenced: referencedHere,
      live: liveMatch,
      status,
    });
  }

  rows.sort((a, b) => a.binding.localeCompare(b.binding));
  return rows;
}

export function formatDiff(rows: DiffRow[]): string {
  if (!rows.length) return "(no bindings detected)";
  const header = ["BINDING", "KIND", "DECL", "REF", "LIVE", "STATUS"];
  const lines = rows.map((r) => [
    r.binding,
    r.kind,
    r.declared ? "yes" : "—",
    r.referenced ? "yes" : "—",
    r.live ? r.live.id.slice(0, 12) : "—",
    r.status,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...lines.map((l) => l[i].length))
  );
  const fmt = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...lines.map(fmt)].join("\n");
}
