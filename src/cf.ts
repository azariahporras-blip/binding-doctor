import type { LiveResource, ResourceKind } from "./types.js";

const API = "https://api.cloudflare.com/client/v4";

export interface CfCtx {
  token: string;
  accountId: string;
}

async function req<T>(ctx: CfCtx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as any;
  if (!res.ok || body?.success === false) {
    const errs = body?.errors?.map((e: any) => `${e.code} ${e.message}`).join("; ") ?? res.statusText;
    throw new Error(`CF ${res.status} ${path}: ${errs}`);
  }
  return body.result as T;
}

export async function d1Query(ctx: CfCtx, dbId: string, sql: string, params: unknown[] = []): Promise<any> {
  return req<any>(ctx, `/accounts/${ctx.accountId}/d1/database/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  });
}

export async function listD1(ctx: CfCtx): Promise<LiveResource[]> {
  const r = await req<any[]>(ctx, `/accounts/${ctx.accountId}/d1/database?per_page=1000`);
  return r.map((d) => ({ kind: "d1", name: d.name, id: d.uuid }));
}
export async function createD1(ctx: CfCtx, name: string): Promise<LiveResource> {
  const r = await req<any>(ctx, `/accounts/${ctx.accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return { kind: "d1", name: r.name, id: r.uuid };
}

export async function listR2(ctx: CfCtx): Promise<LiveResource[]> {
  const r = await req<any>(ctx, `/accounts/${ctx.accountId}/r2/buckets`);
  const buckets = r.buckets ?? r;
  return buckets.map((b: any) => ({ kind: "r2" as ResourceKind, name: b.name, id: b.name }));
}
export async function createR2(ctx: CfCtx, name: string): Promise<LiveResource> {
  await req<any>(ctx, `/accounts/${ctx.accountId}/r2/buckets`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return { kind: "r2", name, id: name };
}

export async function listKV(ctx: CfCtx): Promise<LiveResource[]> {
  const r = await req<any[]>(ctx, `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100`);
  return r.map((k) => ({ kind: "kv", name: k.title, id: k.id }));
}
export async function createKV(ctx: CfCtx, title: string): Promise<LiveResource> {
  const r = await req<any>(ctx, `/accounts/${ctx.accountId}/storage/kv/namespaces`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return { kind: "kv", name: r.title, id: r.id };
}

export async function listQueues(ctx: CfCtx): Promise<LiveResource[]> {
  const r = await req<any[]>(ctx, `/accounts/${ctx.accountId}/queues`);
  return r.map((q) => ({ kind: "queue", name: q.queue_name, id: q.queue_id }));
}
export async function createQueue(ctx: CfCtx, queue_name: string): Promise<LiveResource> {
  const r = await req<any>(ctx, `/accounts/${ctx.accountId}/queues`, {
    method: "POST",
    body: JSON.stringify({ queue_name }),
  });
  return { kind: "queue", name: r.queue_name, id: r.queue_id };
}

export async function listVectorize(ctx: CfCtx): Promise<LiveResource[]> {
  try {
    const r = await req<any[]>(ctx, `/accounts/${ctx.accountId}/vectorize/v2/indexes`);
    return r.map((v) => ({ kind: "vectorize", name: v.name, id: v.name }));
  } catch {
    return [];
  }
}

export async function createVectorize(
  ctx: CfCtx,
  name: string,
  dimensions = 768,
  metric: "cosine" | "euclidean" | "dot-product" = "cosine"
): Promise<LiveResource> {
  const r = await req<any>(ctx, `/accounts/${ctx.accountId}/vectorize/v2/indexes`, {
    method: "POST",
    body: JSON.stringify({ name, config: { dimensions, metric } }),
  });
  return { kind: "vectorize", name: r.name ?? name, id: r.name ?? name };
}

export async function listAll(ctx: CfCtx): Promise<LiveResource[]> {
  const [d1, r2, kv, q, vec] = await Promise.all([
    listD1(ctx).catch(() => []),
    listR2(ctx).catch(() => []),
    listKV(ctx).catch(() => []),
    listQueues(ctx).catch(() => []),
    listVectorize(ctx).catch(() => []),
  ]);
  return [...d1, ...r2, ...kv, ...q, ...vec];
}

export function ctxFromEnv(): CfCtx {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in env or .env");
  }
  return { token, accountId };
}
