export interface Env {
  CHAT_DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  SESSIONS_KV: KVNamespace;
  EVENTS_QUEUE: Queue;
  EMBEDDINGS_INDEX: VectorizeIndex;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const id = crypto.randomUUID();
    await env.SESSIONS_KV.put(id, "hi");
    await env.EVENTS_QUEUE.send({ id });
    await env.UPLOADS_BUCKET.put(id, "ok");
    await env.CHAT_DB.prepare("SELECT 1").first();
    await env.EMBEDDINGS_INDEX.query(new Float32Array(768), { topK: 1 });
    return new Response(id);
  },
};
