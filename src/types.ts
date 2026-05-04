export type ResourceKind = "d1" | "r2" | "kv" | "queue" | "vectorize";

export interface DeclaredBinding {
  kind: ResourceKind;
  binding: string;
  name?: string;
  id?: string;
}

export interface ReferencedBinding {
  binding: string;
  files: string[];
}

export interface LiveResource {
  kind: ResourceKind;
  name: string;
  id: string;
}

export interface DiffRow {
  binding: string;
  kind: ResourceKind | "unknown";
  declared: DeclaredBinding | null;
  referenced: boolean;
  live: LiveResource | null;
  status:
    | "ok"
    | "missing-live"
    | "missing-declared"
    | "missing-id"
    | "orphan-declared"
    | "unreferenced";
}

export interface WranglerConfig {
  path: string;
  format: "toml" | "jsonc";
  raw: string;
  parsed: any;
}
